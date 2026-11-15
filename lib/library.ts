import "server-only";
import { readDoc, writeDoc } from "./store";
import type { LibraryRecord } from "./types";

export async function readLibrary(): Promise<LibraryRecord[]> {
  return readDoc<LibraryRecord[]>("library", []);
}

async function write(list: LibraryRecord[]) {
  await writeDoc("library", list);
}

export async function upsertRecord(rec: LibraryRecord) {
  const list = await readLibrary();
  const i = list.findIndex((r) => r.id === rec.id);
  const now = new Date().toISOString();
  if (i >= 0) list[i] = { ...list[i], ...rec, savedAt: list[i].savedAt, updatedAt: now };
  else list.unshift({ ...rec, savedAt: now, updatedAt: now });
  await write(list);
  return list;
}

/** Save several records in one write, so a research save and its profiles can't race each other. */
export async function upsertMany(recs: LibraryRecord[]) {
  const list = await readLibrary();
  const now = new Date().toISOString();
  for (const rec of recs) {
    const i = list.findIndex((r) => r.id === rec.id);
    if (i >= 0) list[i] = { ...list[i], ...rec, savedAt: list[i].savedAt, updatedAt: now };
    else list.unshift({ ...rec, savedAt: now, updatedAt: now });
  }
  await write(list);
  return list;
}

export async function deleteRecord(id: string) {
  const list = (await readLibrary()).filter((r) => r.id !== id);
  await write(list);
  return list;
}
