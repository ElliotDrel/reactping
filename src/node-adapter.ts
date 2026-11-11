import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 1024 * 1024;

/** Converts a Node request to a Web Request. Returns null when the body exceeds `limit`. */
export async function toWebRequest(
  req: IncomingMessage,
  protocol: "http" | "https",
  limit = MAX_BODY_BYTES,
): Promise<Request | null> {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i]!, req.rawHeaders[i + 1]!);
  const url = `${protocol}://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) return null;
    chunks.push(chunk);
  }
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader("set-cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Node (req, res) handler around a Web handler, shared by the Vercel function and the local dev server. */
export function nodeHandler(
  handle: (request: Request) => Promise<Response>,
  protocol: "http" | "https",
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const request = await toWebRequest(req, protocol);
    const response = request
      ? await handle(request)
      : Response.json({ error: "too_large" }, { status: 413, headers: { "cache-control": "no-store" } });
    await sendWebResponse(res, response);
  };
}
