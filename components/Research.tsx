"use client";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Brief, CallLog, Candidate, Claim, InterpretResult, LibraryRecord, ResearchEvent } from "@/lib/types";
import type { NotesApi, Status } from "./App";
import { NoteComposer, setQuickCaptureContext, useDictation, type NoteContext } from "./NotesView";
import GraphMap from "./GraphMap";
import BriefView from "./BriefView";
import Desk, { titleCase, type DeskRun } from "./Desk";
import Inspector, { type Selection } from "./Inspector";
import { colorFor, Icon, SaveModal, Spinner } from "./ui";

const SUGGESTIONS = [
  { t: "Prep a founder meeting", icon: "calendar", bg: "var(--blue-soft)", ink: "var(--blue)", q: "I'm meeting the founders of Aiven next week. Help me understand the team, who has backed them, and who I should talk to before the meeting." },
  { t: "Check a team's background", icon: "team", bg: "var(--green-soft)", ink: "var(--green)", q: "What have the founders of Oura done before, and what's still unknown about the team?" },
  { t: "Find who could help", icon: "help", bg: "var(--teal-soft)", ink: "var(--teal)", q: "Who could help me understand Wolt's early days, and what should I ask them?" },
];

export type ResearchInfo = { stage: "ask" | "confirm" | "run"; name: string | null; tab: "desk" | "brief"; running: boolean; hasBrief: boolean; queries: number };

const EMPTY: DeskRun = { steps: [], calls: [], nodes: [], edges: [], evidence: [], gaps: [], helpers: [], asks: [], done: false };

function reduce(s: DeskRun, e: ResearchEvent | { type: "reset" } | { type: "seed"; call: CallLog }): DeskRun {
  switch (e.type) {
    case "reset":
      return EMPTY;
    case "seed":
      return { ...s, calls: [e.call] };
    case "step": {
      const i = s.steps.findIndex((x) => x.id === e.step.id);
      return { ...s, steps: i < 0 ? [...s.steps, e.step] : s.steps.map((x, j) => (j === i ? e.step : x)) };
    }
    case "call": {
      const i = s.calls.findIndex((x) => x.id === e.call.id);
      return { ...s, calls: i < 0 ? [...s.calls, e.call] : s.calls.map((x, j) => (j === i ? e.call : x)) };
    }
    case "node": {
      const i = s.nodes.findIndex((x) => x.id === e.node.id);
      return { ...s, nodes: i < 0 ? [...s.nodes, e.node] : s.nodes.map((x, j) => (j === i ? e.node : x)) };
    }
    case "edge":
      return s.edges.some((x) => x.id === e.edge.id) ? s : { ...s, edges: [...s.edges, e.edge] };
    case "evidence":
      return { ...s, evidence: [...s.evidence, e.evidence] };
    case "gap":
      return { ...s, gaps: [...s.gaps, e.gap] };
    case "helper":
      return s.helpers.some((h) => h.id === e.helper.id) ? s : { ...s, helpers: [...s.helpers, e.helper] };
    case "ask":
      return { ...s, asks: [...s.asks, e.ask] };
    case "done":
      return { ...s, done: true };
    case "fatal":
      return { ...s, done: true, fatal: e.message };
  }
}

type Target = { kind: "company"; candidate: Candidate } | { kind: "founders"; name: string; founders: string[]; idea: string };

