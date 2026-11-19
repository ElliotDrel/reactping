// Every /api/* request goes to the shared handler, which routes by method and path (404 for anything unknown).
import { handle } from "../../../vercel.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const GET = handle;
export const POST = handle;
