import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Brief, Claim, Evidence, Gap, Helper, Note } from "./types";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

export function hasClaude() {
  return !!process.env.ANTHROPIC_API_KEY;
}

function client() {
  // Pin the public endpoint so a shell-level ANTHROPIC_BASE_URL can't reroute app traffic.
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, baseURL: process.env.GROUNDWORK_ANTHROPIC_BASE_URL || "https://api.anthropic.com" });
}

// ---------------------------------------------------------------------------
// 1. Interpret the investor's prompt

const InterpretSchema = z.object({
  company_name: z.string().describe("The single company the investor wants to research, as written. Empty string if none is named."),
  focus: z.string().describe("One short phrase: what the investor wants to understand."),
  questions: z
    .array(z.string())
    .describe("0 to 2 short clarifying questions that would materially improve the research. Empty if the request is already clear."),
});

export async function interpretPrompt(question: string): Promise<{ company: string | null; focus: string; questions: string[]; by: "claude" | "rules" }> {
  if (hasClaude()) {
    try {
      const res = await client().beta.messages.parse({
        model: MODEL,
        max_tokens: 2000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(InterpretSchema) },
        system:
          "You help an angel or pre-seed investor start a research session. Extract the company they want to research and what they want to understand. Ask at most two clarifying questions, only when the answer would change what to research (e.g. what they already know, what they're most unsure about: team, technology, market). Never ask about things you could look up.",
        messages: [{ role: "user", content: question }],
      });
      const p = res.parsed_output;
      if (p) return { company: p.company_name.trim() || null, focus: p.focus, questions: p.questions.slice(0, 2), by: "claude" };
    } catch (e) {
      console.error("interpret failed, using rules", e);
    }
  }
  return { ...ruleInterpret(question), by: "rules" };
}

