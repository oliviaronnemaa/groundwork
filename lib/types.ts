// Shared types between the research pipeline (server) and the workspace UI (client).

export type SourceRank = "FILING" | "PRIMARY" | "PRESS" | "AGGREGATOR" | string;

export type Source = {
  name?: string;
  url?: string;
  date?: string;
  rank?: SourceRank;
};

export type CalaTool =
  | "entity_search"
  | "entity_introspection"
  | "entity_retrieval"
  | "knowledge_search";

export type CallLog = {
  id: string;
  stepId: string;
  tool: CalaTool;
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  status: "running" | "ok" | "error";
  ms?: number;
  summary?: string;
  error?: string;
  startedAt: number;
  cached?: boolean; // served from Groundwork's local cache of an earlier Cala response
};

export type NodeKind =
  | "company" // the company being researched
  | "person"
  | "investor"
  | "round"
  | "comparable"
  | "portfolio" // another company in an investor's portfolio
  | "context"; // industry, place, event

export type GraphNode = {
  id: string; // Cala entity id (or synthetic for rounds without one)
  name: string;
  kind: NodeKind;
  entityType?: string;
  subtitle?: string;
  callId: string;
};

export type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  callId: string;
  sources: Source[];
};

export type Evidence = {
  id: string; // E1, E2…
  entityId: string;
  entityName: string;
  field: string;
  label: string;
  value: string;
  sources: Source[];
  callId: string;
};

export type Gap = {
  id: string;
  title: string;
  why: string;
};

/** A person who might help close a gap, derived only from sourced graph links. */
export type Helper = {
  id: string; // H1, H2…
  personId: string;
  name: string;
  basis: "shared-investor" | "comparable-company" | "shared-employer";
  relevance: string; // observable reason, e.g. "Founded X (fintech)"
  route?: string; // e.g. "Lifeline Ventures backed both X and Y"
  evidence: string[]; // evidence ids
};

export type StepStatus = "pending" | "running" | "done" | "error" | "skipped";

export type StepState = {
  id: string;
  label: string;
  status: StepStatus;
  detail?: string;
};

export type ResearchEvent =
  | { type: "step"; step: StepState }
  | { type: "call"; call: CallLog }
  | { type: "node"; node: GraphNode }
  | { type: "edge"; edge: GraphEdge }
  | { type: "evidence"; evidence: Evidence }
  | { type: "gap"; gap: Gap }
  | { type: "helper"; helper: Helper }
  | { type: "ask"; ask: { id: string; text: string } }
  | { type: "done" }
  | { type: "fatal"; message: string };

export type NoteKind = "observation" | "meeting" | "reference" | "question" | "hunch";

export type NoteLink = { id: string; name: string; kind?: NodeKind | "tag" };

/** A private note. Persisted on its own, so it outlives any one research session. */
export type Note = {
  id: string; // N1, N2… unique across all sessions
  text: string;
  at: number;
  kind: NoteKind;
  links: NoteLink[]; // companies / people / investors it's about
  sessionId?: string;
  sessionLabel?: string;
  source: "typed" | "voice";
  aiExcluded?: boolean; // never sent to Claude
  citedIn?: string[]; // briefs that cited it
};

export type ClaimKind = "fact" | "note" | "interpretation";

export type Claim = {
  text: string;
  kind: ClaimKind;
  evidence: string[];
  notes: string[];
};

export type Brief = {
  headline: string;
  sections: { title: string; claims: Claim[] }[];
  comparables: {
    name: string;
    entityId?: string;
    whyRelevant: string;
    differences: string;
    raisesQuestion: string;
    evidence: string[];
  }[];
  gaps: {
    title: string;
    whyItMatters: string;
    actions: string[];
    helpers: { helperId: string; whatToAsk: string }[];
    expertTypes: { type: string; whatToAsk: string }[];
  }[];
  questions: string[];
  generatedBy: "claude" | "rules";
  model?: string;
  warning?: string;
};

export type Candidate = {
  id: string;
  name: string;
  entityType: string;
  description: string | null;
};

export type InterpretResult = {
  companyQuery: string | null;
  focus: string;
  questions: { id: string; text: string }[];
  candidates: Candidate[];
  call?: CallLog;
  interpretedBy: "claude" | "rules";
};

export type LibraryField = {
  label: string;
  value: string;
  provenance: "cala" | "note" | "ai";
  sources?: Source[];
};

export type LibraryRecord = {
  id: string; // Cala entity id, or "research:<uuid>"
  type: "company" | "person" | "investor" | "research";
  name: string;
  fields: LibraryField[];
  notes: string;
  savedAt: string;
  updatedAt: string;
  brief?: Brief;
  question?: string;
  evidence?: Evidence[];
  helpers?: Helper[];
  notesList?: Note[];
};
