import type { IncomingMessage, ServerResponse } from "node:http";
import type { Handler } from "./api.ts";
import { createApiFromEnv } from "./app.ts";
import { nodeHandler } from "./node-adapter.ts";

// Vercel exposes waitUntil through this request-context symbol (what @vercel/functions reads).
const REQUEST_CONTEXT = Symbol.for("@vercel/request-context");
type RequestContext = { get?: () => { waitUntil?: (task: Promise<unknown>) => void } | undefined };

function waitUntil(task: () => Promise<unknown>): void {
  const context = (globalThis as Record<symbol, RequestContext | undefined>)[REQUEST_CONTEXT]?.get?.();
  const promise = task();
  context?.waitUntil?.(promise);
}

let handle: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | undefined;
let api: Handler | undefined;

/** The single Vercel function behind every /api/* path. Configuration is read on first request. */
export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  api ??= createApiFromEnv(process.env, waitUntil);
  handle ??= nodeHandler(api, "https");
  return handle(req, res);
}