function ruleInterpret(q: string) {
  const quoted = q.match(/["“']([^"”']{2,60})["”']/)?.[1];
  const about = q.match(/\b(?:about|research|into|on|meeting|meet|with|of|for|evaluate|investigate)\s+(?:the\s+founders\s+of\s+)?([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,3})/)?.[1];
  const caps = q.match(/\b([A-Z][a-zA-Z0-9&.\-]+(?:\s+[A-Z][a-zA-Z0-9&.\-]+){0,2})\b/g)?.filter((w) => !/^(I|I'm|Help|What|Who|How|Should|Tell|Find|Show|Give|Can|Please|The)$/.test(w))[0];
  const company = (quoted || about || caps || "").trim() || null;
  const questions: string[] = [];
  if (q.length < 140) {
    questions.push("What do you already know about the founders or the company?");
    questions.push("What are you most unsure about: the team, the technology, the market, or something else?");
  }
  return { company, focus: "Understand the team, funding and network", questions };
}

// ---------------------------------------------------------------------------
// 2. Build the evidence-linked brief

const ClaimSchema = z.object({
  text: z.string(),
  kind: z.enum(["fact", "note", "interpretation"]),
  evidence: z.array(z.string()).describe("Evidence ids (E…) that directly support this claim."),
  notes: z.array(z.string()).describe("Investor note ids (N…) used by this claim."),
});

const BriefSchema = z.object({
  headline: z.string().describe("One sentence (max 30 words) orienting the investor: what the company is and what stands out in the evidence. No verdict."),
  sections: z
    .array(z.object({ title: z.string(), claims: z.array(ClaimSchema) }))
    .describe("3-5 sections adapted to the question, e.g. Company, Team, Funding & investors, Network."),
  comparables: z.array(
    z.object({
      name: z.string(),
      entity_id: z.string(),
      why_relevant: z.string().describe("The shared mechanism or challenge, not just the industry."),
      differences: z.string().describe("Where the analogy breaks: stage, market, timing, geography."),
      raises_question: z.string().describe("A question this comparison raises for the current opportunity."),
      evidence: z.array(z.string()),
    }),
  ),
  gaps: z.array(
    z.object({
      title: z.string(),
      why_it_matters: z.string(),
      actions: z.array(z.string()).describe("2-4 concrete ways to learn more: founder question, document to request, customer call, demo."),
      helpers: z.array(z.object({ helper_id: z.string(), what_to_ask: z.string() })).describe("Only helper ids from the provided list whose experience is relevant to this gap."),
      expert_types: z.array(z.object({ type: z.string(), what_to_ask: z.string() })).describe("Kinds of experts worth finding when no listed helper fits."),
    }),
  ),
  questions_for_founders: z.array(z.string()).describe("4-7 sharp questions tied to the gaps and evidence."),
});

const SYSTEM = `You write research briefs for angel and pre-seed investors. You support their judgement; you never make the decision.

Hard rules:
- Use only the evidence (E…), investor notes (N…), gaps and helpers provided. Never add facts from memory, even well-known ones.
- Every "fact" claim must cite at least one E id that directly supports it. A claim drawn from investor notes is kind "note" and cites N ids. Anything inferred, compared or speculative is kind "interpretation", phrased as a hypothesis ("may", "worth checking whether").
- Missing data is not proof of absence: say "Cala has no record of…", not "they have no…".
- Evidence whose source is marked WEB comes from an open-web search, not Cala. It may be about someone else with the same name. Treat it as a lead: attribute it ("a page on example.com says…"), never state it as established, and if it matters, add a founder question to confirm it.
- No investment verdicts, success predictions, scores or recommendations to invest or pass.
- Never judge a founder's intelligence, personality, ambition or potential from a biography. Describe observable experience only.
- Comparable cases: pick from the comparable or portfolio companies in the evidence only, explain the shared mechanism and where the analogy breaks. Possible contributors to outcomes are hypotheses.
- Helpers: only reference listed helper ids. Their route is a possible introduction path via a shared investor, not a known relationship; do not imply they know the founders.
- Weave the investor's notes in where relevant and show how they change the picture. Notes of kind "question" are the investor's own questions: keep them (sharpened if useful) in questions_for_founders.
- Be concise and specific. Investors skim.`;

export async function buildBrief(input: {
  question: string;
  context: { q: string; a: string }[];
  notes: Note[];
  evidence: Evidence[];
  gaps: Gap[];
  helpers: Helper[];
  companyName: string;
  companyId: string;
}): Promise<Brief> {
  if (!hasClaude()) return { ...rulesBrief(input), warning: "Claude isn't connected, so this brief only restates sourced facts. Add ANTHROPIC_API_KEY to get synthesis, comparisons and questions." };
  const evidenceText = input.evidence
    .map((e) => `${e.id} | ${e.entityName} | ${e.label}: ${e.value}${e.sources.length ? ` | sources: ${e.sources.map((s) => [s.name, s.rank, s.date].filter(Boolean).join(" ")).slice(0, 2).join("; ")}` : ""}`)
    .join("\n");
  const user = `Investor's question: ${input.question}
Company researched: ${input.companyName} (entity ${input.companyId})

Investor context:
${input.context.filter((c) => c.a.trim()).map((c) => `- ${c.q} → ${c.a}`).join("\n") || "- (none given)"}

Investor notes (private, never sent to Cala):
${input.notes.map((n) => `${n.id} [${n.kind ?? "observation"}${n.links?.length ? `, about ${n.links.map((l) => l.name).join(", ")}` : ""}]: ${n.text}`).join("\n") || "(none)"}

Evidence (from Cala, plus any WEB-marked pages from an open-web search):
${evidenceText}

Gaps detected:
${input.gaps.map((g) => `- ${g.title}: ${g.why}`).join("\n") || "(none)"}

Helpers (people reachable through sourced links):
${input.helpers.map((h) => `${h.id}: ${h.name}, ${h.relevance}${h.route ? `. Route: ${h.route}` : ""}`).join("\n") || "(none)"}`;

  try {
    const res = await client().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(BriefSchema) },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new Error(`No brief returned (${res.stop_reason})`);
    return validate(res.parsed_output, input);
  } catch (e) {
    console.error("brief failed", e);
    return { ...rulesBrief(input), warning: `Claude couldn't write the brief (${e instanceof Error ? e.message.slice(0, 140) : "error"}). Showing sourced facts only.` };
  }
}

/** Drop anything the model cited that doesn't exist; never present an unsourced fact as fact. */
function validate(b: z.infer<typeof BriefSchema>, input: { evidence: Evidence[]; notes: Note[]; helpers: Helper[] }): Brief {
  const E = new Set(input.evidence.map((e) => e.id));
  const N = new Set(input.notes.map((n) => n.id));
  const H = new Set(input.helpers.map((h) => h.id));
  const fix = (c: z.infer<typeof ClaimSchema>): Claim => {
    const evidence = c.evidence.filter((x) => E.has(x));
    const notes = c.notes.filter((x) => N.has(x));
    let kind = c.kind;
    if (kind === "fact" && !evidence.length) kind = notes.length ? "note" : "interpretation";
    if (kind === "note" && !notes.length) kind = evidence.length ? "fact" : "interpretation";
    return { text: c.text, kind, evidence, notes };
  };
  return {
    headline: b.headline,
    sections: b.sections.map((s) => ({ title: s.title, claims: s.claims.map(fix) })).filter((s) => s.claims.length),
    comparables: b.comparables
      .map((c) => ({ name: c.name, entityId: c.entity_id, whyRelevant: c.why_relevant, differences: c.differences, raisesQuestion: c.raises_question, evidence: c.evidence.filter((x) => E.has(x)) }))
      .filter((c) => c.evidence.length),
    gaps: b.gaps.map((g) => ({
      title: g.title,
      whyItMatters: g.why_it_matters,
      actions: g.actions,
      helpers: g.helpers.filter((h) => H.has(h.helper_id)).map((h) => ({ helperId: h.helper_id, whatToAsk: h.what_to_ask })),
      expertTypes: g.expert_types.map((x) => ({ type: x.type, whatToAsk: x.what_to_ask })),
    })),
    questions: b.questions_for_founders,
    generatedBy: "claude",
    model: MODEL,
  };
}

// ---------------------------------------------------------------------------
// Rules-only brief: sourced facts, grouped. No synthesis, nothing invented.

function rulesBrief(input: { evidence: Evidence[]; gaps: Gap[]; helpers: Helper[]; notes: Note[]; companyId: string; companyName: string }): Brief {
  const ev = input.evidence;
  const fact = (e: Evidence): Claim => ({ text: `${e.entityId === input.companyId ? e.label : `${e.entityName} — ${e.label.toLowerCase()}`}: ${e.value}`, kind: "fact", evidence: [e.id], notes: [] });
  const company = ev.filter((e) => e.entityId === input.companyId && !["funding_round", "corporate_event", "web"].includes(e.field));
  const web = ev.filter((e) => e.field === "web");
  const team = ev.filter((e) => e.field === "role" || (["description", "FOUNDED", "WORKS_AT", "IS_CEO_OF", "IS_CTO_OF", "IS_BOARD_MEMBER_OF"].includes(e.field) && e.entityId !== input.companyId && !e.field.startsWith("portfolio")));
  const funding = ev.filter((e) => ["funding_round", "participants", "investor_in_target"].includes(e.field));
  const network = ev.filter((e) => ["portfolio", "shared_investors"].includes(e.field));
  const sections = [
    { title: "Company", claims: company.map(fact) },
    { title: "Team", claims: team.slice(0, 12).map(fact) },
    { title: "Funding & investors", claims: funding.map(fact) },
    { title: "Investor network", claims: network.slice(0, 8).map(fact) },
    { title: "On the web (leads to check)", claims: web.slice(0, 8).map((e) => ({ ...fact(e), text: `${e.entityName}: ${e.value}` })) },
    { title: "Your notes", claims: input.notes.map((n) => ({ text: n.text, kind: "note" as const, evidence: [], notes: [n.id] })) },
  ].filter((s) => s.claims.length);
  const compIds = new Set(ev.filter((e) => e.entityId !== input.companyId).map((e) => e.entityId));
  const comparables = [...compIds]
    .map((id) => ev.filter((e) => e.entityId === id))
    .filter((list) => list.some((e) => e.field === "description") && list.some((e) => ["company_ownership_status", "operational_status", "funding_stage"].includes(e.field)))
    .slice(0, 3)
    .map((list) => ({
      name: list[0].entityName,
      entityId: list[0].entityId,
      whyRelevant: list.find((e) => e.field === "description")!.value,
      differences: list.filter((e) => ["company_ownership_status", "operational_status", "funding_stage", "founding_date", "total_funding"].includes(e.field)).map((e) => `${e.label}: ${e.value}`).join(" · "),
      raisesQuestion: "",
      evidence: list.map((e) => e.id).slice(0, 5),
    }));
  return {
    headline: `What Cala's public data shows about ${input.companyName}, with sources.`,
    sections,
    comparables,
    gaps: input.gaps.map((g) => ({ title: g.title, whyItMatters: g.why, actions: [], helpers: [], expertTypes: [] })),
    questions: input.notes.filter((n) => n.kind === "question").map((n) => n.text),
    generatedBy: "rules",
  };
}
