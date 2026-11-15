"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CallLog, Evidence, Gap, GraphEdge, GraphNode, Helper, Note, StepState } from "@/lib/types";
import type { Selection } from "./Inspector";
import { colorFor, Icon, initials, Legend, Mark } from "./ui";

export type DeskRun = {
  steps: StepState[];
  calls: CallLog[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: Evidence[];
  gaps: Gap[];
  helpers: Helper[];
  asks: { id: string; text: string }[];
  done: boolean;
  fatal?: string;
};

const WORK_FIELDS = new Set(["FOUNDED", "WORKS_AT", "IS_CEO_OF", "IS_CTO_OF", "IS_CFO_OF", "IS_COO_OF", "IS_CMO_OF", "IS_BOARD_MEMBER_OF"]);

const SOFT = ["#e3f5ea", "#e5f0fd", "#fde7ef", "#efeafe", "#ddf5f3", "#fff0e0"];
const SOFT_INK = ["#23794a", "#1f5fae", "#b83a68", "#6a4fd0", "#0e8079", "#c26a12"];
export function avatarColors(name: string) {
  let h = 0;
  for (const c of name) h = (h * 17 + c.charCodeAt(0)) >>> 0;
  const i = h % SOFT.length;
  return { background: SOFT[i], color: SOFT_INK[i] };
}

/** Everything the desk shows, derived from the live research stream. */
export function deskModel(run: DeskRun) {
  const company = run.nodes.find((n) => n.kind === "company");
  const cid = company?.id;
  const ev = (id?: string) => run.evidence.filter((e) => e.entityId === id);
  const cev = ev(cid);
  const get = (field: string) => cev.find((e) => e.field === field)?.value;
  const touches = (id: string) => run.edges.some((e) => (e.from === id && e.to === cid) || (e.to === id && e.from === cid));
  const people = run.nodes.filter((n) => n.kind === "person" && touches(n.id));
  const founders = people.filter((p) => /founder/i.test(p.subtitle ?? ""));
  const team = people.filter((p) => !founders.includes(p));
  const shown = [...founders, ...team].slice(0, 2);
  const workMap = new Map<string, { name: string; who: string[] }>();
  for (const e of run.evidence) {
    if (!WORK_FIELDS.has(e.field) || e.entityId === cid || !people.some((p) => p.id === e.entityId)) continue;
    const name = e.value.replace(/\s*\(.*\)\s*$/, "");
    if (company && name.toLowerCase() === company.name.toLowerCase()) continue;
    const w = workMap.get(name) ?? { name, who: [] };
    if (!w.who.includes(e.entityName)) w.who.push(e.entityName);
    workMap.set(name, w);
  }
  const work = [...workMap.values()];
  const industry = run.nodes.find((n) => n.kind === "context" && n.subtitle === "industry")?.name;
  const rounds = run.nodes.filter((n) => n.kind === "round");
  const investors = run.nodes.filter((n) => n.kind === "investor");
  const leads = investors.filter((n) => n.subtitle === "lead investor");
  const comparables = run.nodes.filter((n) => n.kind === "comparable");
  const status = (id: string) => run.steps.find((s) => s.id === id)?.status ?? "pending";
  return {
    company, cid, cev, get, founders, team, people, shown, work, industry, rounds, investors, leads, comparables,
    helpers: run.helpers,
    gaps: run.gaps,
    status,
    stage: titleCase(get("funding_stage")),
    description: get("description"),
    webCount: cev.filter((e) => e.field === "web").length,
    hq: get("headquarters_address"),
    city: cityOf(get("headquarters_address")),
    founded: get("founding_date"),
    totalFunding: get("total_funding"),
    headcount: get("employee_count_range") ?? get("employee_count"),
    ev,
  };
}

type Pos = { left: number; top: number; w: number };
const P: Record<string, Pos> = {
  company: { left: 385, top: 212, w: 290 },
  p0: { left: 40, top: 26, w: 232 },
  p1: { left: 40, top: 124, w: 232 },
  work: { left: 40, top: 236, w: 252 },
  funding: { left: 40, top: 404, w: 252 },
  product: { left: 790, top: 8, w: 240 },
  help: { left: 790, top: 150, w: 240 },
  comparables: { left: 790, top: 298, w: 240 },
  customers: { left: 790, top: 446, w: 240 },
  questions: { left: 340, top: 456, w: 380 },
};

export default function Desk({
  run,
  notes,
  sel,
  onSelect,
  onAddNote,
}: {
  run: DeskRun;
  notes: Note[];
  sel: Selection;
  onSelect: (s: Selection) => void;
  onAddNote: () => void;
}) {
  const m = useMemo(() => deskModel(run), [run]);
  const isSel = (id: string) => sel?.type === "cluster" && sel.id === id;
  const isNode = (id: string) => sel?.type === "node" && sel.id === id;
  const open = (id: string) => () => onSelect({ type: "cluster", id });
  const st = m.status;
  const phase = (step: string, has: boolean): "ghost" | "empty" | "full" => (has ? "full" : st(step) === "pending" || st(step) === "running" ? "ghost" : "empty");

  const notesHere = notes.slice(-2);
  const extraNotes = Math.max(0, notes.length - 2);
  const customerNotes = notes.filter((n) => /customer|user|team|pilot|test|usage|revenue|traction/i.test(n.text));

  // connector targets for the cards that are on the desk
  const lines: { x: number; y: number; side: "l" | "r" }[] = [];
  const addL = (p: Pos) => lines.push({ x: p.left + p.w, y: p.top + 34, side: "l" });
  const addR = (p: Pos) => lines.push({ x: p.left, y: p.top + 34, side: "r" });
  m.shown.forEach((_, i) => addL(P[`p${i}`]));
  addL(P.work);
  addL(P.funding);
  addR(P.product);
  addR(P.help);
  addR(P.comparables);
  addR(P.customers);

  // Scale the desk down to fit narrower windows instead of scrolling sideways.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(Math.min(1, Math.max(0.6, (el.clientWidth - 32) / 1060))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const steps = run.steps;
  const doneCount = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const running = steps.find((s) => s.status === "running");
  const lookups = run.calls.filter((c) => c.status === "ok" && c.provider !== "exa").length;
  const webSearches = run.calls.filter((c) => c.status === "ok" && c.provider === "exa").length;

  return (
    <div className="deskwrap" ref={wrapRef}>
      <div className="stage" style={{ transform: scale < 1 ? `scale(${scale})` : undefined, marginBottom: scale < 1 ? 90 - 600 * (1 - scale) : undefined }}>
        <svg width="1060" height="600" viewBox="0 0 1060 600" aria-hidden style={{ position: "absolute", inset: 0 }}>
          <g fill="none" stroke="#e2dccf" strokeWidth="2.5" strokeLinecap="round">
            {m.company &&
              lines.map((l, i) => {
                const sx = l.side === "l" ? 385 : 675;
                const sy = 262 + (i % 4) * 8;
                const mx = (sx + l.x) / 2;
                return <path key={i} d={`M${sx} ${sy} C ${mx} ${sy}, ${mx} ${l.y}, ${l.x} ${l.y}`} />;
              })}
          </g>
          {m.company && <path d="M530 360 L 530 456" fill="none" stroke="#ffb59f" strokeWidth="2.5" strokeDasharray="2 7" strokeLinecap="round" />}
        </svg>

        {notesHere.map((n, i) => (
          <button
            key={n.id}
            className="sticky"
            style={{ left: i === 0 ? 410 : 580, top: i === 0 ? 16 : 30, width: i === 0 ? 160 : 150, transform: `rotate(${i === 0 ? -3 : 2.5}deg)` }}
            onClick={() => onSelect({ type: "note", id: n.id })}
          >
            {n.text.length > 70 ? n.text.slice(0, 68) + "…" : n.text}
            {i === 1 && extraNotes > 0 && <span style={{ display: "block", fontSize: 11.5, marginTop: 4, color: "var(--sun-ink)" }}>+{extraNotes} more</span>}
          </button>
        ))}
        {notes.length === 0 && m.company && (
          <button className="sticky" style={{ left: 430, top: 40, width: 190, background: "#fffaf0", borderBottomColor: "#f2e2b0", color: "var(--sun-ink)", transform: "rotate(-2deg)" }} onClick={onAddNote}>
            + Add what you know about {m.company.name}
          </button>
        )}

        {/* company */}
        {m.company ? (
          <button className={`dcard ${isSel("company") ? "sel" : ""}`} onClick={open("company")} style={{ left: P.company.left, top: P.company.top, width: P.company.w, padding: "18px 20px", gap: 10, borderBottomWidth: 6 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tile" style={{ width: 44, height: 44, borderRadius: 13, fontSize: 20, background: colorFor(m.company.name) }}>{m.company.name.charAt(0).toUpperCase()}</span>
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="nu" style={{ fontWeight: 900, fontSize: 21, lineHeight: 1.15 }}>{m.company.name}</span>
                <span className="csub">{[m.founders.length ? `${m.founders.length} founder${m.founders.length > 1 ? "s" : ""}` : null, m.city].filter(Boolean).join(" · ") || "Company"}</span>
              </span>
            </span>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: "var(--ink-2)" }}>{clip(m.description ?? "Cala has no description for this company yet.", 120)}</span>
          </button>
        ) : (
          <div className="dcard ghost" style={{ left: P.company.left, top: P.company.top + 20, width: P.company.w, height: 90, justifyContent: "center" }}>
            {run.fatal ? "Couldn't load the company" : "Finding the company…"}
          </div>
        )}

        {/* people */}
        {m.shown.length > 0
          ? m.shown.map((p, i) => {
              const pos = P[`p${i}`];
              const more = i === 1 ? m.people.length - 2 : 0;
              const c = avatarColors(p.name);
              const hasNote = notes.some((n) => n.links.some((l) => l.id === p.id));
              const webCount = run.evidence.filter((e) => e.entityId === p.id && e.field === "web").length;
              return (
                <button key={p.id} className={`dcard ${isNode(p.id) ? "sel" : ""}`} onClick={() => onSelect({ type: "node", id: p.id })} style={{ left: pos.left, top: pos.top, width: pos.w, flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <span className="av" style={c}>{initials(p.name)}</span>
                  <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</span>
                    <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                      <span className="csub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{more > 0 ? `${shortRole(p.subtitle)} · +${more} more` : shortRole(p.subtitle)}</span>
                      {webCount > 0 && <span className="mini"><Mark kind="web" title={`${webCount} web page${webCount > 1 ? "s" : ""} mention them: leads to check`} /></span>}
                      {hasNote && <span className="mini"><Mark kind="note" title="You have notes about this person" /></span>}
                    </span>
                  </span>
                </button>
              );
            })
          : phase("team", false) === "ghost"
            ? <div className="dcard ghost" style={{ left: 40, top: 40, width: 232, height: 60, gap: 10 }}><span className="dot run" /> Finding the founders…</div>
            : m.company && (
                <button className="dcard empty" onClick={open("team")} style={{ left: 40, top: 40, width: 232 }}>
                  <span className="ctitle" style={{ color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}><Mark kind="unk" /> Founders</span>
                  <span className="cline" style={{ color: "var(--ink-2)" }}>None in Cala. Know who they are?</span>
                </button>
              )}

        {m.company && (
          <>
            <Cluster pos={P.work} state={phase("people", m.work.length > 0)} sel={isSel("work")} onClick={open("work")} icon="briefcase" tint="var(--blue-soft)" ink="var(--blue-dark)" title="Earlier work"
              line={m.work.length ? `${m.work.length} earlier compan${m.work.length === 1 ? "y" : "ies"} and roles` : "No earlier roles in Cala"}
              sub={m.work.slice(0, 3).map((w) => w.name).join(" · ")} looking="Looking at earlier work…" />
            <Cluster pos={P.funding} state={phase("funding", m.rounds.length + m.investors.length > 0 || !!m.totalFunding)} sel={isSel("funding")} onClick={open("funding")} icon="coins" tint="var(--green-soft)" ink="var(--green-dark)" title="Funding"
              line={m.totalFunding ? `${m.totalFunding} raised${m.rounds.length ? ` · ${m.rounds.length} round${m.rounds.length > 1 ? "s" : ""}` : ""}` : m.rounds.length ? `${m.rounds.length} round${m.rounds.length > 1 ? "s" : ""}` : "No public funding yet"}
              extra={m.investors.length ? <span className="avs">{m.investors.slice(0, 3).map((x) => <span key={x.id} className="av" style={avatarColors(x.name)}>{initials(x.name)}</span>)}{m.investors.length > 3 && <span className="av" style={{ background: "var(--line-2)", color: "var(--muted)" }}>+{m.investors.length - 3}</span>}</span> : undefined}
              looking="Tracing funding…" />
            <Cluster pos={P.product} state={phase("profile", !!m.description)} sel={isSel("product")} onClick={open("product")} icon="box" tint="var(--purple-soft)" ink="var(--purple-ink)" title="Product"
              line={clip(firstSentence(m.description ?? ""), 70) || "No product description"}
              sub={m.industry ?? (m.webCount ? `${m.webCount} web page${m.webCount > 1 ? "s" : ""} mention it` : undefined)} looking="Reading the profile…" />
            <Cluster pos={P.help} state={phase("network", m.helpers.length > 0)} sel={isSel("help")} onClick={open("help")} icon="team" tint="var(--teal-soft)" ink="var(--teal-ink)" title="Could help"
              line={m.helpers.length ? `${m.helpers.length} people to talk to` : "No one found via sourced links"}
              extra={m.helpers.length ? <span className="avs">{m.helpers.slice(0, 3).map((h) => <span key={h.id} className="av" style={avatarColors(h.name)}>{initials(h.name)}</span>)}</span> : undefined}
              looking="Walking the network…" />
            <Cluster pos={P.comparables} state={phase("comparables", m.comparables.length > 0)} sel={isSel("comparables")} onClick={open("comparables")} icon="scale" tint="var(--pink-soft)" ink="var(--pink-ink)" title="Comparable cases"
              line={m.comparables.length ? `${m.comparables.length} to learn from` : "None found"} sub={m.comparables.slice(0, 3).map((c) => c.name).join(" · ")} looking="Finding comparables…" />
            <button className={`dcard ${isSel("customers") ? "sel" : ""}`} onClick={open("customers")} style={{ left: P.customers.left, top: P.customers.top, width: P.customers.w }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="ico" style={{ background: "var(--orange-soft)", width: 30, height: 30 }}><Icon name="chart" size={15} color="var(--orange)" stroke={2.4} /></span>
                <span className="ctitle" style={{ color: "var(--orange-ink)" }}>Customers</span>
              </span>
              <span className="cline">{customerNotes.length ? clip(customerNotes[customerNotes.length - 1].text, 60) : "Not in public data"}</span>
              <span className="csub" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Mark kind={customerNotes.length ? "note" : "unk"} /> {customerNotes.length ? "From your notes · usage unknown" : "Ask the founders"}</span>
            </button>
            {(m.gaps.length > 0 || st("gaps") === "done") && (
              <button className={`dcard ${isSel("questions") ? "sel" : ""}`} onClick={open("questions")} style={{ left: P.questions.left, top: P.questions.top, width: P.questions.w, flexDirection: "row", alignItems: "center", gap: 14, background: "var(--coral-soft)", borderColor: "var(--coral-line)" }}>
                <span className="qmark" style={{ width: 42, height: 42 }}>?</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span className="ctitle" style={{ color: "var(--coral-ink)" }}>{m.gaps.length} open question{m.gaps.length === 1 ? "" : "s"}</span>
                  <span className="nu" style={{ fontWeight: 800, fontSize: 15.5, lineHeight: 1.3 }}>{m.gaps[0]?.title ?? "Nothing open"}</span>
                </span>
              </button>
            )}
            {!(m.gaps.length > 0 || st("gaps") === "done") && (
              <div className="dcard ghost" style={{ left: P.questions.left, top: P.questions.top, width: P.questions.w, height: 70, justifyContent: "center" }}>Open questions appear here</div>
            )}
          </>
        )}
      </div>

      <button className="track" onClick={() => onSelect({ type: "cluster", id: "path" })} title="See every Cala lookup">
        <span style={{ display: "flex", alignItems: "center" }}>
          {steps.map((s, i) => (
            <span key={s.id} style={{ display: "flex", alignItems: "center" }}>
              {i > 0 && <span className={`tbar ${s.status === "done" || s.status === "skipped" ? "done" : ""}`} />}
              <span className={`tnode ${s.status === "done" || s.status === "skipped" ? "done" : s.status === "running" ? "run" : s.status === "error" ? "err" : ""}`} title={s.label}>
                {(s.status === "done" || s.status === "skipped") && <Icon name="check" size={12} color="#fff" stroke={3.5} />}
              </span>
            </span>
          ))}
        </span>
        <span style={{ display: "flex", flexDirection: "column" }}>
          <span className="nu" style={{ fontWeight: 800, fontSize: 14 }}>{run.fatal ? "Research stopped" : run.done ? "Desk is ready" : running ? running.label : steps.length ? `${doneCount} of ${steps.length}` : "Starting…"}</span>
          <span className="csub">{lookups} Cala lookup{lookups === 1 ? "" : "s"}{webSearches ? ` · ${webSearches} web search${webSearches === 1 ? "" : "es"}` : ""} · see the path</span>
        </span>
      </button>
      <div className="legend"><Legend /></div>
    </div>
  );
}

function Cluster({
  pos, state, sel, onClick, icon, tint, ink, title, line, sub, extra, looking,
}: {
  pos: Pos; state: "ghost" | "empty" | "full"; sel: boolean; onClick: () => void; icon: string; tint: string; ink: string; title: string; line: string; sub?: string; extra?: React.ReactNode; looking: string;
}) {
  if (state === "ghost")
    return (
      <div className="dcard ghost" style={{ left: pos.left, top: pos.top, width: pos.w, height: 74, gap: 10 }}>
        <span className="dot run" style={{ background: "#c9c1ae" }} /> {looking}
      </div>
    );
  return (
    <button className={`dcard ${state === "empty" ? "empty" : ""} ${sel ? "sel" : ""}`} onClick={onClick} style={{ left: pos.left, top: pos.top, width: pos.w }}>
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="ico" style={{ background: state === "empty" ? "var(--line-2)" : tint, width: 30, height: 30 }}><Icon name={icon} size={15} color={state === "empty" ? "var(--faint)" : ink} stroke={2.4} /></span>
        <span className="ctitle" style={{ color: state === "empty" ? "var(--muted)" : ink }}>{title}</span>
        {state === "empty" && <span style={{ marginLeft: "auto" }}><Mark kind="unk" /></span>}
      </span>
      <span className="cline" style={state === "empty" ? { color: "var(--ink-2)" } : undefined}>{line}</span>
      {extra}
      {sub && !extra && <span className="csub" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>}
    </button>
  );
}

export function titleCase(s?: string) {
  if (!s) return s;
  return s.replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\bIpo\b/, "IPO");
}
function cityOf(addr?: string) {
  if (!addr) return undefined;
  const parts = addr.split(",").map((p) => p.trim()).filter(Boolean);
  const pick = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return pick.replace(/[0-9]+/g, "").replace(/\b[A-Z]{2}-[A-Z]{2}\b/, "").trim() || undefined;
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}
function firstSentence(s: string) {
  const m = s.match(/^(.+?[.!?])(\s|$)/);
  return m ? m[1] : s;
}
function shortRole(s?: string) {
  if (!s) return "Team";
  return s.split(",")[0].replace(/^Founder$/i, "Founder").trim();
}
