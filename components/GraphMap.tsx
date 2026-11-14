"use client";
import { useMemo } from "react";
import type { Evidence, GraphEdge, GraphNode, Helper, NodeKind } from "@/lib/types";
import type { Selection } from "./Inspector";
import { KIND_COLOR, KIND_LABEL } from "./ui";

type P = { x: number; y: number };

// Sector (degrees; 0 = right, 90 = down) and radius for each kind, around the company at the centre.
const LAYOUT: Partial<Record<NodeKind, { from: number; to: number; r: number }>> = {
  person: { from: -165, to: -20, r: 220 },
  round: { from: -10, to: 45, r: 175 },
  investor: { from: -45, to: 80, r: 330 },
  portfolio: { from: -25, to: 70, r: 480 },
  comparable: { from: 105, to: 165, r: 250 },
  context: { from: 172, to: 215, r: 200 },
};

export function highlightIds(sel: Selection, evidence: Evidence[], helpers: Helper[], nodes: GraphNode[]): Set<string> | null {
  if (!sel) return null;
  const evToEntities = (ids: string[]) => evidence.filter((e) => ids.includes(e.id)).map((e) => e.entityId);
  switch (sel.type) {
    case "node":
      return new Set([sel.id]);
    case "claim":
      return new Set(evToEntities(sel.claim.evidence));
    case "evidence":
      return new Set(evToEntities(sel.ids));
    case "helper": {
      const h = helpers.find((x) => x.id === sel.id);
      return h ? new Set([h.personId, ...evToEntities(h.evidence)]) : null;
    }
    case "note":
    case "cluster":
      return null;
    case "call":
      return new Set([...nodes.filter((n) => n.callId === sel.id).map((n) => n.id), ...evidence.filter((e) => e.callId === sel.id).map((e) => e.entityId)]);
  }
}

