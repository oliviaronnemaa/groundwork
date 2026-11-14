import { NextResponse } from "next/server";
import { Cala } from "@/lib/cala";
import { interpretPrompt } from "@/lib/llm";
import type { CallLog, InterpretResult } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Read the prompt, then look the company up in Cala so the investor can confirm the right entity. */
export async function POST(req: Request) {
  const { question, company } = (await req.json()) as { question?: string; company?: string };
  const key = process.env.CALA_API_KEY;
  if (!key) return NextResponse.json({ error: "CALA_API_KEY is not set" }, { status: 500 });
  if (!question?.trim() && !company?.trim()) return NextResponse.json({ error: "Ask a question or name a company" }, { status: 400 });

  const parsed = company?.trim()
    ? { company: company.trim(), focus: "", questions: [] as string[], by: "rules" as const }
    : await interpretPrompt(question!.trim());

  let call: CallLog | undefined;
  const cala = new Cala(key, (c) => (call = c));
  let candidates: InterpretResult["candidates"] = [];
  if (parsed.company) {
    try {
      const { data } = await cala.search("identify", parsed.company, ["Company"], 6);
      candidates = (data.entities ?? []).map((e) => ({ id: e.id, name: e.name, entityType: e.entity_type, description: e.description }));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "Cala search failed", call }, { status: 502 });
    }
  }
  const out: InterpretResult = {
    companyQuery: parsed.company,
    focus: parsed.focus,
    questions: parsed.questions.map((text, i) => ({ id: `Q${i + 1}`, text })),
    candidates,
    call,
    interpretedBy: parsed.by,
  };
  return NextResponse.json(out);
}
