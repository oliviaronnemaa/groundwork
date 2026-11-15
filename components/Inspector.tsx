"use client";
import type { CallLog, Claim, Evidence, Gap, GraphEdge, GraphNode, Helper, LibraryRecord, Note, StepState } from "@/lib/types";
import type { NotesApi } from "./App";
import { NoteCard, NoteComposer, kindLabel, type NoteContext } from "./NotesView";
import { avatarColors, deskModel, type DeskRun } from "./Desk";
import { colorFor, Icon, initials, Mark, Sources } from "./ui";

export type Selection =
  | { type: "node"; id: string }
  | { type: "call"; id: string }
  | { type: "claim"; claim: Claim; key: string }
  | { type: "evidence"; ids: string[] }
  | { type: "helper"; id: string }
  | { type: "note"; id: string }
  | { type: "cluster"; id: string }
  | null;

type RunLike = {
  calls: CallLog[];
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: Evidence[];
  helpers: Helper[];
  steps?: StepState[];
  gaps?: Gap[];
  asks?: { id: string; text: string }[];
  done?: boolean;
};

type NoteKindLink = NonNullable<NoteContext["primary"]>["kind"];
const WORK = /^(FOUNDED|WORKS_AT|IS_[A-Z]+_OF|INVESTED_IN)$/;

