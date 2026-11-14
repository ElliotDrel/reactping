// GET /api/slack/install: starts Slack OAuth ("Add to Slack").
import { handle } from "../../src/vercel.ts";

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
