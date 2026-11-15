"use client";
import { useEffect, useState } from "react";
import { Icon, Mark } from "./ui";

const SEEN_KEY = "gw-onboarded-v1";

export function hasSeenOnboarding() {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // storage blocked: don't nag on every load
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {}
}

type Step = { kicker: string; title: string; body: React.ReactNode };

const PATH: { label: string; what: string; call: string }[] = [
  { label: "Find the company", what: "Matches the name you typed to one Cala entity, and asks you to confirm it.", call: "entity search" },
  { label: "Read the profile", what: "Learns which fields Cala holds, then fetches only those: description, stage, HQ, funding, headcount.", call: "introspection + retrieval" },
  { label: "Team and funding", what: "The same lookup also follows links to founders, executives, rounds and investors.", call: "retrieval with relationships" },
  { label: "Earlier work", what: "For each founder: where they worked or founded before, with dates and sources.", call: "retrieval per person" },
  { label: "People who could help", what: "Founders of other companies the same investors backed, or colleagues at the same earlier employers.", call: "retrieval per investor / employer" },
  { label: "Comparable cases", what: "Companies that tackled a similar problem, including ones that were acquired or struggled.", call: "knowledge search" },
  { label: "What's still unknown", what: "Everything public data can't answer, turned into questions for the meeting.", call: "no query: listed, never guessed" },
];

const LAYERS: { mark: "pub" | "web" | "note" | "ai"; name: string; text: string; tint: string }[] = [
  { mark: "pub", name: "Cala public data", text: "The backbone. Companies, people, rounds and investors, and the links between them. Every value carries its own sources.", tint: "var(--blue-soft)" },
  { mark: "web", name: "Open web (optional)", text: "For founders too new to be in Cala: pages that name them, labelled as leads to check, never as records.", tint: "var(--web-soft)" },
  { mark: "note", name: "Your notes", text: "What you heard in calls, hunches, your own questions. Private, never sent to Cala.", tint: "var(--sun)" },
  { mark: "ai", name: "The brief", text: "Claude writes it only from the evidence above. Each claim links back to where it came from.", tint: "#fff" },
];

