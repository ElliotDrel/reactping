// POST /api/slack/events: Slack Events API request URL.
import { handle } from "../../src/vercel.ts";

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