export default function Research({
  status,
  library,
  onSave,
  notesApi,
  onOpenNotes,
  onInfo,
  nav,
}: {
  status: Status;
  library: LibraryRecord[];
  onSave: (r: LibraryRecord) => Promise<boolean>;
  notesApi: NotesApi;
  onOpenNotes: (linkId: string) => void;
  onInfo: (i: ResearchInfo) => void;
  nav: { tab?: "desk" | "brief"; home?: number };
}) {
  const [stage, setStage] = useState<"ask" | "confirm" | "run">("ask");
  const [question, setQuestion] = useState("");
  const [interp, setInterp] = useState<InterpretResult | null>(null);
  const [interpErr, setInterpErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState<string | null>(null); // candidate id or "founders"
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [manualCompany, setManualCompany] = useState("");
  const [founderNames, setFounderNames] = useState(["", ""]);
  const [idea, setIdea] = useState("");
  const [target, setTarget] = useState<Target | null>(null);

  const [run, dispatch] = useReducer(reduce, EMPTY);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefState, setBriefState] = useState<"idle" | "loading" | "ready">("idle");
  const [briefNoteKey, setBriefNoteKey] = useState("");
  const [tab, setTab] = useState<"desk" | "network" | "brief">("desk");
  const [sel, setSel] = useState<Selection>(null);
  const [saving, setSaving] = useState<LibraryRecord | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const company = run.nodes.find((n) => n.kind === "company");
  const queries = run.calls.filter((c) => c.status === "ok").length;
  const displayName = company?.name ?? (target?.kind === "founders" ? target.name : target?.candidate.name) ?? null;

  useEffect(() => {
    onInfo({ stage, name: displayName, tab: tab === "brief" ? "brief" : "desk", running: stage === "run" && !run.done, hasBrief: !!brief, queries });
  }, [stage, displayName, tab, run.done, brief, queries, onInfo]);

  useEffect(() => {
    if (nav.tab) setTab(nav.tab);
  }, [nav.tab]);
  useEffect(() => {
    if (nav.home) {
      abortRef.current?.abort();
      setStage("ask");
      setQuestion("");
      setSel(null);
    }
  }, [nav.home]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---------- interpret ----------
  async function interpret(q: string, companyName?: string) {
    setBusy(true);
    setInterpErr(null);
    try {
      const res = await fetch("/api/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, company: companyName }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Lookup failed");
      const r = data as InterpretResult;
      setInterp((prev) => (companyName && prev ? { ...prev, candidates: r.candidates, companyQuery: r.companyQuery, call: r.call } : r));
      setChoice(r.candidates[0]?.id ?? "founders");
      if (!companyName) setAnswers({});
      setStage("confirm");
    } catch (e) {
      setInterpErr(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // ---------- research stream ----------
  async function start() {
    let t: Target | null = null;
    if (choice === "founders") {
      const names = founderNames.map((n) => n.trim()).filter(Boolean);
      if (!names.length) return;
      t = { kind: "founders", name: interp?.companyQuery || "New company", founders: names, idea: idea.trim() };
    } else {
      const c = interp?.candidates.find((x) => x.id === choice);
      if (!c) return;
      t = { kind: "company", candidate: c };
    }
    setTarget(t);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    dispatch({ type: "reset" });
    if (t.kind === "company" && interp?.call) dispatch({ type: "seed", call: { ...interp.call, stepId: "identify" } });
    setBrief(null);
    setBriefState("idle");
    setTab("desk");
    setSel(null);
    setStage("run");
    setSessionId(`${t.kind === "company" ? t.candidate.id : "idea:" + t.name}:${Date.now()}`);
    const payload = t.kind === "company" ? { companyId: t.candidate.id, question } : { founders: t.founders, idea: t.idea, name: t.name, question };
    try {
      const res = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        dispatch({ type: "fatal", message: d.error || `Research failed (${res.status})` });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            dispatch(JSON.parse(line.slice(6)) as ResearchEvent);
          } catch {}
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") dispatch({ type: "fatal", message: (e as Error).message });
    }
  }

  // ---------- notes in this research ----------
  const nodeIds = useMemo(() => new Set(run.nodes.map((n) => n.id)), [run.nodes]);
  const resolveLink = useMemo(() => {
    const byName = new Map<string, string>();
    for (const n of run.nodes) byName.set(normName(n.name), n.id);
    return (l: { id: string; name: string; kind?: string }) => (nodeIds.has(l.id) ? l.id : l.kind === "tag" ? byName.get(normName(l.name)) : undefined);
  }, [run.nodes, nodeIds]);
  const sessionNotes = useMemo(() => notesApi.notes.filter((n) => sessionId && n.sessionId === sessionId), [notesApi.notes, sessionId]);
  const earlierNotes = useMemo(() => notesApi.notes.filter((n) => n.sessionId !== sessionId && n.links.some((l) => resolveLink(l))), [notesApi.notes, sessionId, resolveLink]);
  const deskNotes = useMemo(() => [...earlierNotes, ...sessionNotes], [earlierNotes, sessionNotes]);
  const notes = useMemo(() => deskNotes.filter((n) => !n.aiExcluded), [deskNotes]);
  const noteKey = notes.map((n) => n.id + n.text.length + n.kind).join(",");
  const noteCtx: NoteContext = useMemo(
    () => ({
      sessionId: sessionId ?? undefined,
      sessionLabel: displayName ?? undefined,
      primary: company ? { id: company.id, name: company.name, kind: "company" } : undefined,
      candidates: run.nodes.filter((n) => n.kind !== "round").map((n) => ({ id: n.id, name: n.name, kind: n.kind })),
    }),
    [company, sessionId, displayName, run.nodes],
  );
  useEffect(() => setQuickCaptureContext(stage === "run" ? noteCtx : { candidates: [] }), [noteCtx, stage]);

  const context = useMemo(() => (interp?.questions ?? []).map((q) => ({ q: q.text, a: answers[q.id] ?? "" })), [interp, answers]);

  // ---------- brief ----------
  async function makeBrief() {
    if (!company) return;
    setBriefState("loading");
    try {
      const res = await fetch("/api/brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, context, notes, evidence: run.evidence, gaps: run.gaps, helpers: run.helpers, companyName: company.name, companyId: company.id }),
      });
      const b = (await res.json()) as Brief;
      setBrief(b);
      setBriefNoteKey(noteKey);
      const cited = new Set(b.sections.flatMap((s) => s.claims.flatMap((c) => c.notes)));
      const label = `${company.name} brief, ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
      for (const n of notes) if (cited.has(n.id) && !(n.citedIn ?? []).includes(label)) notesApi.update(n.id, { citedIn: [...(n.citedIn ?? []), label] });
    } catch {
      setBrief(null);
    } finally {
      setBriefState("ready");
    }
  }
  const autoBriefed = useRef(false);
  useEffect(() => {
    if (run.done && !run.fatal && company && !autoBriefed.current) {
      autoBriefed.current = true;
      makeBrief();
    }
    if (!run.done) autoBriefed.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.done, run.fatal, company?.id]);

  const helperAsks = useMemo(() => {
    const m: Record<string, string> = {};
    for (const g of brief?.gaps ?? []) for (const h of g.helpers) m[h.helperId] = h.whatToAsk;
    return m;
  }, [brief]);

  // ---------- save ----------
  function saveNode(id: string) {
    const node = run.nodes.find((n) => n.id === id);
    if (!node) return;
    const type = node.kind === "person" ? "person" : node.kind === "investor" ? (node.entityType === "Person" ? "person" : "investor") : "company";
    const fields = run.evidence.filter((e) => e.entityId === id).map((e) => ({ label: e.label, value: e.value, provenance: "cala" as const, sources: e.sources }));
    setSaving({ id, type, name: node.name, fields, notes: "", savedAt: "", updatedAt: "" });
  }
  function saveResearch() {
    if (!company) return;
    setSaving({
      id: `research:${company.id}:${question.slice(0, 40)}`,
      type: "research",
      name: `${company.name} — ${question.slice(0, 70)}${question.length > 70 ? "…" : ""}`,
      fields: [],
      notes: "",
      savedAt: "",
      updatedAt: "",
      question,
      brief: brief ?? undefined,
      evidence: run.evidence,
      helpers: run.helpers,
      notesList: notes,
    });
  }

  // =====================================================================
  if (stage === "ask") {
    const recent = library.filter((r) => r.type === "research").slice(0, 3);
    return <Home status={status} question={question} setQuestion={setQuestion} busy={busy} error={interpErr} onSubmit={() => question.trim() && interpret(question.trim())} recent={recent} />;
  }

  if (stage === "confirm" && interp) {
    const q = interp.companyQuery;
    const founderMode = choice === "founders";
    const canStart = founderMode ? founderNames.some((n) => n.trim()) : !!choice;
    return (
      <div className="confirm">
        <button className="btn ghost small" style={{ alignSelf: "flex-start", marginLeft: -10 }} onClick={() => setStage("ask")}>← Edit question</button>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h1>{interp.candidates.length ? `Which ${q ?? "company"} do you mean?` : `${q ? `“${q}”` : "This company"} isn't listed yet`}</h1>
          <p style={{ margin: 0, fontSize: 15.5, color: "var(--muted)" }}>
            {interp.candidates.length ? "Pick the right match. If it's too new to have a public record, start from the founders instead." : "Very early companies often have no public record. Start from the founders and what they're building."}
          </p>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {interp.candidates.map((c) => (
            <button key={c.id} className={`cand ${choice === c.id ? "on" : ""}`} onClick={() => setChoice(c.id)}>
              <span className="radio" />
              <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <b className="nu" style={{ fontSize: 16 }}>{c.name}</b>
                <span style={{ fontSize: 14, color: "var(--muted)", lineHeight: 1.45 }}>{c.description || "No description in Cala"}</span>
              </span>
            </button>
          ))}
          <div className={`cand ${founderMode ? "on" : ""}`} style={{ flexDirection: "column", gap: 14, cursor: "default" }} onClick={() => setChoice("founders")}>
            <span style={{ display: "flex", gap: 14, alignItems: "flex-start", width: "100%", cursor: "pointer" }}>
              <span className="radio" />
              <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                <b className="nu" style={{ fontSize: 16 }}>Not listed yet: start from the founders</b>
                <span style={{ fontSize: 14, color: "var(--muted)" }}>We'll look up the founders in Cala, their earlier work and people who worked with them.</span>
              </span>
            </span>
            {founderMode && (
              <span style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, width: "100%", paddingLeft: 34 }}>
                {founderNames.map((v, i) => (
                  <label key={i} style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                    Founder {i + 1}
                    <input className="field" value={v} placeholder="Full name" onChange={(e) => setFounderNames((f) => f.map((x, j) => (j === i ? e.target.value : x)))} />
                  </label>
                ))}
                <label style={{ gridColumn: "1 / -1", display: "flex", flexDirection: "column", gap: 6, fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                  What are they building?
                  <input className="field" value={idea} placeholder="One sentence" onChange={(e) => setIdea(e.target.value)} />
                </label>
              </span>
            )}
          </div>
        </div>

        <form className="row" onSubmit={(e) => { e.preventDefault(); if (manualCompany.trim()) interpret(question, manualCompany.trim()); }}>
          <input className="field" placeholder="Search another name in Cala…" value={manualCompany} onChange={(e) => setManualCompany(e.target.value)} />
          <button className="btn" disabled={busy || !manualCompany.trim()}>{busy ? <Spinner /> : "Search"}</button>
        </form>

        {interp.questions.length > 0 && (
          <div className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
            <div className="row" style={{ justifyContent: "space-between" }}><b className="nu" style={{ fontSize: 17 }}>A little context helps</b><span className="small muted">Optional · private</span></div>
            {interp.questions.map((qq) => (
              <label key={qq.id} style={{ display: "grid", gap: 8, fontSize: 14.5, fontWeight: 600 }}>
                {qq.text}
                <textarea className="field" rows={2} value={answers[qq.id] ?? ""} onChange={(e) => setAnswers((a) => ({ ...a, [qq.id]: e.target.value }))} placeholder="Type or skip" />
              </label>
            ))}
          </div>
        )}
        <div className="row">
          <button className="btn primary big" disabled={!canStart} onClick={start}>{founderMode ? "Start with the founders" : "Start researching"}</button>
          {interp.questions.length > 0 && <button className="btn ghost" disabled={!canStart} onClick={() => { setAnswers({}); start(); }}>Skip questions</button>}
        </div>
        {interpErr && <div className="err-box">{interpErr}</div>}
      </div>
    );
  }

  // =====================================================================
  const name = displayName ?? "Research";
  const stageProp = titleCase(run.evidence.find((e) => e.entityId === company?.id && e.field === "funding_stage")?.value) ?? (target?.kind === "founders" ? "Idea · not registered yet" : undefined);
  const notesChanged = !!brief && noteKey !== briefNoteKey;
  return (
    <>
      <header className="page-head">
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minWidth: 280 }}>
          {tab !== "brief" && <span className="tile" style={{ width: 54, height: 54, borderRadius: 16, fontSize: 24, background: colorFor(name), boxShadow: "0 4px 0 rgba(0,0,0,.14)" }}>{name.charAt(0).toUpperCase()}</span>}
          <h1>{name}</h1>
          <div className="props">
            {stageProp && <div className="prop"><span className="k">Stage</span><span><span className="pill">{stageProp}</span></span></div>}
            <div className="prop"><span className="k">Question</span><span style={{ color: "var(--ink-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={question}>{question}</span></div>
            <div className="prop"><span className="k">Status</span><span>{run.fatal ? <span className="pill" style={{ background: "#fdecea", color: "#8c231d" }}>Stopped</span> : run.done ? <span className="pill green">Ready</span> : <span className="pill blue"><span className="dot run" /> Researching</span>}</span></div>
          </div>
        </div>
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="seg" role="group" aria-label="View">
            <button className={tab === "desk" ? "on" : ""} onClick={() => setTab("desk")}>Desk</button>
            <button className={tab === "network" ? "on" : ""} onClick={() => setTab("network")}>Network</button>
            <button className={tab === "brief" ? "on" : ""} onClick={() => setTab("brief")}>Brief {briefState === "loading" && <Spinner />}</button>
          </div>
          <button className="btn" onClick={() => setNoteOpen(true)}><span style={{ width: 14, height: 14, borderRadius: 3, background: "var(--sun)", boxShadow: "0 2px 0 var(--sun-edge)" }} /> Add a note</button>
          {tab !== "brief" ? (
            <button className="btn primary" disabled={!run.done || !company} onClick={() => setTab("brief")}>Open the brief</button>
          ) : (
            <button className="btn primary" disabled={!brief} onClick={saveResearch}>Save to library</button>
          )}
        </div>
      </header>
      {run.fatal && <div className="err-box" style={{ margin: "0 40px 12px" }}>{run.fatal}</div>}

      {tab === "desk" && <Desk run={run} notes={deskNotes} sel={sel} onSelect={setSel} onAddNote={() => setNoteOpen(true)} />}
      {tab === "network" && (
        <div className="deskwrap" style={{ position: "relative" }}>
          <GraphMap nodes={run.nodes} edges={run.edges} evidence={run.evidence} helpers={run.helpers} sel={sel} onSelect={setSel} />
        </div>
      )}
      {tab === "brief" &&
        (briefState === "loading" ? (
          <div className="loading"><Spinner /><b className="nu" style={{ fontSize: 18, color: "var(--ink)" }}>Writing your brief…</b><span>From {run.evidence.length} sourced facts{notes.length ? ` and ${notes.length} of your notes` : ""}. Every claim links to its evidence.</span></div>
        ) : brief ? (
          <BriefView brief={brief} evidence={run.evidence} notes={notes} helpers={run.helpers} onSelect={setSel} factCount={run.evidence.length} companyName={name} notesChanged={notesChanged} onUpdate={makeBrief} />
        ) : (
          <div className="loading">{run.done ? "No brief yet." : "The brief is written when the research finishes."}</div>
        ))}

      {sel && (
        <>
          <div onClick={() => setSel(null)} style={{ position: "fixed", inset: 0, zIndex: 29, background: "rgba(43,42,38,.06)" }} />
          <Inspector sel={sel} onClose={() => setSel(null)} onSelect={setSel} run={run} notes={notesApi.notes} notesApi={notesApi} noteCtx={noteCtx} onOpenNotes={onOpenNotes} onSave={saveNode} library={library} helperAsks={helperAsks} />
        </>
      )}

      {noteOpen && (
        <div className="scrim" onClick={() => setNoteOpen(false)}>
          <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Add a note">
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>What do you know about {name}?</h3>
              <button className="btn ghost small" onClick={() => setNoteOpen(false)} aria-label="Close"><Icon name="x" size={15} /></button>
            </div>
            <NoteComposer api={notesApi} ctx={noteCtx} autoFocus onDone={() => { setNoteOpen(false); setToast("Note pinned to the desk"); setTimeout(() => setToast(null), 2200); }} />
            <p className="tiny muted" style={{ margin: "10px 0 0" }}>Private to you. Used in the brief{status?.claude ? "" : " once Claude is connected"}; never sent to Cala.</p>
          </div>
        </div>
      )}

      {saving && (
        <SaveModal
          record={saving}
          library={library}
          onCancel={() => setSaving(null)}
          onConfirm={async (r) => {
            const ok = await onSave(r);
            setSaving(null);
            setToast(ok ? `Saved ${r.type === "research" ? "this research" : r.name} to your library` : "Couldn't save");
            setTimeout(() => setToast(null), 2400);
          }}
        />
      )}
      {toast && <div className="pill green" style={{ position: "fixed", bottom: 84, right: 22, zIndex: 60, padding: "10px 14px", borderRadius: 12, fontWeight: 600 }}>{toast}</div>}
    </>
  );
}

// ---------------------------------------------------------------------------

function Home({
  status,
  question,
  setQuestion,
  busy,
  error,
  onSubmit,
  recent,
}: {
  status: Status;
  question: string;
  setQuestion: (s: string) => void;
  busy: boolean;
  error: string | null;
  onSubmit: () => void;
  recent: LibraryRecord[];
}) {
  const dict = useDictation(question, setQuestion);
  return (
    <div className="home">
      <div aria-hidden style={{ position: "relative", height: 92, width: 170 }}>
        <div style={{ position: "absolute", left: 6, top: 20, width: 96, height: 64, borderRadius: 14, background: "var(--blue-soft)", border: "2px solid #cfe2fb", borderBottomWidth: 4, transform: "rotate(-8deg)" }} />
        <div style={{ position: "absolute", left: 40, top: 8, width: 98, height: 64, borderRadius: 14, background: "#fff", border: "2px solid var(--line)", borderBottomWidth: 5, transform: "rotate(3deg)", display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}>
          <span className="tile" style={{ width: 26, height: 26, borderRadius: 8, fontSize: 12, background: "var(--green)" }}>N</span>
          <span style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={{ width: 34, height: 6, borderRadius: 3, background: "var(--ink)" }} /><span style={{ width: 24, height: 5, borderRadius: 3, background: "#d9d5cc" }} /></span>
        </div>
        <div style={{ position: "absolute", left: 122, top: 42, width: 40, height: 40, borderRadius: 4, background: "var(--sun)", transform: "rotate(10deg)", boxShadow: "0 3px 0 var(--sun-edge)" }} />
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <h1>Who are you meeting next?</h1>
        <p className="lede">Start with a name, an idea or a question. Your desk fills up as the research finds things.</p>
      </div>
      <form className="card prompt-card" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="I'm meeting the founders of a new startup next week. Help me understand the team and what to ask."
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit(); }}
          autoFocus
          aria-label="Your research question"
        />
        <div className="row">
          <button type="button" className={`icon-btn ${dict.listening ? "on" : ""}`} onClick={dict.toggle} disabled={!dict.supported} aria-label="Dictate" title={dict.supported ? "Dictate" : "Voice input isn't supported in this browser"}>
            <Icon name="mic" size={18} stroke={2.2} />
          </button>
          <span className="small muted">{dict.listening ? "Listening… tap to stop" : "Researched with Cala's public data"}</span>
          <span className="spacer" />
          <button className="btn primary big" disabled={busy || !question.trim() || !status?.cala}>{busy ? <Spinner /> : "Start researching"}</button>
        </div>
      </form>
      {error && <div className="err-box">{error}</div>}
      {status && !status.cala && <div className="warn">Add your Cala API key to <code>.env.local</code> as <code>CALA_API_KEY=…</code> and restart the dev server.</div>}
      <div className="sugg-row">
        {SUGGESTIONS.map((s) => (
          <button key={s.t} className="sugg" onClick={() => setQuestion(s.q)}>
            <span className="ico" style={{ background: s.bg }}><Icon name={s.icon} size={18} color={s.ink} stroke={2.4} /></span>
            {s.t}
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div style={{ display: "grid", gap: 2 }}>
          <span className="small muted" style={{ fontWeight: 600, padding: "0 12px 4px" }}>Recent research</span>
          {recent.map((r) => (
            <div key={r.id} className="recent">
              <span className="tile" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 15, background: colorFor(r.name) }}>{r.name.charAt(0).toUpperCase()}</span>
              <span style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <b style={{ fontWeight: 600, fontSize: 15 }}>{r.name.split(" — ")[0]}</b>
                <span className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.question}</span>
              </span>
              <span className="small muted">{new Date(r.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function normName(s: string) {
  return s.toLowerCase().replace(/\b(oy|ab|inc|ltd|gmbh|oyj|llc|corp|limited|plc)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
}

export type { Claim };
