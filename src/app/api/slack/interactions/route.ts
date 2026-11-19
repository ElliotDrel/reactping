// POST /api/slack/interactions: Slack interactivity request URL (App Home buttons).
import { handle } from "../../../../vercel.ts";

// Every request reaches the shared handler; nothing here is ever prerendered or cached.
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
