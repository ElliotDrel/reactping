// GET /api/stats: the homepage's live counters (workspaces, reaction notifications sent) as an SVG image.
import { handle } from "../../../vercel.ts";

// Every request reaches the shared handler; nothing here is ever prerendered or cached.
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
