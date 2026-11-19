// GET /api/health: outage summary for the runbook in docs/setup.md (503 when DMs fail or reaction events stop).
import { handle } from "../../../vercel.ts";

// Every request reaches the shared handler; nothing here is ever prerendered or cached.
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
