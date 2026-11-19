// GET /api/health: outage check for .github/workflows/health.yml (503 when DMs fail or reaction events stop).
import { handle } from "../src/vercel.ts";

export function GET(request: Request): Promise<Response> {
  return handle(request);
}