function steps(): Step[] {
  return [
    {
      kicker: "Welcome",
      title: "Prepare for your next founder meeting",
      body: (
        <>
          <p className="ob-lead">
            Groundwork researches the founders and company you're about to meet, using <b>Cala's public data</b>, and lays it out on a desk you can read in a minute.
          </p>
          <div className="ob-grid">
            {[
              ["team", "Who the founders are", "and where they worked before"],
              ["coins", "How it's funded", "rounds, leads and co-investors"],
              ["path", "Who could help", "people one step away from the founders"],
              ["help", "What's still unknown", "turned into questions to ask"],
            ].map(([ico, a, b]) => (
              <div key={a} className="ob-tile">
                <Icon name={ico} size={18} />
                <b>{a}</b>
                <span>{b}</span>
              </div>
            ))}
          </div>
          <p className="ob-small">It supports your judgement. It never tells you to invest or pass.</p>
        </>
      ),
    },
    {
      kicker: "How the research works",
      title: "Every step is a real query you can watch",
      body: (
        <>
          <p className="ob-lead">The research runs in order, and the desk fills in as each answer arrives. Nothing is pre-written.</p>
          <ol className="ob-path">
            {PATH.map((p, i) => (
              <li key={p.label}>
                <span className="ob-num">{i + 1}</span>
                <span className="ob-txt">
                  <b>{p.label}</b>
                  <span>{p.what}</span>
                </span>
                <span className="ob-call">{p.call}</span>
              </li>
            ))}
          </ol>
          <p className="ob-small">
            Click the progress bar at the bottom of the desk to see each lookup: the exact request sent to Cala and what came back.
          </p>
        </>
      ),
    },
    {
      kicker: "How the data is enriched",
      title: "One name becomes a map of sourced facts",
      body: (
        <>
          <p className="ob-lead">
            Cala connects entities to each other. Groundwork walks those links outward, one hop at a time, and keeps the source of every fact it picks up.
          </p>
          <div className="ob-chain" aria-label="Enrichment chain">
            <span className="ob-node c">Company</span>
            <span className="ob-arrow">→</span>
            <span className="ob-node">Founders</span>
            <span className="ob-arrow">→</span>
            <span className="ob-node">Their earlier companies</span>
            <span className="ob-arrow">→</span>
            <span className="ob-node">Colleagues there</span>
          </div>
          <div className="ob-chain" aria-label="Enrichment chain">
            <span className="ob-node c">Company</span>
            <span className="ob-arrow">→</span>
            <span className="ob-node">Investors</span>
            <span className="ob-arrow">→</span>
            <span className="ob-node">Their other companies</span>
            <span className="ob-arrow">→</span>
            <span className="ob-node">Those founders</span>
          </div>
          <div className="ob-layers">
            {LAYERS.map((l) => (
              <div key={l.name} className="ob-layer" style={{ background: l.tint }}>
                <Mark kind={l.mark} />
                <span>
                  <b>{l.name}</b> {l.text}
                </span>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      kicker: "What you can trust",
      title: "Every fact shows where it came from",
      body: (
        <>
          <p className="ob-lead">Small marks tell you what kind of information you're looking at.</p>
          <div className="ob-legend">
            <div><Mark kind="pub" /><b>Public data</b><span>From Cala, with its sources. Click to see them.</span></div>
            <div><Mark kind="web" /><b>Web lead</b><span>A page that mentions them. Check it's the right person.</span></div>
            <div><Mark kind="note" /><b>Your note</b><span>Something you wrote. Only you see it.</span></div>
            <div><Mark kind="ai" /><b>Interpretation</b><span>A hypothesis drawn from the evidence, worded as one.</span></div>
            <div><Mark kind="unk" /><b>Unknown</b><span>Not in public data. Shown as missing, never filled in.</span></div>
          </div>
          <ul className="ob-rules">
            <li><Icon name="check" size={14} stroke={3} /> "Cala has no record of…" never becomes "they have no…"</li>
            <li><Icon name="check" size={14} stroke={3} /> People who could help are possible routes, not known relationships</li>
            <li><Icon name="check" size={14} stroke={3} /> No scores, predictions or invest/pass verdicts</li>
          </ul>
        </>
      ),
    },
    {
      kicker: "Start",
      title: "Two ways to begin",
      body: (
        <>
          <div className="ob-ways">
            <div className="ob-way">
              <span className="ob-way-ico" style={{ background: "var(--blue-soft)", color: "var(--blue-dark)" }}><Icon name="search" size={18} /></span>
              <b>The company has a public record</b>
              <span>Type its name, or a question like "I'm meeting the founders of Aiven". Pick the right match and the research starts.</span>
            </div>
            <div className="ob-way">
              <span className="ob-way-ico" style={{ background: "var(--green-soft)", color: "var(--green-dark)" }}><Icon name="team" size={18} /></span>
              <b>It's too new to be listed</b>
              <span>Choose "Not listed yet", then enter the founders' names and one sentence about the idea. Groundwork starts from the people.</span>
            </div>
          </div>
          <div className="ob-tips">
            <span><kbd>N</kbd> writes a note from anywhere</span>
            <span>Click any card to open its details</span>
            <span><b>Open the brief</b> when the desk is ready</span>
          </div>
        </>
      ),
    },
  ];
}

export default function Onboarding({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const all = steps();
  const last = i === all.length - 1;
  const done = () => {
    markSeen();
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done();
      if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, all.length - 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const s = all[i];
  return (
    <div className="scrim" onClick={done}>
      <div className="card ob" role="dialog" aria-modal="true" aria-labelledby="ob-title" onClick={(e) => e.stopPropagation()}>
        <div className="ob-top">
          <div className="ob-dots" aria-label={`Step ${i + 1} of ${all.length}`}>
            {all.map((_, k) => (
              <button key={k} className={k === i ? "on" : k < i ? "past" : ""} onClick={() => setI(k)} aria-label={`Go to step ${k + 1}`} />
            ))}
          </div>
          <button className="ob-skip" onClick={done}>Skip</button>
        </div>
        <span className="ob-kicker">{s.kicker}</span>
        <h2 id="ob-title" className="ob-title">{s.title}</h2>
        <div className="ob-body">{s.body}</div>
        <div className="ob-foot">
          {i > 0 ? <button className="btn ghost" onClick={() => setI(i - 1)}>Back</button> : <span />}
          <button className="btn primary big" onClick={() => (last ? done() : setI(i + 1))}>{last ? "Start researching" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}
