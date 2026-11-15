"use client";
import { useMemo, useState } from "react";
import type { Brief, Claim, Evidence, Helper, Note } from "@/lib/types";
import type { Selection } from "./Inspector";
import { avatarColors } from "./Desk";
import { colorFor, Icon, initials, Legend, Mark, Sources } from "./ui";

export default function BriefView({
  brief,
  evidence,
  notes,
  helpers,
  onSelect,
  factCount,
  companyName = "the company",
  notesChanged,
  onUpdate,
  readOnly,
}: {
  brief: Brief;
  evidence: Evidence[];
  notes: Note[];
  helpers: Helper[];
  sel?: Selection;
  onSelect: (s: Selection) => void;
  factCount: number;
  companyName?: string;
  notesChanged?: boolean;
  onUpdate?: () => void;
  readOnly?: boolean;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({ "0-0": true });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const color = colorFor(companyName);
  const helper = (id: string) => helpers.find((h) => h.id === id);

  const actions = useMemo(() => {
    const seen = new Set<string>();
    return brief.gaps.flatMap((g) => g.actions).filter((a) => (seen.has(a.toLowerCase()) ? false : (seen.add(a.toLowerCase()), true))).slice(0, 6);
  }, [brief]);
  const keyQuestion = brief.questions[0] ?? brief.gaps[0]?.title;
  const people = useMemo(() => {
    const out: { h: Helper; ask: string }[] = [];
    for (const g of brief.gaps) for (const x of g.helpers) {
      const h = helper(x.helperId);
      if (h && !out.some((o) => o.h.id === h.id)) out.push({ h, ask: x.whatToAsk });
    }
    return out.slice(0, 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brief, helpers]);
  const experts = useMemo(() => {
    const seen = new Set<string>();
    return brief.gaps.flatMap((g) => g.expertTypes).filter((x) => (seen.has(x.type) ? false : (seen.add(x.type), true))).slice(0, 2);
  }, [brief]);
  const webCount = evidence.filter((e) => e.field === "web").length;
  const notesUsed = new Set(brief.sections.flatMap((s) => s.claims.flatMap((c) => c.notes))).size;

  const claimRow = (c: Claim, key: string) => {
    const isOpen = !!open[key];
    const ev = evidence.filter((e) => c.evidence.includes(e.id));
    const ns = notes.filter((n) => c.notes.includes(n.id));
    return (
      <div key={key}>
        <button className={`toggle ${isOpen ? "open" : ""} ${c.kind === "interpretation" ? "interp" : ""}`} onClick={() => toggle(key)} aria-expanded={isOpen}>
          <span className="tri"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 4v16l11-8z" /></svg></span>
          <span style={{ flex: 1, fontWeight: isOpen ? 600 : 500 }}>{c.text}</span>
          <Mark kind={c.kind === "fact" ? (ev.length && ev.every((e) => e.sources.some((s) => s.web)) ? "web" : "pub") : c.kind === "note" ? "note" : "ai"} />
        </button>
        {isOpen && (
          <div className={`inside ${c.kind === "note" ? "note" : ""}`}>
            {c.kind === "interpretation" && <span className="small muted">A hypothesis drawn from the evidence below, not an established fact.</span>}
            {ev.map((e) => (
              <div key={e.id} style={{ padding: "6px 4px" }}>
                <div style={{ fontSize: 14.5, lineHeight: 1.45 }}><b style={{ fontWeight: 600 }}>{e.entityName}</b> · {e.label.toLowerCase()}: {e.value}</div>
                <Sources sources={e.sources} />
              </div>
            ))}
            {ns.map((n) => <div key={n.id} className="ncard" style={{ margin: "4px 0" }}><p className="ntext" style={{ fontSize: 14 }}>{n.text}</p></div>)}
            {!ev.length && !ns.length && <span className="small muted">No evidence attached.</span>}
            {!readOnly && ev[0] && <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => onSelect({ type: "claim", claim: c, key })}>Open in side panel</button>}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div className="cover" aria-hidden style={{ background: `${color}22` }}>
        <i style={{ left: 70, top: 36, width: 130, height: 84, borderRadius: 18, background: "#fff", border: `2px solid ${color}44`, borderBottomWidth: 5, transform: "rotate(-6deg)" }} />
        <i style={{ left: 250, top: 64, width: 64, height: 64, borderRadius: 6, background: "var(--sun)", borderBottom: "4px solid var(--sun-edge)", transform: "rotate(8deg)" }} />
        <i style={{ right: 190, top: 22, width: 150, height: 96, borderRadius: 18, background: "#fff", border: `2px solid ${color}44`, borderBottomWidth: 5, transform: "rotate(5deg)" }} />
        <i style={{ right: 96, top: 86, width: 50, height: 50, borderRadius: 16, background: "var(--coral)", borderBottom: "4px solid var(--coral-dark)", transform: "rotate(-10deg)" }} />
        <i style={{ left: "46%", top: 30, width: 32, height: 32, borderRadius: "50%", background: "var(--blue)", borderBottom: "3px solid var(--blue-dark)" }} />
      </div>

      <article className="doc">
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: -34 }}>
          <span className="tile" style={{ width: 66, height: 66, borderRadius: 18, fontSize: 30, background: color, boxShadow: "0 5px 0 rgba(0,0,0,.15), 0 0 0 5px #fff" }}>{companyName.charAt(0).toUpperCase()}</span>
          <h1>Before you meet {companyName}</h1>
          <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5, color: "var(--ink-2)" }}>{brief.headline}</p>
          <div className="props">
            <div className="prop"><span className="k">Built from</span><span style={{ color: "var(--ink-2)" }}>{factCount - webCount} sourced facts from Cala{webCount ? ` · ${webCount} web lead${webCount > 1 ? "s" : ""}` : ""}{notes.length ? ` · ${notesUsed || notes.length} of your notes` : ""}</span></div>
            <div className="prop"><span className="k">Written by</span><span style={{ color: "var(--ink-2)" }}>{brief.generatedBy === "claude" ? `Claude (${brief.model})` : "Groundwork, without AI synthesis"}</span></div>
          </div>
        </div>

        {notesChanged && onUpdate && (
          <div className="callout">
            <span style={{ width: 26, height: 26, borderRadius: 6, background: "var(--sun)", borderBottom: "3px solid var(--sun-edge)", transform: "rotate(-6deg)", flex: "none" }} />
            <span style={{ flex: 1, fontSize: 15, color: "#4a3a0a" }}>Your notes changed since this brief was written.</span>
            <button className="btn primary small" onClick={onUpdate}>Update brief</button>
          </div>
        )}
        {brief.warning && <div className="callout" style={{ background: "var(--line-2)" }}><Mark kind="unk" /><span style={{ fontSize: 14.5, color: "var(--ink-2)" }}>{brief.warning}</span></div>}

        {brief.sections.map((s, i) => (
          <section key={i} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h2 style={{ marginBottom: 6 }}>{s.title}</h2>
            {s.claims.map((c, j) => claimRow(c, `${i}-${j}`))}
          </section>
        ))}

        {brief.comparables.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <h2 style={{ marginBottom: 6 }}>Comparable cases</h2>
            {brief.comparables.map((c, i) => {
              const k = `cmp-${i}`;
              const isOpen = !!open[k];
              return (
                <div key={k}>
                  <button className={`toggle ${isOpen ? "open" : ""}`} onClick={() => toggle(k)} aria-expanded={isOpen}>
                    <span className="tri"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M8 4v16l11-8z" /></svg></span>
                    <span style={{ flex: 1 }}><b style={{ fontWeight: 600 }}>{c.name}</b> · <span style={{ color: "var(--ink-2)" }}>{c.whyRelevant}</span></span>
                    <Mark kind="ai" title="Comparison: a hypothesis, not a prediction" />
                  </button>
                  {isOpen && (
                    <div className="inside" style={{ borderLeftColor: "var(--pink-soft)", gap: 8, padding: "4px 0 6px 16px" }}>
                      {c.differences && <div style={{ fontSize: 14.5 }}><b style={{ fontWeight: 600 }}>Where it differs.</b> {c.differences}</div>}
                      {c.raisesQuestion && <div style={{ fontSize: 14.5 }}><b style={{ fontWeight: 600 }}>Question it raises.</b> {c.raisesQuestion}</div>}
                      {!readOnly && c.entityId && <button className="btn ghost small" style={{ alignSelf: "flex-start" }} onClick={() => onSelect({ type: "node", id: c.entityId! })}>See {c.name}</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {brief.gaps.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2>Still unknown</h2>
            <div className="chiprow">
              {brief.gaps.map((g, i) => <span key={i} className="pill" style={{ padding: "7px 12px", borderRadius: 10, fontSize: 14 }} title={g.whyItMatters}>{g.title}</span>)}
            </div>
          </section>
        )}

        {keyQuestion && (
          <section className="keyq" style={{ padding: "22px 24px", borderRadius: 20, borderBottomWidth: 5 }}>
            <span className="qmark" style={{ width: 52, height: 52, fontSize: 28, borderRadius: 16 }}>?</span>
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="nu" style={{ fontWeight: 800, fontSize: 13, color: "var(--coral-ink)" }}>The question that matters most</span>
              <span className="nu" style={{ fontWeight: 900, fontSize: 22, lineHeight: 1.3 }}>{keyQuestion}</span>
            </span>
          </section>
        )}

        {actions.length > 0 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2>Next steps</h2>
            {actions.map((a, i) => (
              <label className="check" key={i}>
                <input type="checkbox" />
                <span className="box"><Icon name="check" size={13} color="#fff" stroke={4} /></span>
                <span className="ctext">{a}</span>
              </label>
            ))}
          </section>
        )}

        {brief.questions.length > 1 && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2>Questions for the founders</h2>
            <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 8, fontSize: 16, lineHeight: 1.5 }}>
              {brief.questions.slice(1).map((q, i) => <li key={i}>{q}</li>)}
            </ol>
          </section>
        )}

        {(people.length > 0 || experts.length > 0) && (
          <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <h2>Someone worth talking to</h2>
            {people.map(({ h, ask }) => (
              <div className="helper-card" key={h.id}>
                <span className="av" style={{ ...avatarColors(h.name), width: 44, height: 44 }}>{initials(h.name)}</span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="row"><b className="nu" style={{ fontSize: 17 }}>{h.name}</b><Mark kind="pub" /></span>
                  <span style={{ fontSize: 14.5, color: "var(--ink-2)" }}>{h.relevance}</span>
                  {h.route && <span className="small muted">{h.route}</span>}
                  <span style={{ fontSize: 14.5 }}><b>Ask:</b> “{ask}”</span>
                </span>
              </div>
            ))}
            {experts.map((x, i) => (
              <div className="helper-card" key={i}>
                <span className="ico" style={{ width: 44, height: 44, borderRadius: 14, background: "var(--teal-soft)" }}><Icon name="team" size={20} color="var(--teal)" stroke={2.3} /></span>
                <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="row"><b className="nu" style={{ fontSize: 17 }}>{x.type}</b><span className="pill">Suggested type</span></span>
                  <span style={{ fontSize: 14.5 }}><b>Ask:</b> “{x.whatToAsk}”</span>
                </span>
              </div>
            ))}
          </section>
        )}

        <div className="row wrap" style={{ gap: 18, paddingTop: 18, borderTop: "1px solid var(--line-2)", fontSize: 13, color: "var(--faint)" }}>
          <span className="legend" style={{ position: "static" }}><Legend /><span><Mark kind="ai" /> Interpretation</span></span>
          <span>Supports your judgment; not an investment recommendation.</span>
        </div>
      </article>
    </div>
  );
}
