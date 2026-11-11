// Production build: static site + one Node.js function, written as Vercel Build Output API v3.
//
//   .vercel/output/static/              generated HTML, CSS, browser bundles, assets
//   .vercel/output/functions/api.func/  bundled API (every /api/* path)
//   .vercel/output/config.json          routes: security headers, clean URLs, /api/* -> api, 404
//
// Only PUBLIC_* variables (plus VERCEL_ENV) are read here; see site/public-config.ts.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "../site/headers.ts";
import { PAGES } from "../site/pages.ts";
import { loadPublicConfig, type PublicConfig } from "../site/public-config.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function buildSite(outDir: string, env: NodeJS.ProcessEnv): Promise<PublicConfig> {
  const config = loadPublicConfig(env);
  const staticDir = join(outDir, "static");
  const funcDir = join(outDir, "functions", "api.func");
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  mkdirSync(funcDir, { recursive: true });

  for (const page of PAGES) writeFileSync(join(staticDir, page.file), page.render(config));
  cpSync(join(ROOT, "site", "assets"), join(staticDir, "assets"), { recursive: true });
  cpSync(join(ROOT, "site", "styles.css"), join(staticDir, "assets", "styles.css"));

  const indexed = PAGES.filter((p) => !p.noindex);
  writeFileSync(
    join(staticDir, "robots.txt"),
    config.indexable
      ? `User-agent: *\nAllow: /\nDisallow: /app\nDisallow: /api/\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`
      : "User-agent: *\nDisallow: /\n",
  );
  if (config.indexable) {
    const urls = indexed.map((p) => `  <url><loc>${config.siteUrl}${p.path}</loc></url>`).join("\n");
    writeFileSync(
      join(staticDir, "sitemap.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    );
  }

  // `define` keeps any accidental process.env reference in browser code from inlining build secrets.
  await build({
    entryPoints: { app: join(ROOT, "site/client/app.ts"), site: join(ROOT, "site/client/site.ts") },
    outdir: join(staticDir, "assets"),
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    platform: "browser",
    define: { "process.env": "{}" },
    legalComments: "none",
    logLevel: "warning",
  });

  await build({
    entryPoints: [join(ROOT, "src/vercel.ts")],
    outfile: join(funcDir, "index.mjs"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: ["pg-native"],
    // CommonJS dependencies (pg, the Slack client) need require() inside an ESM bundle.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
    legalComments: "none",
    logLevel: "warning",
  });
  writeJson(join(funcDir, ".vc-config.json"), {
    runtime: "nodejs24.x",
    handler: "index.mjs",
    launcherType: "Nodejs",
    maxDuration: 30,
    shouldAddHelpers: false,
  });
  writeJson(join(funcDir, "package.json"), { type: "module" });

  const pages = PAGES.filter((p) => p.file !== "index.html" && p.file !== "404.html");
  writeJson(join(outDir, "config.json"), {
    version: 3,
    routes: [
      { src: "^/(.*)$", headers: securityHeaders(config.supabaseUrl), continue: true },
      ...(config.indexable ? [] : [{ src: "^/(.*)$", headers: { "X-Robots-Tag": "noindex" }, continue: true }]),
      { handle: "filesystem" },
      { src: "^/api(?:/.*)?$", dest: "/api" },
      { src: "^/.*$", status: 404, dest: "/404.html" },
    ],
    // Serve features.html at /features, and so on.
    overrides: Object.fromEntries(pages.map((p) => [p.file, { path: p.path.slice(1) }])),
  });
  return config;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = await buildSite(join(ROOT, ".vercel", "output"), process.env);
  console.log(
    `Built .vercel/output (indexable: ${config.indexable}, install CTA enabled: ${config.installEnabled}, sign-in configured: ${Boolean(config.supabaseUrl)})`,
  );
}
