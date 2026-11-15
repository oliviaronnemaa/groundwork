"use client";
import { useMemo, useState } from "react";
import type { LibraryField, LibraryRecord, NodeKind, Source } from "@/lib/types";

export const KIND_COLOR: Record<NodeKind, string> = {
  company: "var(--k-company)",
  person: "var(--k-person)",
  investor: "var(--k-investor)",
  round: "var(--k-round)",
  portfolio: "var(--k-portfolio)",
  comparable: "var(--k-comparable)",
  context: "var(--k-context)",
};

export const KIND_LABEL: Record<NodeKind, string> = {
  company: "Company",
  person: "Person",
  investor: "Investor",
  round: "Funding round",
  portfolio: "Portfolio company",
  comparable: "Comparable",
  context: "Context",
};

export function Sources({ sources }: { sources: Source[] }) {
  if (!sources?.length) return <div className="srcs"><span>Source not itemised by Cala</span></div>;
  return (
    <div className="srcs">
      {sources.map((s, i) => {
        const label = s.name || host(s.url) || "source";
        const inner = (
          <>
            {s.rank && <span className={`rank${s.web ? " web" : ""}`}>{s.rank}</span>}
            {label}
            {s.date ? ` · ${s.date}` : ""}
          </>
        );
        return s.url && /^https?:/.test(s.url) ? (
          <a key={i} href={s.url} target="_blank" rel="noreferrer">{inner}</a>
        ) : (
          <span key={i}>{inner}</span>
        );
      })}
    </div>
  );
}

