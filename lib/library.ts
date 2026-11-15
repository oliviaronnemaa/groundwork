import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { LibraryRecord } from "./types";

const FILE = path.join(process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "data"), "library.json");

export async function readLibrary(): Promise<LibraryRecord[]> {
  try {
    return JSON.parse(await fs.readFile(FILE, "utf8"));
  } catch {
    return [];
  }
}

async function write(list: LibraryRecord[]) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE + ".tmp", JSON.stringify(list, null, 2));
  await fs.rename(FILE + ".tmp", FILE);
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
