"use client";
import { useCallback, useEffect, useState } from "react";
import type { LibraryRecord, Note } from "@/lib/types";
import Research, { type ResearchInfo } from "./Research";
import Library from "./Library";
import SourcesView from "./SourcesView";
import NotesView, { QuickCapture } from "./NotesView";
import { colorFor, Icon } from "./ui";
import Onboarding, { hasSeenOnboarding } from "./Onboarding";

export type Status = { cala: boolean; exa?: boolean; claude: boolean; model: string } | null;

export type NotesApi = {
  notes: Note[];
  add: (n: Partial<Note> & { text: string }) => Promise<Note | null>;
  update: (id: string, patch: Partial<Note>) => Promise<void>;
  remove: (id: string) => Promise<void>;
};

type View = "research" | "notes" | "library" | "sources";

export default function App() {
  const [view, setView] = useState<View>("research");
  const [status, setStatus] = useState<Status>(null);
  const [library, setLibrary] = useState<LibraryRecord[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [capture, setCapture] = useState(false);
  const [guide, setGuide] = useState(false);
  useEffect(() => {
    if (!hasSeenOnboarding()) setGuide(true);
  }, []);
  const [noteFilter, setNoteFilter] = useState<string | null>(null);
  const [info, setInfo] = useState<ResearchInfo>({ stage: "ask", name: null, tab: "desk", running: false, hasBrief: false, queries: 0 });
  const [nav, setNav] = useState<{ tab?: "desk" | "brief"; home?: number }>({});

  const refresh = useCallback(async () => {
    try {
      const [lib, ns] = await Promise.all([fetch("/api/library").then((r) => r.json()), fetch("/api/notes").then((r) => r.json())]);
      setLibrary(lib);
      setNotes(ns);
    } catch {}
  }, []);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ cala: false, claude: false, model: "" }));
    refresh();
  }, [refresh]);

  // "n" anywhere outside a text field opens quick capture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !/INPUT|TEXTAREA|SELECT/.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setCapture(true);
      }
      if (e.key === "Escape") setCapture(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const notesApi: NotesApi = {
    notes,
    add: async (n) => {
      const res = await fetch("/api/notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(n) });
      if (!res.ok) return null;
      const d = (await res.json()) as { list: Note[]; note: Note };
      setNotes(d.list);
      return d.note;
    },
    update: async (id, patch) => {
      setNotes((list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));
      const res = await fetch("/api/notes", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...patch }) });
      if (res.ok) setNotes(await res.json());
    },
    remove: async (id) => {
      const res = await fetch(`/api/notes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.ok) setNotes(await res.json());
    },
  };

  const save = async (rec: LibraryRecord) => {
    const res = await fetch("/api/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) });
    if (res.ok) setLibrary(await res.json());
    return res.ok;
  };

  const openNotesFor = (linkId: string) => {
    setNoteFilter(linkId);
    setView("notes");
  };

  const research = library.filter((r) => r.type === "research");
  const inRun = info.stage === "run" && info.name;

  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Navigation">
        <div className="brand">
          <span className="tile" style={{ width: 26, height: 26, borderRadius: 8, background: "var(--green)", boxShadow: "0 2px 0 var(--green-dark)" }}>
            <Icon name="search" size={14} color="#fff" stroke={3} />
          </span>
          <b>Groundwork</b>
        </div>
        <div className="sb-group">
          <button
            className={`sb-item ${view === "research" && !inRun ? "on" : ""}`}
            onClick={() => {
              setView("research");
              setNav({ home: Date.now() });
            }}
          >
            <Icon name="home" size={16} /> New research
          </button>
          <button className={`sb-item ${view === "notes" ? "on" : ""}`} onClick={() => { setNoteFilter(null); setView("notes"); }}>
            <Icon name="note" size={16} /> Notes{notes.length ? <span className="n">{notes.length}</span> : null}
          </button>
          <button className={`sb-item ${view === "library" ? "on" : ""}`} onClick={() => setView("library")}>
            <Icon name="library" size={16} /> Library{library.length ? <span className="n">{library.length}</span> : null}
          </button>
          <button className={`sb-item ${view === "sources" ? "on" : ""}`} onClick={() => setView("sources")}>
            <Icon name="globe" size={16} /> Sources
          </button>
          <button className="sb-item" onClick={() => setGuide(true)}>
            <Icon name="help" size={16} /> How it works
          </button>
        </div>

        <div className="sb-group">
          <span className="sb-head">Research</span>
          {inRun && (
            <>
              <button className={`sb-item ${view === "research" ? "on" : ""}`} onClick={() => setView("research")}>
                <span className="tile" style={{ width: 20, height: 20, fontSize: 11, background: colorFor(info.name!) }}>{info.name!.charAt(0).toUpperCase()}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info.name}</span>
                {info.running && <span className="dot run" style={{ marginLeft: "auto" }} />}
              </button>
              <button className={`sb-item sb-sub ${view === "research" && info.tab === "desk" ? "on" : ""}`} onClick={() => { setView("research"); setNav({ tab: "desk" }); }}>Desk</button>
              <button className={`sb-item sb-sub ${view === "research" && info.tab === "brief" ? "on" : ""}`} onClick={() => { setView("research"); setNav({ tab: "brief" }); }}>Brief</button>
            </>
          )}
          {research.slice(0, 6).map((r) => (
            <button key={r.id} className="sb-item" onClick={() => { setOpenId(r.id); setView("library"); }}>
              <span className="tile" style={{ width: 20, height: 20, fontSize: 11, background: colorFor(r.name) }}>{r.name.charAt(0).toUpperCase()}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name.split(" — ")[0]}</span>
            </button>
          ))}
          {!inRun && research.length === 0 && <span className="sb-item" style={{ color: "var(--faint)", cursor: "default" }}>Nothing yet</span>}
        </div>

        <span className="spacer" />
        <div className="sb-foot" title="Every company, person and round comes from Cala's API">
          <span className={`dot ${status?.cala ? "ok" : status ? "err" : ""}`} />
          {status?.cala ? `Cala connected${info.queries ? ` · ${info.queries} lookups` : ""}` : status ? "Cala not configured" : "Checking…"}
        </div>
      </aside>

      <main className="content">
        <div style={{ display: view === "research" ? "flex" : "none", flex: 1, flexDirection: "column", minHeight: "100vh" }}>
          <Research status={status} library={library} onSave={save} notesApi={notesApi} onOpenNotes={openNotesFor} onInfo={setInfo} nav={nav} />
        </div>
        {view === "notes" && <NotesView api={notesApi} filter={noteFilter} setFilter={setNoteFilter} />}
        {view === "library" && (
          <Library
            library={library}
            openId={openId}
            setOpenId={setOpenId}
            onSave={save}
            notesApi={notesApi}
            onOpenNotes={openNotesFor}
            onDelete={async (id) => {
              const res = await fetch(`/api/library?id=${encodeURIComponent(id)}`, { method: "DELETE" });
              if (res.ok) setLibrary(await res.json());
            }}
          />
        )}
        {view === "sources" && <SourcesView status={status} queries={info.queries} />}
      </main>

      <button className="fab" onClick={() => setCapture(true)} title="New note (N)">
        <span style={{ width: 14, height: 14, borderRadius: 3, background: "#fff6cf", boxShadow: "0 2px 0 var(--sun-edge)" }} /> Note
      </button>
      {capture && <QuickCapture api={notesApi} onClose={() => setCapture(false)} />}
      {guide && <Onboarding onClose={() => setGuide(false)} />}
    </div>
  );
}
