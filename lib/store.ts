import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";

// One tiny key–value table in Postgres (Neon) when DATABASE_URL is set; JSON files in ./data otherwise.
// Locally nothing changes. On Vercel, the filesystem doesn't persist, so a database is needed there.

const URL_ = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
const sql = URL_ ? neon(URL_) : null;
export const hasDb = !!sql;

let ready: Promise<void> | null = null;
function init() {
  if (!sql) return Promise.resolve();
  ready ??= sql`create table if not exists gw_kv (k text primary key, v jsonb not null, at timestamptz not null default now())`.then(() => undefined);
  return ready;
}

const DIR = process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "data");

/** A whole document (the library, the notes). */
export async function readDoc<T>(name: string, fallback: T): Promise<T> {
  if (sql) {
    await init();
    const rows = (await sql`select v from gw_kv where k = ${"doc:" + name}`) as { v: T }[];
    return rows[0]?.v ?? fallback;
  }
  try {
    return JSON.parse(await fs.readFile(path.join(DIR, name + ".json"), "utf8"));
  } catch {
    return fallback;
  }
}

export async function writeDoc(name: string, value: unknown) {
  if (sql) {
    await init();
    await sql`insert into gw_kv (k, v, at) values (${"doc:" + name}, ${JSON.stringify(value)}::jsonb, now())
              on conflict (k) do update set v = excluded.v, at = now()`;
    return;
  }
  const file = path.join(DIR, name + ".json");
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify(value, null, 2));
  await fs.rename(file + ".tmp", file);
}

/** One cached API response. Returns null when missing or older than ttlMs. Only used with a database. */
export async function cacheGet<T>(key: string, ttlMs: number): Promise<T | null> {
  if (!sql) return null;
  await init();
  const rows = (await sql`select v, at from gw_kv where k = ${"cache:" + key}`) as { v: T; at: string }[];
  if (!rows[0] || Date.now() - new Date(rows[0].at).getTime() > ttlMs) return null;
  return rows[0].v;
}

export async function cacheSet(key: string, value: unknown) {
  if (!sql) return;
  await init();
  await sql`insert into gw_kv (k, v, at) values (${"cache:" + key}, ${JSON.stringify(value)}::jsonb, now())
            on conflict (k) do update set v = excluded.v, at = now()`;
}
