// POST /api/slack/interactions: Slack interactivity request URL (App Home buttons).
import { handle } from "../../src/vercel.ts";

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
