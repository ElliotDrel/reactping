// POST /api/slack/events: Slack Events API request URL.
import { handle } from "../../../../vercel.ts";

// Every request reaches the shared handler; nothing here is ever prerendered or cached.
export const dynamic = "force-dynamic";

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
