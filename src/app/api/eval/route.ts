import { NextResponse } from "next/server";
import { runEval } from "@/lib/eval/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/eval: the eval report (issue #21) over the synthetic seed, computed on request. */
export function GET() {
  return NextResponse.json(runEval({ now: new Date() }));
}