export default function Inspector({
  sel,
  onClose,
  onSelect,
  run,
  notes,
  onSave,
  library,
  notesApi,
  noteCtx,
  onOpenNotes,
  helperAsks,
}: {
  sel: Selection;
  onClose: () => void;
  onSelect: (s: Selection) => void;
  run: RunLike;
  notes: Note[];
  onSave?: (id: string) => void;
  library: LibraryRecord[];
  notesApi?: NotesApi;
  noteCtx?: NoteContext;
  onOpenNotes?: (id: string) => void;
  helperAsks?: Record<string, string>;
}) {
  if (!sel) return null;
  const nodeName = (id: string) => run.nodes.find((n) => n.id === id)?.name ?? "";
  const factList = (list: Evidence[], hl?: Set<string>) => (
    <div className="facts">
      {list.map((e) => (
        <div key={e.id} className={`fact ${hl?.has(e.id) ? "hl" : ""}`}>
          <div className="fl">
            <span>{e.label}</span>
            <button className="chip" onClick={() => onSelect({ type: "call", id: e.callId })} title="Show the lookup that returned this">{e.id}</button>
          </div>
          <div className="fv">{e.value}</div>
          <Sources sources={e.sources} />
        </div>
      ))}
    </div>
  );
  const webSection = (list: Evidence[], who: string) => (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><Mark kind="web" /> Found on the web</h3>
      <div className="webnote">These pages mention {who} by name. They come from an open-web search, not Cala, so check they're about the right {who.includes(" ") ? "person" : "company"} before relying on them.</div>
      {factList(list)}
    </section>
  );
  const notesAbout = (id: string, name: string) =>
    notes.filter((x) => x.links.some((l) => l.id === id || (l.kind === "tag" && norm(l.name) === norm(name))));
  const notesBlock = (id: string, name: string, kind: NoteKindLink) => {
    if (!notesApi) return null;
    const mine = notesAbout(id, name);
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3>Your notes</h3>
          {onOpenNotes && mine.length > 0 && <button className="btn ghost small" onClick={() => onOpenNotes(id)}>Open in Notes</button>}
        </div>
        {mine.map((x) => <NoteCard key={x.id} note={x} api={notesApi} />)}
        <NoteComposer key={id} api={notesApi} ctx={{ ...(noteCtx ?? { candidates: [] }), primary: { id, name, kind } }} compact placeholder={`Add a note about ${name}…`} />
      </section>
    );
  };

  let head: React.ReactNode = null;
  let body: React.ReactNode = null;
  let foot: React.ReactNode = null;

  // ------------------------------------------------------------------ clusters
  if (sel.type === "cluster" && run.steps) {
    const m = deskModel(run as DeskRun);
    const cname = m.company?.name ?? "this company";
    const title = (t: string, sub?: string, icon?: React.ReactNode) => (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {icon}
        <h2>{t}</h2>
        {sub && <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5, color: "var(--ink-2)" }}>{sub}</p>}
      </div>
    );
    const icoTile = (name: string, bg: string, ink: string) => <span className="ico" style={{ width: 48, height: 48, borderRadius: 15, background: bg }}><Icon name={name} size={22} color={ink} stroke={2.3} /></span>;

    switch (sel.id) {
      case "company": {
        const props: [string, string | undefined][] = [
          ["Founded", m.founded],
          ["Based in", m.hq],
          ["Stage", m.stage],
          ["Raised", m.totalFunding],
          ["Headcount", m.headcount],
          ["Website", m.get("website")],
        ];
        head = title(cname, m.description, m.company && <span className="tile" style={{ width: 60, height: 60, borderRadius: 17, fontSize: 28, background: colorFor(cname), boxShadow: "0 4px 0 rgba(0,0,0,.12)" }}>{cname.charAt(0).toUpperCase()}</span>);
        body = (
          <>
            <div className="props">
              {props.map(([k, v]) => (
                <div className="prop" key={k}>
                  <span className="k">{k}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: v ? "var(--ink)" : "var(--faint)" }}>{v ? <><Mark kind="pub" />{v}</> : <><Mark kind="unk" />Not in Cala</>}</span>
                </div>
              ))}
            </div>
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>All {m.cev.length} sourced facts</summary>
              <div style={{ marginTop: 10 }}>{factList(m.cev)}</div>
            </details>
            {m.company && notesBlock(m.company.id, cname, "company")}
          </>
        );
        if (m.company && onSave) foot = <button className="btn primary" onClick={() => onSave(m.company!.id)}>Save to library</button>;
        break;
      }
      case "team": {
        head = title("The team", m.people.length ? `${m.people.length} people linked to ${cname} in Cala.` : `Cala has no team records for ${cname}. Very early companies often don't.`, icoTile("team", "var(--green-soft)", "var(--green-dark)"));
        body = <PeopleList list={m.people} onSelect={onSelect} />;
        break;
      }
      case "work": {
        head = title("Earlier work", "Where the founders and team worked before, from public records.", icoTile("briefcase", "var(--blue-soft)", "var(--blue-dark)"));
        body = m.work.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {m.work.map((w) => (
              <div className="lrow plain" key={w.name}>
                <span className="tile" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 14, background: colorFor(w.name) }}>{w.name.charAt(0).toUpperCase()}</span>
                <span style={{ display: "flex", flexDirection: "column", flex: 1 }}><b style={{ fontWeight: 600 }}>{w.name}</b><span className="small muted">{w.who.join(", ")}</span></span>
                <Mark kind="pub" />
              </div>
            ))}
          </div>
        ) : <div className="unknown"><Mark kind="unk" /> No earlier roles in Cala. Ask the founders what they worked on before.</div>;
        break;
      }
      case "funding": {
        head = title("Funding", m.totalFunding ? `${m.totalFunding} raised in total, as reported.` : `No public funding for ${cname} yet. At this stage that's normal.`, icoTile("coins", "var(--green-soft)", "var(--green-dark)"));
        body = (
          <>
            {m.rounds.length > 0 && (
              <section style={{ display: "grid", gap: 8 }}>
                <h3>Rounds</h3>
                {m.rounds.map((r) => (
                  <button key={r.id} className="lrow" onClick={() => onSelect({ type: "node", id: r.id })}>
                    <span className="ico" style={{ background: "var(--green-soft)" }}><Icon name="coins" size={16} color="var(--green-dark)" /></span>
                    <span style={{ display: "flex", flexDirection: "column", flex: 1 }}><b style={{ fontWeight: 600 }}>{r.name}</b><span className="small muted">{r.subtitle || "Amount not public"}</span></span>
                    <Mark kind="pub" />
                  </button>
                ))}
              </section>
            )}
            {m.investors.length > 0 && (
              <section style={{ display: "grid", gap: 8 }}>
                <h3>Investors</h3>
                {[...m.leads, ...m.investors.filter((x) => !m.leads.includes(x))].map((x) => (
                  <button key={x.id} className="lrow" onClick={() => onSelect({ type: "node", id: x.id })}>
                    <span className="av" style={{ ...avatarColors(x.name), width: 34, height: 34, fontSize: 12 }}>{initials(x.name)}</span>
                    <span style={{ display: "flex", flexDirection: "column", flex: 1 }}><b style={{ fontWeight: 600 }}>{x.name}</b><span className="small muted">{x.subtitle}</span></span>
                  </button>
                ))}
              </section>
            )}
            {!m.rounds.length && !m.investors.length && <div className="unknown"><Mark kind="unk" /> Ask who else is investing, and on what terms.</div>}
          </>
        );
        break;
      }
      case "product": {
        head = title("Product", undefined, icoTile("box", "var(--purple-soft)", "var(--purple-ink)"));
        const d = m.cev.find((e) => e.field === "description");
        body = (
          <>
            {d ? factList([d]) : <div className="unknown"><Mark kind="unk" /> No product description in Cala.</div>}
            {m.cev.some((e) => e.field === "web") && webSection(m.cev.filter((e) => e.field === "web"), cname)}
            {m.industry && <div className="prop"><span className="k">Industry</span><span>{m.industry}</span></div>}
            <div className="unknown"><Mark kind="unk" /> Pricing and usage aren't in public data. Ask the founders.</div>
          </>
        );
        break;
      }
      case "help": {
        head = title("Could help", "People reachable through sourced links. A shared investor or employer is a possible route, not a known relationship.", icoTile("team", "var(--teal-soft)", "var(--teal-ink)"));
        body = m.helpers.length ? (
          <div style={{ display: "grid", gap: 10 }}>
            {m.helpers.map((h) => (
              <div key={h.id} className="lrow plain" style={{ flexDirection: "column", gap: 8 }}>
                <span style={{ display: "flex", gap: 12, alignItems: "center", width: "100%" }}>
                  <span className="av" style={avatarColors(h.name)}>{initials(h.name)}</span>
                  <span style={{ display: "flex", flexDirection: "column", flex: 1 }}><b style={{ fontWeight: 700 }}>{h.name}</b><span className="small muted">{h.relevance}</span></span>
                  <Mark kind="pub" />
                </span>
                {h.route && <span className="small" style={{ color: "var(--ink-2)" }}>{h.route}</span>}
                {helperAsks?.[h.id] && <span className="small"><b>Ask:</b> “{helperAsks[h.id]}”</span>}
                <span className="row"><button className="btn small" onClick={() => onSelect({ type: "helper", id: h.id })}>Why them?</button></span>
              </div>
            ))}
            <p className="tiny muted" style={{ margin: 0 }}>Groundwork never contacts anyone for you.</p>
          </div>
        ) : <div className="unknown"><Mark kind="unk" /> No one found through sourced links. The brief suggests the kinds of experts worth finding.</div>;
        break;
      }
      case "comparables": {
        head = title("Comparable cases", "Companies Cala connects to a similar problem. Comparisons are questions to explore, not predictions.", icoTile("scale", "var(--pink-soft)", "var(--pink-ink)"));
        body = m.comparables.length ? (
          <div style={{ display: "grid", gap: 8 }}>
            {m.comparables.map((c) => (
              <button key={c.id} className="lrow" onClick={() => onSelect({ type: "node", id: c.id })}>
                <span className="tile" style={{ width: 34, height: 34, borderRadius: 10, fontSize: 14, background: colorFor(c.name) }}>{c.name.charAt(0).toUpperCase()}</span>
                <span style={{ display: "flex", flexDirection: "column", flex: 1 }}><b style={{ fontWeight: 600 }}>{c.name}</b><span className="small muted">{c.subtitle}</span></span>
                <Icon name="chevron" size={16} color="var(--faint)" />
              </button>
            ))}
          </div>
        ) : <div className="unknown"><Mark kind="unk" /> None found. Add one you have in mind as a note.</div>;
        break;
      }
      case "customers": {
        head = title("Customers", "Cala holds public company data. Who uses a very young product, and how often, usually has to come from the founders.", icoTile("chart", "var(--orange-soft)", "var(--orange)"));
        body = (
          <>
            <div className="unknown"><Mark kind="unk" /> Not in public data: customers, usage, retention.</div>
            {m.company && notesBlock(m.company.id, cname, "company")}
          </>
        );
        break;
      }
      case "questions": {
        head = title("Open questions", `What's still unknown about ${cname}, and why it matters.`, <span className="qmark" style={{ width: 48, height: 48, fontSize: 24 }}>?</span>);
        body = (
          <div style={{ display: "grid", gap: 10 }}>
            {(run.gaps ?? []).map((g) => (
              <div key={g.id} className="keyq" style={{ alignItems: "flex-start", borderBottomWidth: 3 }}>
                <span style={{ display: "flex", flexDirection: "column", gap: 4 }}><b className="nu" style={{ fontSize: 16 }}>{g.title}</b><span style={{ fontSize: 14, color: "var(--ink-2)" }}>{g.why}</span></span>
              </div>
            ))}
            {(run.asks ?? []).map((a) => <div key={a.id} className="warn">{a.text}</div>)}
          </div>
        );
        break;
      }
      case "path": {
        head = title("Research path", "Every step, and every Cala lookup behind it. Click a lookup to see exactly what was asked.", icoTile("path", "var(--green-soft)", "var(--green-dark)"));
        body = (
          <div style={{ display: "grid", gap: 14 }}>
            {(run.steps ?? []).map((s) => {
              const calls = run.calls.filter((c) => c.stepId === s.id);
              return (
                <div key={s.id} style={{ display: "flex", gap: 12 }}>
                  <span className={`tnode ${s.status === "done" || s.status === "skipped" ? "done" : s.status === "running" ? "run" : s.status === "error" ? "err" : ""}`} style={{ marginTop: 1 }}>
                    {(s.status === "done" || s.status === "skipped") && <Icon name="check" size={12} color="#fff" stroke={3.5} />}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <b className="nu" style={{ fontSize: 15 }}>{s.label}</b>
                    {s.detail && <span className="small muted">{s.detail}</span>}
                    {calls.map((c) => (
                      <button key={c.id} className="call" onClick={() => onSelect({ type: "call", id: c.id })} title={`${c.method} ${c.path}`}>
                        <span className={`dot ${c.status === "ok" ? "ok" : c.status === "error" ? "err" : "run"}`} />
                        <span className="tool">{c.tool}</span>
                        <span className="sum">{c.status === "error" ? c.error : c.summary ?? "…"}</span>
                        <span className="ms">{c.cached ? "cached" : c.ms != null ? `${(c.ms / 1000).toFixed(1)}s` : ""}</span>
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        );
        break;
      }
    }
  }

  // ------------------------------------------------------------------ an entity
  if (sel.type === "node") {
    const n = run.nodes.find((x) => x.id === sel.id);
    const ev = run.evidence.filter((e) => e.entityId === sel.id);
    const isPerson = n?.kind === "person" || (n?.kind === "investor" && n.entityType === "Person");
    const work = ev.filter((e) => WORK.test(e.field) || e.field === "role");
    const webEv = ev.filter((e) => e.field === "web");
    const other = ev.filter((e) => !work.includes(e) && !webEv.includes(e));
    const links = run.edges.filter((e) => e.from === sel.id || e.to === sel.id);
    const helper = run.helpers.find((h) => h.personId === sel.id);
    const saved = library.some((r) => r.id === sel.id);
    const name = n?.name ?? "Entity";
    // Ask about the earliest earlier role, not a later side venture.
    const startYear = (v: string) => Number(v.match(/\((\d{4})/)?.[1] ?? 9999);
    const firstWork = work
      .filter((e) => e.field !== "role" && e.field !== "INVESTED_IN" && !(run.nodes.find((x) => x.kind === "company")?.name && e.value.startsWith(run.nodes.find((x) => x.kind === "company")!.name)))
      .sort((a, b) => startYear(a.value) - startYear(b.value))[0];
    head = (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {isPerson ? (
          <span className="av" style={{ ...avatarColors(name), width: 68, height: 68, fontSize: 24, boxShadow: "0 4px 0 rgba(0,0,0,.06)" }}>{initials(name)}</span>
        ) : (
          <span className="tile" style={{ width: 56, height: 56, borderRadius: 16, fontSize: 24, background: colorFor(name) }}>{name.charAt(0).toUpperCase()}</span>
        )}
        <h2>{name}</h2>
        {n?.subtitle && <span style={{ fontSize: 15, color: "var(--ink-2)" }}>{n.subtitle}</span>}
      </div>
    );
    body = (
      <>
        {helper && (
          <div className="lrow plain" style={{ background: "var(--teal-soft)", flexDirection: "column", gap: 4 }}>
            <b className="nu" style={{ color: "var(--teal-ink)" }}>Could help with open questions</b>
            <span className="small">{helper.relevance}</span>
            {helper.route && <span className="small" style={{ color: "var(--ink-2)" }}>{helper.route}</span>}
          </div>
        )}
        {work.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h3>{isPerson ? "Earlier work and roles" : "Roles"}</h3>
            {work.map((e, i) => (
              <div className="tl" key={e.id}>
                <span className="tl-rail"><span className="tl-dot" />{i < work.length - 1 && <span className="tl-line" />}</span>
                <span style={{ display: "flex", flexDirection: "column", gap: 2, paddingBottom: 6, flex: 1 }}>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{e.field === "role" ? `${e.value} · ${e.label.replace(/^Role at /, "")}` : `${e.label} ${e.value}`}</span>
                  <Sources sources={e.sources} />
                </span>
              </div>
            ))}
          </section>
        )}
        {other.length > 0 && (
          <details open={!work.length}>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>{other.length} more sourced fact{other.length > 1 ? "s" : ""}</summary>
            <div style={{ marginTop: 10 }}>{factList(other)}</div>
          </details>
        )}
        {webEv.length > 0 && webSection(webEv, name)}
        {sel.id.startsWith("web:") && !webEv.length && <div className="unknown"><Mark kind="unk" /> Not in Cala, and nothing on the web clearly about them. Ask about their background, or add what you know as a note.</div>}
        {!ev.length && !sel.id.startsWith("web:") && <div className="unknown"><Mark kind="unk" /> Cala returned this as a link only; its own profile wasn't looked up.</div>}
        {isPerson && firstWork && (
          <div className="keyq">
            <span className="qmark" style={{ width: 38, height: 38 }}>?</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="nu" style={{ fontWeight: 800, fontSize: 12.5, color: "var(--coral-ink)" }}>A good question · suggested</span>
              <span className="nu" style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.35 }}>What did you take from your time at {firstWork.value.replace(/\s*\(.*\)$/, "")} into this company?</span>
            </span>
          </div>
        )}
        {n && n.kind !== "round" && n.kind !== "context" && notesBlock(n.id, name, n.kind)}
        {links.length > 0 && (
          <details>
            <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 14 }}>{links.length} connection{links.length > 1 ? "s" : ""}</summary>
            <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
              {links.map((l) => {
                const other = l.from === sel.id ? l.to : l.from;
                return (
                  <button key={l.id} className="lrow" onClick={() => onSelect({ type: "node", id: other })}>
                    <span style={{ flex: 1, fontSize: 14 }}>{l.from === sel.id ? `${l.label} → ${nodeName(other)}` : `${nodeName(other)} → ${l.label}`}</span>
                  </button>
                );
              })}
            </div>
          </details>
        )}
      </>
    );
    if (onSave && n && n.kind !== "round" && n.kind !== "context") foot = <button className="btn primary" onClick={() => onSave(n.id)}>{saved ? "Update in library" : "Save to library"}</button>;
  }

  // ------------------------------------------------------------------ a lookup
  if (sel.type === "call") {
    const c = run.calls.find((x) => x.id === sel.id);
    const ev = run.evidence.filter((e) => e.callId === sel.id);
    head = (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span className={`pill ${c?.provider === "exa" ? "web" : "blue"}`} style={{ alignSelf: "flex-start" }}>{c?.provider === "exa" ? "Exa web search" : "Cala lookup"} · {c?.cached ? "cached" : c?.ms != null ? `${c.ms} ms` : c?.status}</span>
        <h2 style={{ fontSize: 24 }}>{c?.tool}</h2>
      </div>
    );
    body = c && (
      <>
        <dl className="kv">
          <dt>Endpoint</dt><dd>{c.method} {c.provider === "exa" ? "api.exa.ai" : "api.cala.ai"}{c.path.split("?")[0]}</dd>
          {c.path.includes("?") && (<><dt>Query</dt><dd>{decodeURIComponent(c.path.split("?")[1]).replace(/&/g, " · ")}</dd></>)}
          <dt>Result</dt><dd>{c.status === "error" ? <span style={{ color: "var(--err)" }}>{c.error}</span> : c.summary}</dd>
        </dl>
        {c.body !== undefined && <div><h3 style={{ marginBottom: 8 }}>Request</h3><pre className="json">{JSON.stringify(c.body, null, 2)}</pre></div>}
        <div><h3 style={{ marginBottom: 8 }}>What it returned ({ev.length})</h3>{ev.length ? factList(ev) : <p className="small muted" style={{ margin: 0 }}>{c.tool === "entity_introspection" ? "Introspection lists which fields exist, so the next lookup asks only for what's there." : "Nothing kept from this lookup."}</p>}</div>
        <p className="tiny muted" style={{ margin: 0 }}>The API key stays on the server and is never shown.</p>
      </>
    );
  }

  // ------------------------------------------------------------------ brief pieces
  if (sel.type === "claim") {
    const ids = new Set(sel.claim.evidence);
    const ev = run.evidence.filter((e) => ids.has(e.id));
    const ns = notes.filter((n) => sel.claim.notes.includes(n.id));
    head = (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span className="row"><Mark kind={sel.claim.kind === "fact" ? "pub" : sel.claim.kind === "note" ? "note" : "ai"} /><span className="small muted">{sel.claim.kind === "fact" ? "Sourced from Cala" : sel.claim.kind === "note" ? "From your notes" : "Interpretation, not established fact"}</span></span>
        <h2 style={{ fontSize: 22, lineHeight: 1.3 }}>{sel.claim.text}</h2>
      </div>
    );
    body = (
      <>
        {ev.length > 0 && factList(ev, ids)}
        {ns.map((n) => <div key={n.id} className="ncard"><p className="ntext">{n.text}</p></div>)}
        {!ev.length && !ns.length && <p className="muted">No evidence attached.</p>}
      </>
    );
  }
  if (sel.type === "evidence") {
    const ev = run.evidence.filter((e) => sel.ids.includes(e.id));
    head = <h2 style={{ fontSize: 24 }}>{ev[0]?.entityName ?? "Evidence"}</h2>;
    const node = ev[0] ? run.nodes.find((n) => n.id === ev[0].entityId) : undefined;
    body = <>{factList(ev)}{node && <button className="btn small" onClick={() => onSelect({ type: "node", id: node.id })}>Open {node.name}</button>}</>;
  }
  if (sel.type === "helper") {
    const h = run.helpers.find((x) => x.id === sel.id);
    head = h && (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <span className="av" style={{ ...avatarColors(h.name), width: 64, height: 64, fontSize: 22 }}>{initials(h.name)}</span>
        <h2>{h.name}</h2>
        <span style={{ fontSize: 15, color: "var(--ink-2)" }}>{h.relevance}</span>
      </div>
    );
    body = h && (
      <>
        {h.route && <div className="lrow plain" style={{ background: "var(--teal-soft)" }}><span className="small">{h.route}</span></div>}
        {factList(run.evidence.filter((e) => h.evidence.includes(e.id)))}
        <p className="tiny muted" style={{ margin: 0 }}>Groundwork never contacts anyone. Whether this person knows the founders is unknown.</p>
      </>
    );
  }
  if (sel.type === "note") {
    const nt = notes.find((x) => x.id === sel.id);
    head = <div style={{ display: "flex", flexDirection: "column", gap: 10 }}><span className="row"><Mark kind="note" /><span className="small muted">{nt ? kindLabel(nt.kind) : "Note"} · private</span></span><h2 style={{ fontSize: 24 }}>Your note</h2></div>;
    body = nt ? (notesApi ? <NoteCard note={nt} api={notesApi} onLinkClick={(l) => run.nodes.some((x) => x.id === l.id) && onSelect({ type: "node", id: l.id })} /> : <div className="ncard"><p className="ntext">{nt.text}</p></div>) : <p className="muted">This note was deleted.</p>;
  }

  return (
    <aside className="peek" aria-label="Details">
      <div className="peek-bar">
        <button className="btn ghost small" onClick={onClose} aria-label="Close"><Icon name="x" size={15} /></button>
        <span className="spacer" />
        <span className="tiny muted">Esc to close</span>
      </div>
      <div className="peek-body">
        {head}
        {body}
      </div>
      {foot && <div className="peek-foot">{foot}</div>}
    </aside>
  );
}

function PeopleList({ list, onSelect }: { list: GraphNode[]; onSelect: (s: Selection) => void }) {
  if (!list.length) return <div className="unknown"><Mark kind="unk" /> Add who you know is on the team as a note.</div>;
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {list.map((p) => (
        <button key={p.id} className="lrow" onClick={() => onSelect({ type: "node", id: p.id })}>
          <span className="av" style={{ ...avatarColors(p.name), width: 34, height: 34, fontSize: 12 }}>{initials(p.name)}</span>
          <span style={{ display: "flex", flexDirection: "column", flex: 1 }}><b style={{ fontWeight: 600 }}>{p.name}</b><span className="small muted">{p.subtitle}</span></span>
          <Icon name="chevron" size={16} color="var(--faint)" />
        </button>
      ))}
    </div>
  );
}

function norm(s: string) {
  return s.toLowerCase().replace(/\b(oy|ab|inc|ltd|gmbh|oyj|llc|corp|limited|plc)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
}
