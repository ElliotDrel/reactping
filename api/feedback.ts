// POST /api/feedback: the website's feedback form (plain HTML form post).
import { handle } from "../src/vercel.ts";

export function POST(request: Request): Promise<Response> {
  return handle(request);
}
