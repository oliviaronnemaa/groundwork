import "server-only";
import { readDoc, writeDoc } from "./store";
import type { Note } from "./types";

let queue: Promise<unknown> = Promise.resolve();

export async function readNotes(): Promise<Note[]> {
  return readDoc<Note[]>("notes", []);
}

/** Serialise writes so quick successive notes can't clobber each other. */
function mutate(fn: (list: Note[]) => Note[] | Promise<Note[]>): Promise<Note[]> {
  const next = queue.then(async () => {
    const list = await fn(await readNotes());
    await writeDoc("notes", list);
    return list;
  });
  queue = next.catch(() => {});
  return next;
}

export function createNote(n: Omit<Note, "id" | "at">) {
  return mutate((list) => {
    const max = list.reduce((m, x) => Math.max(m, Number(x.id.slice(1)) || 0), 0);
    return [...list, { ...n, id: `N${max + 1}`, at: Date.now() }];
  });
}

export function updateNote(id: string, patch: Partial<Note>) {
  return mutate((list) => list.map((n) => (n.id === id ? { ...n, ...patch, id: n.id, at: n.at } : n)));
}

export function deleteNote(id: string) {
  return mutate((list) => list.filter((n) => n.id !== id));
}
