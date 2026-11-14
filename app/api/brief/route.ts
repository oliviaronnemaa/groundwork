import { NextResponse } from "next/server";
import { buildBrief } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json();
  if (!Array.isArray(body?.evidence)) return NextResponse.json({ error: "evidence required" }, { status: 400 });
  const brief = await buildBrief({
    question: String(body.question ?? ""),
    context: Array.isArray(body.context) ? body.context : [],
    notes: Array.isArray(body.notes) ? body.notes : [],
    evidence: body.evidence,
    gaps: Array.isArray(body.gaps) ? body.gaps : [],
    helpers: Array.isArray(body.helpers) ? body.helpers : [],
    companyName: String(body.companyName ?? "the company"),
    companyId: String(body.companyId ?? ""),
  });
  return NextResponse.json(brief);
}
