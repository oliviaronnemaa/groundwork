import "server-only";
import { createHash } from "crypto";
import { cacheGet, cacheSet, hasDb } from "./store";
import { promises as fs } from "fs";
import path from "path";
import type { CallLog, CalaTool, Source } from "./types";

// ---------- Response cache (saves credits when re-running the same research) ----------
const CACHE_FILE = path.join(process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "data"), "cala-cache.json");
const TTL = 3 * 24 * 3600 * 1000;
let cache: Record<string, { at: number; data: unknown }> | null = null;
let cacheWrite: Promise<void> = Promise.resolve();
async function loadCache() {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(CACHE_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache!;
}
function persistCache() {
  cacheWrite = cacheWrite.then(async () => {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE + ".tmp", JSON.stringify(cache));
    await fs.rename(CACHE_FILE + ".tmp", CACHE_FILE);
  }).catch(() => {});
}
const useCache = process.env.CALA_CACHE !== "off";
const PREFIX = "cala:";
async function getCached<T>(key: string): Promise<T | null> {
  if (hasDb) return cacheGet<T>(PREFIX + createHash("sha1").update(key).digest("hex"), TTL).catch(() => null);
  const c = (await loadCache())[key];
  return c && Date.now() - c.at < TTL ? (c.data as T) : null;
}
async function putCached(key: string, data: unknown) {
  if (hasDb) return void (await cacheSet(PREFIX + createHash("sha1").update(key).digest("hex"), data).catch(() => {}));
  (await loadCache())[key] = { at: Date.now(), data };
  persistCache();
}


// When Cala rate-limits us, every request waits until this time.
let pausedUntil = 0;

// Pace requests to the account's rate limit (Starter plan: 10/min) instead of bursting into 429s.
const RPM = Math.max(1, Number(process.env.CALA_RPM) || 10);
const sent: number[] = [];
async function pace() {
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] > 60_000) sent.shift();
    if (sent.length < RPM) {
      sent.push(now);
      return;
    }
    await new Promise((r) => setTimeout(r, 60_000 - (now - sent[0]) + 50));
  }
}

const BASE = "https://api.cala.ai";

export class CalaError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

type Emit = (call: CallLog) => void;

