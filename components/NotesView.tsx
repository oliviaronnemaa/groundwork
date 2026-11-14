"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Note, NoteKind, NoteLink } from "@/lib/types";
import type { NotesApi } from "./App";
import { KIND_COLOR } from "./ui";

export const NOTE_KINDS: { id: NoteKind; label: string; hint: string }[] = [
  { id: "observation", label: "Observation", hint: "Something you noticed" },
  { id: "meeting", label: "Meeting", hint: "From a founder call or meeting" },
  { id: "reference", label: "Reference", hint: "What someone else told you" },
  { id: "question", label: "Question to ask", hint: "Goes into the brief's founder questions" },
  { id: "hunch", label: "Hunch", hint: "A gut feeling to test" },
];
export const kindLabel = (k: NoteKind) => NOTE_KINDS.find((x) => x.id === k)?.label ?? k;

/** Context the composer can use to link a note to what you're looking at. */
export type NoteContext = {
  sessionId?: string;
  sessionLabel?: string;
  primary?: NoteLink; // e.g. the company being researched, or the open profile
  candidates: NoteLink[]; // entities a note can be auto-linked to by name
};

// ---------------------------------------------------------------------------
// Linking

function norm(s: string) {
  return s.toLowerCase().replace(/\b(oy|ab|inc|ltd|gmbh|oyj|llc|corp|limited|plc)\b\.?/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** Link a note to every known entity whose name (or a person's surname) appears in it. */
export function autoLink(text: string, candidates: NoteLink[]): NoteLink[] {
  const t = ` ${norm(text)} `;
  const out: NoteLink[] = [];
  for (const c of candidates) {
    const n = norm(c.name);
    if (n.length < 3) continue;
    const parts = n.split(" ");
    const hit = t.includes(` ${n} `) || (c.kind === "person" && parts.length > 1 && parts[parts.length - 1].length > 3 && t.includes(` ${parts[parts.length - 1]} `));
    if (hit && !out.some((o) => o.id === c.id)) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dictation

type SpeechRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: (ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  onerror: () => void;
  start: () => void;
  stop: () => void;
};

export function useDictation(value: string, setValue: (s: string) => void) {
  const [listening, setListening] = useState(false);
  const [supported, setSupported] = useState(false);
  const [used, setUsed] = useState(false);
  const rec = useRef<SpeechRec | null>(null);
  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
    return () => rec.current?.stop();
  }, []);
  const toggle = () => {
    if (listening) return rec.current?.stop();
    const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-US";
    r.interimResults = true;
    r.continuous = true;
    const base = value ? value.trimEnd() + " " : "";
    r.onresult = (ev) => {
      let s = "";
      for (let i = 0; i < ev.results.length; i++) s += ev.results[i][0].transcript;
      setValue(base + s);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    r.start();
    rec.current = r;
    setListening(true);
    setUsed(true);
  };
  return { listening, supported, toggle, used, reset: () => setUsed(false) };
}

export function MicIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Composer (used in the Notes space, quick capture, research rail and profiles)

export function NoteComposer({
  api,
  ctx,
  compact,
  autoFocus,
  onDone,
  placeholder,
}: {
  api: NotesApi;
  ctx: NoteContext;
  compact?: boolean;
  autoFocus?: boolean;
  onDone?: (n: Note) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<NoteKind>("observation");
  const [extra, setExtra] = useState<NoteLink[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const dict = useDictation(text, setText);

  const links = useMemo(() => {
    const auto = autoLink(text, ctx.candidates);
    const all = [...(ctx.primary ? [ctx.primary] : []), ...auto, ...extra];
    const seen = new Set<string>();
    return all.filter((l) => !removed.has(l.id) && !seen.has(l.id) && seen.add(l.id));
  }, [text, ctx, extra, removed]);

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true);
    const n = await api.add({ text, kind, links, sessionId: ctx.sessionId, sessionLabel: ctx.sessionLabel, source: dict.used ? "voice" : "typed" });
    setBusy(false);
    if (n) {
      setText("");
      setExtra([]);
      setRemoved(new Set());
      setKind("observation");
      dict.reset();
      onDone?.(n);
    }
  }

  const addTag = () => {
    const t = tag.trim();
    if (!t) return;
    const known = ctx.candidates.find((c) => norm(c.name) === norm(t));
    setExtra((x) => [...x, known ?? { id: `tag:${norm(t)}`, name: t, kind: "tag" }]);
    setTag("");
  };

  return (
    <form
      className={`composer-note ${compact ? "compact" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        className="field"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? "What you heard from the founders, a reference call, a hunch…"}
        rows={compact ? 2 : 3}
        autoFocus={autoFocus}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (compact ? !e.shiftKey : e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {(!compact || text.trim()) && <div className="kinds">
        {NOTE_KINDS.map((k) => (
          <button type="button" key={k.id} className={`kchip k-${k.id} ${kind === k.id ? "on" : ""}`} title={k.hint} onClick={() => setKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>}
      {(!compact || text.trim()) && <div className="links-row">
        <span className="tiny muted">About</span>
        {links.map((l) => (
          <span key={l.id} className="link-chip" style={{ borderColor: l.kind && l.kind !== "tag" ? KIND_COLOR[l.kind] : undefined }}>
            {l.name}
            <button type="button" aria-label={`Unlink ${l.name}`} onClick={() => setRemoved((r) => new Set(r).add(l.id))}>×</button>
          </span>
        ))}
        <input
          className="tag-input"
          list="note-candidates"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTag();
            }
          }}
          placeholder={links.length ? "+ link" : "Link a company or person"}
        />
        <datalist id="note-candidates">
          {ctx.candidates.slice(0, 60).map((c) => <option key={c.id} value={c.name} />)}
        </datalist>
      </div>}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button type="button" className={`btn small mic ${dict.listening ? "on" : ""}`} onClick={dict.toggle} disabled={!dict.supported} title={dict.supported ? "Dictate" : "Voice input isn't supported in this browser"} aria-label="Dictate">
          <MicIcon />
        </button>
        <span className="tiny muted">{dict.listening ? "Listening… click the mic to stop" : compact ? "↵ to save" : "⌘↵ to save"}</span>
        <button className="btn small primary" disabled={!text.trim() || busy}>Save note</button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Note card

export function NoteCard({
  note,
  api,
  onLinkClick,
  showSession = true,
}: {
  note: Note;
  api: NotesApi;
  onLinkClick?: (l: NoteLink) => void;
  showSession?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.text);
  const time = new Date(note.at);
  return (
    <article className={`ncard k-${note.kind}`}>
      <header>
        <span className={`kchip k-${note.kind} on static`}>{kindLabel(note.kind)}</span>
        <span className="tiny muted">
          {note.id} · {time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
          {note.source === "voice" ? " · dictated" : ""}
          {showSession && note.sessionLabel ? ` · during research on ${note.sessionLabel}` : ""}
        </span>
        <span className="spacer" />
        <button className="btn ghost small" onClick={() => setEditing((e) => !e)}>{editing ? "Cancel" : "Edit"}</button>
        <button className="btn ghost small danger" onClick={() => confirm("Delete this note?") && api.remove(note.id)}>Delete</button>
      </header>
      {editing ? (
        <div>
          <textarea className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="row" style={{ justifyContent: "space-between", marginTop: 6 }}>
            <select className="field" style={{ width: "auto" }} value={note.kind} onChange={(e) => api.update(note.id, { kind: e.target.value as NoteKind })}>
              {NOTE_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
            <button className="btn small primary" onClick={async () => { await api.update(note.id, { text: text.trim() }); setEditing(false); }} disabled={!text.trim()}>Save</button>
          </div>
        </div>
      ) : (
        <p className="ntext">{note.text}</p>
      )}
      <footer>
        {note.links.map((l) => (
          <button key={l.id} className="link-chip" style={{ borderColor: l.kind && l.kind !== "tag" ? KIND_COLOR[l.kind] : undefined }} onClick={() => onLinkClick?.(l)}>
            {l.name}
          </button>
        ))}
        {!note.links.length && <span className="tiny muted">Not linked to anything</span>}
        <span className="spacer" />
        {note.citedIn?.length ? <span className="kind note" title={note.citedIn.join("\n")}>Cited in {note.citedIn.length} brief{note.citedIn.length > 1 ? "s" : ""}</span> : null}
        <label className="ai-toggle" title="Excluded notes are never sent to Claude. Notes are never sent to Cala either way.">
          <input type="checkbox" checked={!note.aiExcluded} onChange={(e) => api.update(note.id, { aiExcluded: !e.target.checked })} />
          {note.aiExcluded ? "Kept out of AI" : "Used in briefs"}
        </label>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// The Notes space

export default function NotesView({ api, filter, setFilter }: { api: NotesApi; filter: string | null; setFilter: (id: string | null) => void }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<NoteKind | "all">("all");
  const { notes } = api;

  const entities = useMemo(() => {
    const m = new Map<string, NoteLink & { count: number }>();
    for (const n of notes) for (const l of n.links) {
      const e = m.get(l.id) ?? { ...l, count: 0 };
      e.count++;
      m.set(l.id, e);
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [notes]);

  const shown = notes
    .filter((n) => (filter ? n.links.some((l) => l.id === filter) : true))
    .filter((n) => kind === "all" || n.kind === kind)
    .filter((n) => !q.trim() || `${n.text} ${n.links.map((l) => l.name).join(" ")} ${n.sessionLabel ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.at - a.at);

  const groups = new Map<string, Note[]>();
  for (const n of shown) {
    const d = new Date(n.at);
    const key = sameDay(d, new Date()) ? "Today" : sameDay(d, new Date(Date.now() - 864e5)) ? "Yesterday" : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const active = entities.find((e) => e.id === filter);
  const questions = notes.filter((n) => n.kind === "question" && (!filter || n.links.some((l) => l.id === filter)));

  return (
    <div className="nspace">
      <aside className="nside">
        <input className="field" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="label" style={{ margin: "16px 0 6px" }}>Type</div>
        <div className="nfilters">
          <button className={kind === "all" ? "on" : ""} onClick={() => setKind("all")}>All notes <span>{notes.length}</span></button>
          {NOTE_KINDS.map((k) => {
            const c = notes.filter((n) => n.kind === k.id).length;
            return c ? <button key={k.id} className={kind === k.id ? "on" : ""} onClick={() => setKind(k.id)}>{k.label} <span>{c}</span></button> : null;
          })}
        </div>
        <div className="label" style={{ margin: "16px 0 6px" }}>About</div>
        <div className="nfilters">
          <button className={!filter ? "on" : ""} onClick={() => setFilter(null)}>Everything</button>
          {entities.map((e) => (
            <button key={e.id} className={filter === e.id ? "on" : ""} onClick={() => setFilter(e.id)}>
              <i style={{ background: e.kind && e.kind !== "tag" ? KIND_COLOR[e.kind] : "var(--faint)" }} />
              {e.name} <span>{e.count}</span>
            </button>
          ))}
          {!entities.length && <div className="tiny muted" style={{ padding: "4px 8px" }}>Notes you link to companies and people show up here.</div>}
        </div>
      </aside>
      <main className="nmain">
        <div className="nhead">
          <h1>{active ? `Notes on ${active.name}` : "Your notes"}</h1>
          <p className="muted">Private. Kept in Groundwork, never sent to Cala. Notes marked “Used in briefs” are given to Claude when it writes a brief on what they're about.</p>
        </div>
        <div className="card" style={{ padding: 14, marginBottom: 24 }}>
          <NoteComposer
            api={api}
            ctx={{ primary: active ? { id: active.id, name: active.name, kind: active.kind } : undefined, candidates: entities }}
            placeholder={active ? `Add a note about ${active.name}…` : undefined}
          />
        </div>
        {questions.length > 0 && kind !== "question" && (
          <div className="qbox">
            <div className="label">Open questions {active ? `for ${active.name}` : ""}</div>
            <ul>{questions.map((n) => <li key={n.id}>{n.text}</li>)}</ul>
          </div>
        )}
        {[...groups.entries()].map(([day, list]) => (
          <section key={day} className="nday">
            <h3>{day}</h3>
            {list.map((n) => <NoteCard key={n.id} note={n} api={api} onLinkClick={(l) => setFilter(l.id)} />)}
          </section>
        ))}
        {!shown.length && (
          <div className="empty">
            {notes.length ? "No notes match." : "No notes yet. Add one above, press N anywhere, or jot things down while research runs."}
          </div>
        )}
      </main>
    </div>
  );
}

function sameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

// ---------------------------------------------------------------------------
// Quick capture (N anywhere)

let quickCtx: NoteContext = { candidates: [] };
/** Research sets this so a quick note links to whatever is on screen. */
export function setQuickCaptureContext(c: NoteContext) {
  quickCtx = c;
}

export function QuickCapture({ api, onClose }: { api: NotesApi; onClose: () => void }) {
  const [saved, setSaved] = useState<Note | null>(null);
  const known = useMemo(() => {
    const m = new Map<string, NoteLink>();
    for (const c of quickCtx.candidates) m.set(c.id, c);
    for (const n of api.notes) for (const l of n.links) if (!m.has(l.id)) m.set(l.id, l);
    return [...m.values()];
  }, [api.notes]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="New note">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>New note{quickCtx.primary ? ` · ${quickCtx.primary.name}` : ""}</h3>
          <button className="btn ghost small" onClick={onClose}>Esc</button>
        </div>
        {saved && <div className="tiny" style={{ color: "var(--ok)", marginBottom: 8 }}>Saved {saved.id}. Add another or press Esc.</div>}
        <NoteComposer api={api} ctx={{ ...quickCtx, candidates: known }} autoFocus onDone={setSaved} />
      </div>
    </div>
  );
}
