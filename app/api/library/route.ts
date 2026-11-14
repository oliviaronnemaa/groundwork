import { NextResponse } from "next/server";
import { deleteRecord, readLibrary, upsertRecord } from "@/lib/library";
import type { LibraryRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await readLibrary());
}

export async function POST(req: Request) {
  const rec = (await req.json()) as LibraryRecord;
  if (!rec?.id || !rec?.name || !rec?.type) return NextResponse.json({ error: "id, name and type are required" }, { status: 400 });
  return NextResponse.json(await upsertRecord(rec));
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return NextResponse.json(await deleteRecord(id));
}
