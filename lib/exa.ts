import "server-only";
import { promises as fs } from "fs";
import path from "path";
import type { CallLog } from "./types";

// Exa: open-web search. Used for founders and ideas that are too new to be in Cala.
// Results are leads, not verified facts: a page may be about someone else with the same name.

export type ExaResult = {
  id?: string;
  title?: string | null;
  url: string;
  publishedDate?: string | null;
  author?: string | null;
  highlights?: string[];
  text?: string;
};

export type ExaSearch = {
  query: string;
  type?: "auto" | "lite" | "deep-lite" | "deep";
  numResults?: number;
  category?: "company" | "publication" | "news" | "personal site" | "financial report" | "people";
  includeDomains?: string[];
  excludeDomains?: string[];
  contents?: { highlights?: { query?: string; maxCharacters?: number }; text?: { maxCharacters?: number } };
};

const CACHE_FILE = path.join(process.env.VERCEL ? "/tmp" : path.join(process.cwd(), "data"), "exa-cache.json");
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
  cacheWrite = cacheWrite
    .then(async () => {
      await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
      await fs.writeFile(CACHE_FILE + ".tmp", JSON.stringify(cache));
      await fs.rename(CACHE_FILE + ".tmp", CACHE_FILE);
    })
    .catch(() => {});
}
const useCache = process.env.CALA_CACHE !== "off";

let seq = 0;
let active = 0;
const queue: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= 3) await new Promise<void>((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

export class Exa {
  public count = 0;
  constructor(private key: string, private emit: (call: CallLog) => void) {}

  async search(stepId: string, body: ExaSearch): Promise<{ data: { results: ExaResult[] }; callId: string }> {
    const id = `W${++seq}`;
    const log: CallLog = { id, stepId, tool: "web_search", provider: "exa", method: "POST", path: "/search", body, status: "running", startedAt: Date.now() };
    const summarize = (d: { results: ExaResult[] }) => `${d.results?.length ?? 0} web page${d.results?.length === 1 ? "" : "s"}`;
    return slot(async () => {
      const key = JSON.stringify(body);
      if (useCache) {
        const c = (await loadCache())[key];
        if (c && Date.now() - c.at < TTL) {
          this.count++;
          const data = c.data as { results: ExaResult[] };
          this.emit({ ...log, status: "ok", ms: 0, cached: true, summary: summarize(data) });
          return { data, callId: id };
        }
      }
      this.emit({ ...log, startedAt: Date.now() });
      const t0 = Date.now();
      try {
        const data = await this.post(body);
        this.count++;
        if (useCache) {
          (await loadCache())[key] = { at: Date.now(), data };
          persistCache();
        }
        this.emit({ ...log, status: "ok", ms: Date.now() - t0, summary: summarize(data) });
        return { data, callId: id };
      } catch (e) {
        this.emit({ ...log, status: "error", ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    });
  }

  private async post(body: ExaSearch, attempt = 0): Promise<{ results: ExaResult[] }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(`${process.env.EXA_BASE_URL || "https://api.exa.ai"}/search`, {
        method: "POST",
        headers: { "x-api-key": this.key, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
        cache: "no-store",
      });
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        return this.post(body, attempt + 1);
      }
      if (!res.ok) {
        let msg = `Exa ${res.status}`;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg += `: ${String(j.error).slice(0, 160)}`;
        } catch {}
        if (res.status === 402) msg = "Exa credits used up (402). Top up at dashboard.exa.ai/billing.";
        if (res.status === 401) msg = "Exa rejected the API key (401).";
        throw new Error(msg);
      }
      const data = (await res.json()) as { results?: ExaResult[] };
      return { results: Array.isArray(data.results) ? data.results : [] };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw new Error("Exa search timed out after 30s");
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function hostOf(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
