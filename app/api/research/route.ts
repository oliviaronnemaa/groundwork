import { runFounders, runResearch } from "@/lib/research";
import type { ResearchEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: Request) {
  const key = process.env.CALA_API_KEY;
  const body = (await req.json()) as { companyId?: string; question?: string; founders?: string[]; idea?: string; name?: string };
  const { companyId, question } = body;
  if (!key) return Response.json({ error: "CALA_API_KEY is not set" }, { status: 500 });
  const founders = Array.isArray(body.founders) ? body.founders.map((f) => String(f).trim()).filter(Boolean).slice(0, 4) : [];
  if (!founders.length && (!companyId || !/^[0-9a-f-]{36}$/i.test(companyId))) return Response.json({ error: "A Cala company id or founder names are required" }, { status: 400 });

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (e: ResearchEvent) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        if (founders.length) await runFounders({ key, exaKey: process.env.EXA_API_KEY || undefined, founders, idea: String(body.idea ?? "").slice(0, 400), name: String(body.name ?? "").slice(0, 80), emit });
        else await runResearch({ key, companyId: companyId!, question: question ?? "", emit });
      } catch (e) {
        emit({ type: "fatal", message: e instanceof Error ? e.message : String(e) });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