function host(u?: string) {
  try {
    return u ? new URL(u).hostname.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}

export function Spinner() {
  return <div className="spinner" aria-label="Loading" />;
}

function norm(s: string) {
  return s.toLowerCase().replace(/\b(oy|ab|inc|ltd|gmbh|oyj|llc|corp|limited)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
}

/** Confirm before anything is written to the library; flag likely duplicates instead of merging them. */
export function SaveModal({
  record,
  library,
  onCancel,
  onConfirm,
  extras = [],
}: {
  record: LibraryRecord;
  library: LibraryRecord[];
  onCancel: () => void;
  onConfirm: (r: LibraryRecord, extras: LibraryRecord[]) => void;
  extras?: LibraryRecord[];
}) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(extras.map((x) => x.id)));
  const togglePick = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const existing = library.find((r) => r.id === record.id);
  const similar = useMemo(
    () => library.filter((r) => r.id !== record.id && r.type === record.type && (norm(r.name) === norm(record.name) || (norm(r.name).length > 3 && norm(record.name).includes(norm(r.name))))),
    [library, record],
  );
  const [notes, setNotes] = useState(existing?.notes ?? record.notes ?? "");
  const fields: LibraryField[] = record.fields;
  return (
    <div className="scrim" onClick={onCancel}>
      <div className="modal card" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h3>{existing ? `Update ${record.name} in your library?` : `Save ${record.name} to your library?`}</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          {record.type === "research"
            ? "Saves the question, brief, evidence and your notes so you can come back to this research."
            : `${fields.length} sourced field${fields.length === 1 ? "" : "s"} from Cala. You can add your own fields and notes afterwards.`}
        </p>
        {similar.length > 0 && (
          <div className="warn">
            Possible duplicate: {similar.map((s) => s.name).join(", ")} is already in your library as a different Cala entity. It will be saved separately so you can review both.
          </div>
        )}
        {record.type !== "research" && (
          <table className="fields">
            <tbody>
              {fields.slice(0, 14).map((f, i) => (
                <tr key={i}>
                  <td>{f.label}</td>
                  <td>{f.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {extras.length > 0 && (
          <div className="save-extras">
            <b className="nu">Also save their profiles</b>
            <span className="small muted">Each becomes its own record in your library, with every sourced field. Records you already have are updated and keep your own fields and notes.</span>
            <div className="save-list">
              {extras.map((x) => {
                const had = library.some((r) => r.id === x.id);
                return (
                  <label key={x.id} className="save-item">
                    <input type="checkbox" checked={picked.has(x.id)} onChange={() => togglePick(x.id)} />
                    <span className="tile" style={{ width: 24, height: 24, borderRadius: 7, fontSize: 12, background: colorFor(x.name) }}>{x.name.charAt(0).toUpperCase()}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontWeight: 600 }}>{x.name}</span>
                      <span className="small muted"> · {x.type}{x.fields.length ? ` · ${x.fields.length} fields` : ""}{had ? " · update" : ""}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
        <label className="label" htmlFor="save-notes">Your notes (optional)</label>
        <textarea id="save-notes" className="field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you think, what to follow up on…" />
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
          <button className="btn ghost" onClick={onCancel}>Cancel</button>
          <button className="btn primary" onClick={() => onConfirm({ ...record, notes, fields: existing ? mergeFields(existing.fields, fields) : fields }, extras.filter((x) => picked.has(x.id)))}>
            {existing ? "Update record" : "Save record"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function mergeFields(old: LibraryField[], fresh: LibraryField[]) {
  // Keep the investor's own fields; refresh the sourced ones.
  return [...fresh, ...old.filter((f) => f.provenance !== "cala")];
}

// ---------------------------------------------------------------------------
// v2 helpers: icons, page colours, provenance marks

const PALETTE = ["#2e9e5b", "#2f7fe0", "#ff7a59", "#8b6cef", "#13a8a0", "#e8578a", "#f08a24"];
export function colorFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string) {
  return name
    .replace(/\b(Oy|Ab|Inc|Ltd|GmbH|Oyj|LLC|N\.V\.|Corp)\b\.?/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const PATHS: Record<string, string> = {
  search: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.2-4.2",
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  note: "M5 4h11l3 3v13H5zM9 10h6M9 14h6",
  library: "M4 5h4v15H4zM10 5h4v15h-4zM16 6l3.5-1 3 14-3.5 1z",
  globe: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16",
  team: "M9 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM3 20c.8-3.5 3.2-5 6-5s5.2 1.5 6 5M16 4.5a3.5 3.5 0 0 1 0 7M18.5 15c1.4.8 2.2 2.4 2.5 5",
  briefcase: "M3 7h18v13H3zM9 7V5h6v2M3 12h18",
  box: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  chart: "M4 19V5M4 19h16M8 15l4-4 3 3 5-6",
  coins: "M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6",
  scale: "M12 3v18M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0zM8 21h8",
  help: "M7 12l3 3 7-7M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5 9-10",
  chevron: "M9 6l6 6-6 6",
  mic: "M9 2h6v12H9zM5 10a7 7 0 0 0 14 0M12 17v5",
  pencil: "M4 20h4L19 9l-4-4L4 16z",
  plus: "M12 5v14M5 12h14",
  path: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  calendar: "M4 5h16v15H4zM8 3v4M16 3v4M4 10h16",
  map: "M9 4l6 2 5-2v14l-5 2-6-2-5 2V6zM9 4v14M15 6v14",
};

export function Icon({ name, size = 16, color = "currentColor", stroke = 2 }: { name: keyof typeof PATHS | string; size?: number; color?: string; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name] ?? PATHS.box} />
    </svg>
  );
}

/** Where a fact came from, as a small mark instead of a text badge. */
export function Mark({ kind, title }: { kind: "pub" | "note" | "unk" | "ai" | "web"; title?: string }) {
  const t = title ?? { pub: "Public data from Cala", note: "Your note", unk: "Unknown", ai: "Interpretation", web: "Found on the open web: a lead to check, not a verified record" }[kind];
  return (
    <span className={`mark ${kind}`} title={t} aria-label={t} role="img">
      {kind === "pub" && <Icon name="globe" size={11} stroke={2.6} />}
      {kind === "web" && <Icon name="search" size={10} stroke={2.8} />}
      {kind === "note" && <Icon name="pencil" size={10} stroke={2.8} />}
      {kind === "unk" && "?"}
      {kind === "ai" && <Icon name="chevron" size={10} stroke={2.6} />}
    </span>
  );
}

export function Legend() {
  return (
    <>
      <span><Mark kind="pub" /> Public data</span>
      <span><Mark kind="web" /> Web lead</span>
      <span><Mark kind="note" /> Your notes</span>
      <span><Mark kind="unk" /> Unknown</span>
    </>
  );
}
