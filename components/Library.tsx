"use client";
import { useEffect, useState } from "react";
import type { LibraryField, LibraryRecord } from "@/lib/types";
import BriefView from "./BriefView";
import Inspector, { type Selection } from "./Inspector";
import { Sources } from "./ui";
import type { NotesApi } from "./App";
import { NoteCard, NoteComposer } from "./NotesView";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "company", label: "Companies" },
  { id: "person", label: "People" },
  { id: "investor", label: "Investors" },
  { id: "research", label: "Research" },
] as const;

const PROV = { cala: { t: "Cala", c: "fact" }, note: { t: "Your observation", c: "note" }, ai: { t: "AI hypothesis", c: "interpretation" } } as const;

export default function Library({
  library,
  openId,
  setOpenId,
  onSave,
  onDelete,
  notesApi,
  onOpenNotes,
}: {
  notesApi: NotesApi;
  onOpenNotes: (id: string) => void;
  library: LibraryRecord[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onSave: (r: LibraryRecord) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  const list = library.filter((r) => filter === "all" || r.type === filter);
  const rec = library.find((r) => r.id === openId) ?? list[0];

  return (
    <div className="lib">
      <div className="lib-list">
        <div className="lib-filter">
          {FILTERS.map((f) => {
            const n = f.id === "all" ? library.length : library.filter((r) => r.type === f.id).length;
            return (
              <button key={f.id} className={`btn small ${filter === f.id ? "primary" : "ghost"}`} onClick={() => setFilter(f.id)}>
                {f.label} {n ? n : ""}
              </button>
            );
          })}
        </div>
        {list.length === 0 && <div className="empty small">Nothing saved yet. Open a company or person on the research map and choose “Save to library”.</div>}
        {list.map((r) => (
          <div key={r.id} className={`lib-item ${rec?.id === r.id ? "sel" : ""}`} onClick={() => setOpenId(r.id)}>
            <b>{r.name}</b>
            <span className="muted tiny">{r.type} · updated {new Date(r.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
          </div>
        ))}
      </div>
      <div className="lib-detail">{rec ? <Record key={rec.id} rec={rec} onSave={onSave} onDelete={onDelete} notesApi={notesApi} onOpenNotes={onOpenNotes} /> : <div className="empty">Your library builds up as you research: companies, people, investors and saved briefs, with their sources.</div>}</div>
    </div>
  );
}

function Record({
  rec,
  onSave,
  onDelete,
  notesApi,
  onOpenNotes,
}: {
  rec: LibraryRecord;
  onSave: (r: LibraryRecord) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
  notesApi: NotesApi;
  onOpenNotes: (id: string) => void;
}) {
  const linked = notesApi.notes.filter((n) => n.links.some((l) => l.id === rec.id)).sort((a, b) => b.at - a.at);
  const [notes, setNotes] = useState(rec.notes);
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const [sel, setSel] = useState<Selection>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => setNotes(rec.notes), [rec.notes]);

  const addField = async () => {
    if (!label.trim() || !value.trim()) return;
    const f: LibraryField = { label: label.trim(), value: value.trim(), provenance: "note" };
    await onSave({ ...rec, fields: [...rec.fields, f] });
    setLabel("");
    setValue("");
  };

  if (rec.type === "research" && rec.brief) {
    const run = { calls: [], nodes: [], edges: [], evidence: rec.evidence ?? [], helpers: rec.helpers ?? [] };
    return (
      <div style={{ display: "grid", gridTemplateColumns: sel ? "1fr 360px" : "1fr", minHeight: "100%" }}>
        <div>
          <div className="lib-inner" style={{ paddingBottom: 0 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="badge">Saved research</span>
              <button className="btn ghost small danger" onClick={() => confirm("Delete this saved research?") && onDelete(rec.id)}>Delete</button>
            </div>
            <p className="muted" style={{ marginBottom: 0 }}>“{rec.question}”</p>
            {rec.notes && <div className="note" style={{ marginTop: 10 }}>{rec.notes}</div>}
          </div>
          <BriefView brief={rec.brief} evidence={rec.evidence ?? []} notes={rec.notesList ?? []} helpers={rec.helpers ?? []} sel={sel} onSelect={setSel} factCount={rec.evidence?.length ?? 0} readOnly />
        </div>
        {sel && <Inspector sel={sel} onClose={() => setSel(null)} onSelect={setSel} run={run} notes={rec.notesList ?? []} library={[]} />}
      </div>
    );
  }

  return (
    <div className="lib-inner">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="badge">{rec.type}</span>
        <button className="btn ghost small danger" onClick={() => confirm(`Delete ${rec.name} from your library?`) && onDelete(rec.id)}>Delete</button>
      </div>
      <h2 style={{ marginTop: 10 }}>{rec.name}</h2>
      <div className="muted tiny">Saved {new Date(rec.savedAt).toLocaleString("en-GB")} · Cala id {rec.id.slice(0, 8)}</div>
      <table className="fields">
        <tbody>
          {rec.fields.map((f, i) => (
            <tr key={i}>
              <td>
                {f.label}
                <div><span className={`kind ${PROV[f.provenance].c}`}>{PROV[f.provenance].t}</span></div>
              </td>
              <td>
                {f.value}
                {f.provenance === "cala" && <Sources sources={f.sources ?? []} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="label" style={{ marginBottom: 6 }}>Add your own field</div>
      <div className="row wrap" style={{ marginBottom: 22 }}>
        <input className="field" style={{ flex: "1 1 180px" }} placeholder="e.g. Relevant manufacturing experience" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="field" style={{ flex: "2 1 240px" }} placeholder="What you observed" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addField()} />
        <button className="btn" onClick={addField} disabled={!label.trim() || !value.trim()}>Add</button>
      </div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
        <span className="label">Your notes on {rec.name} ({linked.length})</span>
        {linked.length > 0 && <button className="btn ghost small" onClick={() => onOpenNotes(rec.id)}>Open in Notes →</button>}
      </div>
      <div className="facts" style={{ marginBottom: 10 }}>
        {linked.map((n) => <NoteCard key={n.id} note={n} api={notesApi} />)}
      </div>
      <div className="card" style={{ padding: 12, marginBottom: 24 }}>
        <NoteComposer
          api={notesApi}
          ctx={{ primary: { id: rec.id, name: rec.name, kind: rec.type === "person" ? "person" : rec.type === "investor" ? "investor" : "company" }, candidates: [] }}
          compact
          placeholder={`Add a note about ${rec.name}…`}
        />
      </div>
      <div className="label" style={{ marginBottom: 6 }}>Record summary</div>
      <textarea className="field" rows={5} value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true); }} placeholder="Private notes on this record" />
      <div className="row" style={{ justifyContent: "flex-end", marginTop: 8 }}>
        <button className="btn small" disabled={!dirty} onClick={async () => { await onSave({ ...rec, notes }); setDirty(false); }}>Save notes</button>
      </div>
    </div>
  );
}