/** Small promise pool so we don't hammer the API (and stay under rate limits). */
function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) await new Promise<void>((r) => queue.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

let seq = 0;

export class Cala {
  private run = limiter(4);
  public count = 0;

  constructor(private key: string, private emit: Emit) {}

  private async call<T>(
    stepId: string,
    tool: CalaTool,
    method: "GET" | "POST",
    path: string,
    body: unknown,
    summarize: (r: T) => string,
  ): Promise<{ data: T; callId: string }> {
    const id = `C${++seq}`;
    const log: CallLog = { id, stepId, tool, method, path, body, status: "running", startedAt: Date.now() };
    return this.run(async () => {
      const key = `${method} ${path} ${body === undefined ? "" : JSON.stringify(body)}`;
      if (useCache) {
        const hit = await getCached<T>(key);
        if (hit) {
          this.count++;
          this.emit({ ...log, status: "ok", ms: 0, cached: true, summary: safe(() => summarize(hit)) });
          return { data: hit, callId: id };
        }
      }
      this.emit({ ...log, startedAt: Date.now() });
      const t0 = Date.now();
      try {
        const data = await this.fetchWithRetry<T>(method, path, body, 0, (waitMs) =>
          this.emit({ ...log, status: "running", summary: `Rate limited by Cala, retrying in ${Math.round(waitMs / 1000)}s` }),
        );
        this.count++;
        if (useCache) await putCached(key, data);
        this.emit({ ...log, status: "ok", ms: Date.now() - t0, summary: safe(() => summarize(data)) });
        return { data, callId: id };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.emit({ ...log, status: "error", ms: Date.now() - t0, error: msg });
        throw e;
      }
    });
  }

  private async fetchWithRetry<T>(method: string, path: string, body: unknown, attempt = 0, onWait?: (ms: number) => void): Promise<T> {
    if (pausedUntil > Date.now()) await new Promise((r) => setTimeout(r, pausedUntil - Date.now()));
    await pace();
    const ctrl = new AbortController();
    // Knowledge search composes an answer server-side and can take a while.
    const timer = setTimeout(() => ctrl.abort(), path.startsWith("/v1/knowledge") ? 120_000 : 30_000);
    try {
      const res = await fetch(BASE + path, {
        method,
        headers: {
          "X-API-KEY": this.key,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: "no-store",
      });
      if (res.status === 429 && attempt < 6) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = ra > 0 ? ra * 1000 : Math.min(4000 * (attempt + 1), 15000);
        pausedUntil = Math.max(pausedUntil, Date.now() + wait);
        onWait?.(wait);
        await new Promise((r) => setTimeout(r, wait));
        return this.fetchWithRetry<T>(method, path, body, attempt + 1, onWait);
      }
      const text = await res.text();
      if (!res.ok) {
        let detail = text.slice(0, 300);
        try {
          const j = JSON.parse(text);
          detail = j.message || j.detail?.[0]?.msg || j.error || detail;
        } catch {}
        throw new CalaError(`Cala ${res.status}: ${detail}`, res.status);
      }
      return JSON.parse(text) as T;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new CalaError("Cala request timed out");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  search(stepId: string, name: string, types: string[] = [], limit = 8) {
    const qs = new URLSearchParams({ name, limit: String(limit) });
    for (const t of types) qs.append("entity_types", t);
    return this.call<{ entities: SearchHit[] }>(
      stepId,
      "entity_search",
      "GET",
      `/v1/entities?${qs}`,
      undefined,
      (r) => `${r.entities?.length ?? 0} match${r.entities?.length === 1 ? "" : "es"}${r.entities?.[0] ? ` · top: ${r.entities[0].name}` : ""}`,
    );
  }

  introspect(stepId: string, id: string) {
    return this.call<Introspection>(
      stepId,
      "entity_introspection",
      "GET",
      `/v1/entities/${id}/introspection`,
      undefined,
      (r) =>
        `${r.properties?.length ?? 0} properties · ${(r.relationships?.outgoing?.length ?? 0) + (r.relationships?.incoming?.length ?? 0)} relationship types`,
    );
  }

  retrieve(stepId: string, id: string, body: RetrieveBody) {
    return this.call<Entity>(stepId, "entity_retrieval", "POST", `/v1/entities/${id}`, body, (r) => {
      const props = Object.keys(r.properties ?? {}).filter((k) => k !== "id").length;
      const rels = countRels(r);
      return `${r.name ?? "entity"} · ${props} fields · ${rels} links`;
    });
  }

  knowledge(stepId: string, input: string) {
    return this.call<KnowledgeAnswer>(
      stepId,
      "knowledge_search",
      "POST",
      `/v1/knowledge/search`,
      { input, explainability: false, return_entities: true },
      (r) => `${r.context?.length ?? 0} sourced facts · ${r.entities?.length ?? 0} entities`,
    );
  }
}

function safe(fn: () => string) {
  try {
    return fn();
  } catch {
    return "ok";
  }
}

function countRels(r: Entity) {
  let n = 0;
  for (const dir of ["outgoing", "incoming"] as const) {
    for (const v of Object.values(r.relationships?.[dir] ?? {})) n += Array.isArray(v) ? v.length : 0;
  }
  return n;
}

// ---------- Response shapes (only what we use) ----------

export type SearchHit = { id: string; name: string; entity_type: string; description: string | null };

export type Introspection = {
  properties?: string[];
  relationships?: { outgoing?: string[]; incoming?: string[] };
  numerical_observations?: Record<string, { id: string; name?: string; code?: string; description?: string }[]>;
};

export type RawSource = {
  name?: string;
  document?: string | { endpoint?: string };
  date?: string;
  date_precision?: string;
  source_rank?: string;
};

export type Prop = { value: unknown; sources?: RawSource[] };

export type RelItem = {
  id: string;
  name: string;
  entity_type: string;
  properties?: Record<string, unknown> & { sources?: RawSource[] };
};

export type Entity = {
  id?: string;
  name?: string;
  entity_type?: string;
  description?: string | null;
  properties?: Record<string, Prop>;
  relationships?: { outgoing?: Record<string, RelItem[]>; incoming?: Record<string, RelItem[]> };
  numerical_observations?: unknown;
};

export type RetrieveBody = {
  properties?: string[];
  relationships?: {
    outgoing?: Record<string, { limit?: number; offset?: number }>;
    incoming?: Record<string, { limit?: number; offset?: number }>;
  };
  numerical_observations?: Record<string, string[]>;
};

export type KnowledgeAnswer = {
  content?: string;
  context?: { id: string; content: string; origins?: { source?: { name?: string; url?: string }; document?: { name?: string; url?: string } }[] }[];
  entities?: { id: string; name: string; entity_type: string; mentions?: string[] }[];
};

// ---------- Helpers ----------

export function normSources(raw?: RawSource[]): Source[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 6).map((s) => ({
    name: s.name,
    url: typeof s.document === "string" ? s.document : s.document?.endpoint,
    date: s.date ? fmtDate(s.date, s.date_precision) : undefined,
    rank: s.source_rank,
  }));
}

export function fmtDate(d: string, precision?: string) {
  if (!d) return d;
  if (precision === "year") return d.slice(0, 4);
  if (precision === "month") return d.slice(0, 7);
  return d.slice(0, 10);
}
