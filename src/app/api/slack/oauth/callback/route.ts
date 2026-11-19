// GET /api/slack/oauth/callback: Slack OAuth redirect URL.
import { handle } from "../../../../../vercel.ts";

// Every request reaches the shared handler; nothing here is ever prerendered or cached.
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
