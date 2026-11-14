import { NextResponse } from "next/server";
import { createNote, deleteNote, readNotes, updateNote } from "@/lib/notes";
import type { Note } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readNotes());
}

export async function POST(req: Request) {
  const b = (await req.json()) as Partial<Note>;
  if (!b.text?.trim()) return NextResponse.json({ error: "text required" }, { status: 400 });
  const list = await createNote({
    text: b.text.trim().slice(0, 5000),
    kind: b.kind ?? "observation",
    links: Array.isArray(b.links) ? b.links.slice(0, 20) : [],
    sessionId: b.sessionId,
    sessionLabel: b.sessionLabel,
    source: b.source === "voice" ? "voice" : "typed",
    aiExcluded: !!b.aiExcluded,
    citedIn: [],
  });
  return NextResponse.json({ list, note: list[list.length - 1] });
}

export async function PATCH(req: Request) {
  const { id, ...patch } = (await req.json()) as Partial<Note> & { id: string };
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json(await updateNote(id, patch));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json(await deleteNote(id));
}