export default function GraphMap({
  nodes,
  edges,
  evidence,
  helpers,
  sel,
  onSelect,
  noteCounts = {},
}: {
  noteCounts?: Record<string, number>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  evidence: Evidence[];
  helpers: Helper[];
  sel: Selection;
  onSelect: (s: Selection) => void;
}) {
  const { pos, box } = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const hl = useMemo(() => highlightIds(sel, evidence, helpers, nodes), [sel, evidence, helpers, nodes]);

  // Neighbours of a selected node light up too.
  const lit = useMemo(() => {
    if (!hl) return null;
    const s = new Set(hl);
    if (sel?.type === "node") for (const e of edges) {
      if (e.from === sel.id) s.add(e.to);
      if (e.to === sel.id) s.add(e.from);
    }
    return s;
  }, [hl, edges, sel]);

  if (!nodes.length) return <div className="map-empty">The map grows as Cala answers each query.</div>;
  const counts = nodes.reduce<Record<string, number>>((a, n) => ((a[n.kind] = (a[n.kind] ?? 0) + 1), a), {});

  return (
    <div className="map-wrap">
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" onClick={() => onSelect(null)} role="img" aria-label="Research map">
        {[175, 330].map((r) => <circle key={r} className="ring" cx={0} cy={0} r={r} />)}
        {edges.map((e) => {
          const a = pos.get(e.from), b = pos.get(e.to);
          if (!a || !b) return null;
          const hot = lit && lit.has(e.from) && lit.has(e.to) && (!hl || hl.has(e.from) || hl.has(e.to));
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const dx = b.x - a.x, dy = b.y - a.y;
          const cx = mx - dy * 0.08, cy = my + dx * 0.08;
          return (
            <g key={e.id}>
              <path className={`gedge ${hot ? "hot" : lit ? "dim" : ""}`} d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`} />
              {hot && <text className="elabel" x={cx} y={cy} textAnchor="middle">{e.label}</text>}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const isCo = n.kind === "company";
          const r = isCo ? 30 : n.kind === "investor" || n.kind === "comparable" || n.kind === "portfolio" ? 10 : n.kind === "context" ? 6 : 9;
          const selected = sel?.type === "node" && sel.id === n.id;
          const dim = lit && !lit.has(n.id);
          const color = KIND_COLOR[n.kind];
          const isHelper = helpers.some((h) => h.personId === n.id);
          return (
            <g
              key={n.id}
              className={`gnode ${dim ? "dim" : ""}`}
              transform={`translate(${p.x},${p.y})`}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelect({ type: "node", id: n.id });
              }}
            >
              {selected && <circle r={r + 6} fill="none" stroke={color} strokeWidth={1.5} opacity={0.5} />}
              {isHelper && <circle r={r + 3.5} fill="none" stroke="var(--k-person)" strokeDasharray="2 2" />}
              <circle r={r} fill={n.kind === "round" || n.kind === "context" ? "var(--surface)" : color} stroke={color} strokeWidth={n.kind === "round" || n.kind === "context" ? 2 : 0} />
              {noteCounts[n.id] ? (
                <g transform={`translate(${r * 0.75},${-r * 0.75})`}>
                  <circle r={7} fill="var(--note)" stroke="var(--bg)" strokeWidth={1.5} />
                  <text y={3} textAnchor="middle" style={{ fill: "#fff", stroke: "none", fontSize: 8.5, fontWeight: 700 }}>{noteCounts[n.id]}</text>
                </g>
              ) : null}
              {isCo ? (
                <>
                  <text y={4} textAnchor="middle" style={{ fill: "#fff", stroke: "none", fontWeight: 650, fontSize: 11 }}>{initials(n.name)}</text>
                  <text y={r + 16} textAnchor="middle" style={{ fontWeight: 650, fontSize: 13 }}>{trunc(n.name, 28)}</text>
                  {n.subtitle && <text className="sub" y={r + 29} textAnchor="middle">{n.subtitle}</text>}
                </>
              ) : (
                <>
                  <text y={r + 13} textAnchor="middle">{trunc(n.name, 22)}</text>
                  {n.subtitle && (n.kind !== "context" || selected) && <text className="sub" y={r + 25} textAnchor="middle">{trunc(n.subtitle, 26)}</text>}
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {(Object.keys(KIND_LABEL) as NodeKind[]).filter((k) => counts[k]).map((k) => (
          <span key={k}><i style={{ background: KIND_COLOR[k] }} />{KIND_LABEL[k]} {k !== "company" ? counts[k] : ""}</span>
        ))}
        {helpers.length > 0 && <span><i style={{ border: "1px dashed var(--k-person)", background: "transparent" }} />Could help</span>}
        {Object.keys(noteCounts).some((id) => nodes.some((n) => n.id === id)) && <span><i style={{ background: "var(--note)" }} />Has your notes</span>}
      </div>
    </div>
  );
}

function layout(nodes: GraphNode[], edges: GraphEdge[]) {
  const pos = new Map<string, P>();
  const center = nodes.find((n) => n.kind === "company");
  if (center) pos.set(center.id, { x: 0, y: 0 });
  const cid = center?.id;
  const touchesCenter = (id: string) => edges.some((e) => (e.from === id && e.to === cid) || (e.to === id && e.from === cid));

  // Satellites: nodes only linked to something other than the centre sit next to that thing.
  const primary: GraphNode[] = [];
  const satellites: GraphNode[] = [];
  for (const n of nodes) {
    if (n.id === cid) continue;
    const isSatellite = (n.kind === "person" || n.kind === "context") && !touchesCenter(n.id) && edges.some((e) => e.from === n.id || e.to === n.id);
    (isSatellite ? satellites : primary).push(n);
  }
  const groups = new Map<NodeKind, GraphNode[]>();
  for (const n of primary) groups.set(n.kind, [...(groups.get(n.kind) ?? []), n]);
  for (const [kind, list] of groups) {
    const L = LAYOUT[kind] ?? LAYOUT.context!;
    const span = L.to - L.from;
    // Spread wide groups across two rings so labels don't collide.
    const perRing = Math.max(4, Math.floor(span / 11));
    list.forEach((n, i) => {
      const ring = Math.floor(i / perRing);
      const inRing = Math.min(perRing, list.length - ring * perRing);
      const k = i % perRing;
      const t = inRing === 1 ? 0.5 : k / (inRing - 1);
      const a = ((L.from + span * t + (ring % 2) * (span / perRing / 2)) * Math.PI) / 180;
      const r = L.r + ring * 70;
      pos.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r });
    });
  }
  // Place satellites outward from their anchor, fanned by index.
  const fan = new Map<string, number>();
  for (const n of satellites) {
    const anchorId = edges.find((e) => e.from === n.id && pos.has(e.to))?.to ?? edges.find((e) => e.to === n.id && pos.has(e.from))?.from;
    const anchor = anchorId ? pos.get(anchorId) : undefined;
    if (!anchor) {
      const L = LAYOUT.context!;
      pos.set(n.id, { x: Math.cos((L.from * Math.PI) / 180) * (L.r + 120), y: Math.sin((L.from * Math.PI) / 180) * (L.r + 120) });
      continue;
    }
    const i = fan.get(anchorId!) ?? 0;
    fan.set(anchorId!, i + 1);
    const base = Math.atan2(anchor.y, anchor.x) || -Math.PI / 2;
    const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.32;
    const d = 95 + Math.floor(i / 5) * 40;
    pos.set(n.id, { x: anchor.x + Math.cos(a) * d, y: anchor.y + Math.sin(a) * d });
  }
  let minX = -260, maxX = 260, minY = -260, maxY = 260;
  for (const p of pos.values()) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const pad = 80;
  return { pos, box: { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 } };
}

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function initials(s: string) {
  return s.replace(/\b(Oy|Ab|Inc|Ltd|GmbH|Oyj|LLC)\b\.?/g, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}
