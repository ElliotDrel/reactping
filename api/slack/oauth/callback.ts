// GET /api/slack/oauth/callback: Slack OAuth redirect URL.
import { handle } from "../../../src/vercel.ts";

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
