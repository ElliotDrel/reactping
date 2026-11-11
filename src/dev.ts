// Local development server: the same API handler as the Vercel function, plus the built static site.
// Run `npm run build` first. There is no pg_cron locally, so this also calls the delivery endpoint each minute.
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { securityHeaders } from "../site/headers.ts";
import { createApiFromEnv } from "./app.ts";
import { log } from "./log.ts";
import { nodeHandler } from "./node-adapter.ts";

const STATIC = resolve(".vercel/output/static");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
};

if (!existsSync(join(STATIC, "index.html"))) {
  console.error("Run `npm run build` first.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 3000);
const api = createApiFromEnv(process.env, (task) => void task());
const handleApi = nodeHandler(api, "http");
const headers = securityHeaders(process.env.PUBLIC_SUPABASE_URL?.trim() || null);
delete headers["Strict-Transport-Security"];

function staticFile(pathname: string): string | null {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^[/\\]+/, "");
  for (const candidate of [clean || "index.html", `${clean}.html`]) {
    const file = resolve(STATIC, candidate);
    if (file.startsWith(STATIC) && existsSync(file) && extname(file)) return file;
  }
  return null;
}

createServer((req, res) => {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    handleApi(req, res).catch(() => res.destroy());
    return;
  }
  const file = staticFile(pathname);
  res.statusCode = file ? 200 : 404;
  res.setHeader("Content-Type", TYPES[extname(file ?? ".html")] ?? "application/octet-stream");
  res.end(readFileSync(file ?? join(STATIC, "404.html")));
}).listen(port, () => log("info", "dev_server_listening", { url: `http://localhost:${port}` }));

const cronSecret = process.env.DELIVERY_CRON_SECRET?.trim();
if (cronSecret) {
  setInterval(() => {
    void api(
      new Request(`http://localhost:${port}/api/internal/deliver`, {
        method: "POST",
        headers: { authorization: `Bearer ${cronSecret}` },
      }),
    );
  }, 60_000);
}
