import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, describe, it } from "node:test";
import { buildSite } from "../scripts/build.ts";

process.env.NODE_ENV = "test";

const SECRETS = {
  DATABASE_URL: "postgres://user:db-secret-marker@db.example/postgres",
  SLACK_CLIENT_SECRET: "slack-client-secret-marker",
  SLACK_SIGNING_SECRET: "slack-signing-secret-marker",
  ENCRYPTION_KEY: "ZW5jcnlwdGlvbi1rZXktbWFya2VyLTMyLWJ5dGVzISE=",
  DELIVERY_CRON_SECRET: "cron-secret-marker-cron-secret-marker",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-marker",
  REACTPING_INSTALLS_ENABLED: "true",
};
const PUBLIC = {
  PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_marker",
};
const PAGES = ["index", "features", "install", "faq", "about", "privacy", "terms", "app", "404"];

const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

async function built(env: NodeJS.ProcessEnv) {
  const dir = mkdtempSync(join(tmpdir(), "reactping-build-"));
  dirs.push(dir);
  const config = await buildSite(dir, env);
  const read = (path: string) => readFileSync(join(dir, path), "utf8");
  return { dir, config, read };
}

function allFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? allFiles(path) : [path];
  });
}

describe("production build", () => {
  it("emits every route, the API function, and Vercel routing", async () => {
    const { read } = await built({});
    for (const page of PAGES) assert.match(read(`static/${page}.html`), /<!doctype html>/i, page);
    const routes = JSON.parse(read("config.json")) as {
      routes: { src?: string; dest?: string; handle?: string; status?: number }[];
      overrides: Record<string, { path: string }>;
    };
    const filesystem = routes.routes.findIndex((r) => r.handle === "filesystem");
    const api = routes.routes.findIndex((r) => r.dest === "/api");
    assert.ok(filesystem >= 0 && api > filesystem, "API catch-all runs after static files");
    assert.ok(new RegExp(routes.routes[api]!.src!).test("/api/slack/events"));
    assert.equal(routes.routes.at(-1)!.status, 404);
    assert.deepEqual(
      Object.values(routes.overrides)
        .map((o) => o.path)
        .sort(),
      ["about", "app", "faq", "features", "install", "privacy", "terms"],
    );
    const fn = JSON.parse(read("functions/api.func/.vc-config.json")) as Record<string, unknown>;
    assert.equal(fn.runtime, "nodejs24.x");
    assert.equal(fn.launcherType, "Nodejs");
  });

  it("is a noindex preview with installs shown as unavailable by default", async () => {
    const { dir, config, read } = await built({});
    assert.equal(config.indexable, false);
    assert.equal(read("static/robots.txt"), "User-agent: *\nDisallow: /\n");
    assert.equal(existsSync(join(dir, "static/sitemap.xml")), false);
    for (const page of PAGES) {
      const page_html = read(`static/${page}.html`);
      assert.match(page_html, /<meta name="robots" content="noindex, nofollow"/, page);
      assert.ok(!page_html.includes('rel="canonical"'), page);
    }
    assert.match(read("static/install.html"), /public installs are not open yet/);
    assert.match(read("static/app.html"), /"supabaseUrl":null/);
  });

  it("indexes only with a canonical site URL in production, and never on Vercel previews", async () => {
    const site = { PUBLIC_SITE_URL: "https://reactping.example", PUBLIC_SITE_INDEXABLE: "true" };
    const prod = await built({ ...site, VERCEL_ENV: "production" });
    assert.match(
      prod.read("static/features.html"),
      /<link rel="canonical" href="https:\/\/reactping.example\/features"/,
    );
    assert.match(prod.read("static/features.html"), /content="index, follow"/);
    assert.match(prod.read("static/app.html"), /content="noindex, nofollow"/);
    const sitemap = prod.read("static/sitemap.xml");
    assert.equal(sitemap.match(/<loc>/g)!.length, 7);
    assert.ok(!sitemap.includes("/app<") && !sitemap.includes("/404"));
    assert.match(prod.read("static/robots.txt"), /Sitemap: https:\/\/reactping.example\/sitemap.xml/);

    const preview = await built({ ...site, VERCEL_ENV: "preview" });
    assert.equal(preview.config.indexable, false);
    assert.match(preview.read("static/robots.txt"), /Disallow: \/\n$/);
    await assert.rejects(built({ PUBLIC_SITE_INDEXABLE: "true" }), /requires PUBLIC_SITE_URL/);
  });

  it("never puts server secrets or operator flags into public output", async () => {
    const { dir, read } = await built({ ...SECRETS, ...PUBLIC });
    for (const file of allFiles(dir)) {
      const text = readFileSync(file, "utf8");
      for (const [name, value] of Object.entries(SECRETS)) {
        if (name !== "REACTPING_INSTALLS_ENABLED") assert.ok(!text.includes(value), `${name} found in ${file}`);
      }
    }
    const embedded = /<script id="reactping-config" type="application\/json">\s*(.*?)\s*<\/script>/.exec(
      read("static/app.html"),
    )![1]!;
    assert.deepEqual(JSON.parse(embedded), {
      supabaseUrl: "https://project.supabase.co",
      supabasePublishableKey: "sb_publishable_marker",
      installEnabled: false,
    });
    assert.match(
      read("static/install.html"),
      /public installs are not open yet/,
      "operator flag does not flip the site",
    );
    await assert.rejects(
      built({ ...PUBLIC, PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_oops" }),
      /PUBLIC_SUPABASE_PUBLISHABLE_KEY is a Supabase secret key/,
    );
  });

  it("shows the install as available only with the public launch flag", async () => {
    const { read } = await built({ PUBLIC_INSTALL_ENABLED: "true" });
    assert.match(read("static/install.html"), /Free pilot: installs open/);
    for (const page of ["index", "features"])
      assert.match(read(`static/${page}.html`), /href="\/install">Add to Slack/);
  });

  it("bundles an API function that starts without configuration and fails closed", async () => {
    const { dir } = await built({});
    const { default: handler } = (await import(pathToFileURL(join(dir, "functions/api.func/index.mjs")).href)) as {
      default: Parameters<typeof createServer>[0];
    };
    const server = createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const health = await fetch(`${base}/api/health`);
      assert.deepEqual(await health.json(), { ok: true, ready: false });
      assert.equal((await fetch(`${base}/api/me`)).status, 503);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
