// GET /api/stats: the homepage's live counters (workspaces, reaction notifications sent) as an SVG image.
import { handle } from "../src/vercel.ts";

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
