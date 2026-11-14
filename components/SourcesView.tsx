"use client";
import type { Status } from "./App";

export default function SourcesView({ status, queries }: { status: Status; queries: number }) {
  const rows = [
    {
      ico: "C", color: "var(--cala)", name: "Cala",
      desc: "Public data layer: companies, people, funding rounds, investors and the links between them. Every value comes with its source.",
      state: status?.cala ? `Connected${queries ? ` · ${queries} queries this session` : ""}` : "Not configured: add CALA_API_KEY",
      ok: !!status?.cala,
    },
    {
      ico: "N", color: "var(--note)", name: "Your notes",
      desc: "Notes and context you add during a research session. Kept in this app. Sent to Claude to write the brief, never sent to Cala.",
      state: "Provided per research", ok: true,
    },
    {
      ico: "A", color: "var(--ink)", name: "Claude (analysis)",
      desc: "Turns retrieved evidence and your notes into a brief. Only sees what's on this page; every fact must cite Cala evidence.",
      state: status?.claude ? `Connected · ${status.model}` : "Not configured: briefs list sourced facts only",
      ok: !!status?.claude,
    },
    { ico: "N", color: "#000", name: "Notion", desc: "Bring in selected meeting notes or deal memos as private context.", state: "Not connected · coming soon", ok: false, soon: true },
    { ico: "@", color: "#6d717a", name: "Email", desc: "Founder threads and intros, with your permission per message.", state: "Not connected · coming soon", ok: false, soon: true },
    { ico: "M", color: "var(--conn)", name: "AI meeting notes", desc: "Transcripts from founder calls, linked back to the original.", state: "Not connected · coming soon", ok: false, soon: true },
  ];
  return (
    <div className="sources">
      <h1>Sources</h1>
      <p className="muted">What a research session can use. Groundwork never claims a source was searched unless it was.</p>
      <div className="src-grid">
        {rows.map((r) => (
          <div className="src card" key={r.name} style={{ opacity: r.soon ? 0.75 : 1 }}>
            <div className="src-ico" style={{ background: r.color }}>{r.ico}</div>
            <div>
              <h4>{r.name}</h4>
              <p>{r.desc}</p>
            </div>
            <span className="pill"><span className={`dot ${r.ok ? "ok" : r.soon ? "" : "err"}`} />{r.state}</span>
          </div>
        ))}
      </div>
      <p className="muted small" style={{ marginTop: 24 }}>
        Privacy: the Cala API key lives on the server only. Your notes are never included in Cala queries. Encryption, self-hosting and one-way data flow are goals for later, not guarantees of this prototype.
      </p>
    </div>
  );
}
