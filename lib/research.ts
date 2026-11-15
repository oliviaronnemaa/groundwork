import "server-only";
import { Exa, hostOf, type ExaResult } from "./exa";
import { Cala, normSources, fmtDate, type Entity, type Introspection, type RelItem, type RetrieveBody } from "./cala";
import type { Evidence, Gap, GraphEdge, GraphNode, Helper, NodeKind, ResearchEvent, Source, StepState, StepStatus } from "./types";

/**
 * The research pipeline. Every node, edge and piece of evidence it emits comes
 * from a real Cala response; nothing here is simulated. Missing data is
 * reported as a gap, never filled in.
 */

const COMPANY_PROPS = [
  "name",
  "legal_name",
  "aliases",
  "website",
  "description",
  "founding_date",
  "headquarters_address",
  "operational_status",
  "company_ownership_status",
  "employee_count_range",
  "employee_count",
  "total_funding",
  "total_funding_units",
  "total_funding_excluding_debt",
  "total_funding_excluding_debt_units",
  "funding_stage",
];

const PROP_LABELS: Record<string, string> = {
  legal_name: "Legal name",
  aliases: "Also known as",
  website: "Website",
  description: "Description",
  founding_date: "Founded",
  headquarters_address: "Headquarters",
  operational_status: "Operating status",
  company_ownership_status: "Ownership status",
  employee_count_range: "Headcount",
  employee_count: "Headcount",
  total_funding: "Total funding",
  total_funding_excluding_debt: "Equity funding",
  funding_stage: "Funding stage",
};

const STEPS: { id: string; label: string }[] = [
  { id: "identify", label: "Identify the company" },
  { id: "profile", label: "Retrieve public profile" },
  { id: "team", label: "Map founders and team" },
  { id: "funding", label: "Trace funding rounds and investors" },
  { id: "people", label: "Explore founder backgrounds" },
  { id: "network", label: "Walk the investor network" },
  { id: "comparables", label: "Find comparable cases" },
  { id: "gaps", label: "Identify evidence gaps" },
];

type Ctx = {
  cala: Cala;
  emit: (e: ResearchEvent) => void;
  ev: Evidence[];
  nodes: Map<string, GraphNode>;
  edges: Set<string>;
  helpers: Helper[];
};

export async function runResearch(opts: {
  key: string;
  companyId: string;
  question: string;
  emit: (e: ResearchEvent) => void;
}) {
  const { emit } = opts;
  const ctx: Ctx = {
    cala: new Cala(opts.key, (call) => emit({ type: "call", call })),
    emit,
    ev: [],
    nodes: new Map(),
    edges: new Set(),
    helpers: [],
  };
  for (const s of STEPS) emit({ type: "step", step: { ...s, status: "pending" } });
  const step = (id: string, status: StepStatus, detail?: string) => {
    const s = STEPS.find((x) => x.id === id)!;
    const st: StepState = { ...s, status, detail };
    emit({ type: "step", step: st });
  };

  const cid = opts.companyId;

  // 1. Identify -----------------------------------------------------------
  step("identify", "running");
  let schema: Introspection;
  try {
    schema = (await ctx.cala.introspect("identify", cid)).data;
  } catch (e) {
    step("identify", "error", errMsg(e));
    emit({ type: "fatal", message: `Could not reach Cala for this company: ${errMsg(e)}` });
    return;
  }
  const has = schemaFilter(schema);
  step("identify", "done", `${schema.properties?.length ?? 0} fields and ${(schema.relationships?.incoming?.length ?? 0) + (schema.relationships?.outgoing?.length ?? 0)} relationship types available`);

  // 2. Profile ------------------------------------------------------------
  step("profile", "running");
  let company: Entity = {};
  let profileCallId = "";
  let companyName = "the company";
  try {
    const seriesIds = pickSeries(schema, /employee/i);
    const body: RetrieveBody = {
      properties: has.props(COMPANY_PROPS),
      relationships: {
        outgoing: has.out({ OPERATES_IN_INDUSTRY: { limit: 5 }, HAS_HEADQUARTERS_IN: { limit: 2 }, PARTICIPATES_IN_EVENT: { limit: 5 }, PARTICIPATES_IN_CORPORATE_EVENT: { limit: 8 }, PARTICIPATES_IN_FUNDING_ROUND: { limit: 25 } }),
        // Team and investors come back in the same query, saving round trips under Cala's rate limit.
        incoming: has.inc({ FOUNDED: { limit: 10 }, IS_CEO_OF: { limit: 4 }, IS_CTO_OF: { limit: 4 }, IS_VICEPRESIDENT_OF: { limit: 4 }, IS_BOARD_MEMBER_OF: { limit: 8 }, WORKS_AT: { limit: 12 }, INVESTED_IN: { limit: 40 } }),
      },
      ...(seriesIds ? { numerical_observations: seriesIds } : {}),
    };
    const { data, callId } = await ctx.cala.retrieve("profile", cid, body);
    company = data;
    profileCallId = callId;
    companyName = data.name || str(data.properties?.name?.value) || companyName;
    addNode(ctx, { id: cid, name: companyName, kind: "company", entityType: "Company", subtitle: str(data.properties?.funding_stage?.value)?.replace(/_/g, " ").toLowerCase(), callId });
    let n = 0;
    for (const [field, prop] of Object.entries(data.properties ?? {})) {
      if (field === "id" || field === "name" || field.endsWith("_units")) continue;
      const v = formatProp(field, prop.value, data.properties);
      if (!v) continue;
      addEv(ctx, cid, companyName, field, PROP_LABELS[field] ?? humanize(field), v, normSources(prop.sources), callId);
      n++;
    }
    for (const [rel, kind] of [["OPERATES_IN_INDUSTRY", "Industry"], ["HAS_HEADQUARTERS_IN", "Based in"], ["PARTICIPATES_IN_EVENT", "Event"]] as const) {
      for (const r of rels(data, "outgoing", rel)) {
        const label = rel === "OPERATES_IN_INDUSTRY" ? prettyCode(str(r.properties?.label) || r.name) : r.name;
        addNode(ctx, { id: r.id, name: label, kind: "context", entityType: r.entity_type, subtitle: kind.toLowerCase(), callId });
        addEdge(ctx, cid, r.id, kind === "Industry" ? "industry" : kind === "Based in" ? "based in" : str(r.properties?.role)?.toLowerCase() || "attends", relSources(r), callId);
        addEv(ctx, cid, companyName, rel, kind, label + (rel === "PARTICIPATES_IN_EVENT" && r.properties?.role ? ` (${String(r.properties.role).toLowerCase()})` : ""), relSources(r), callId);
      }
    }
    for (const r of rels(data, "outgoing", "PARTICIPATES_IN_CORPORATE_EVENT")) {
      const role = str(r.properties?.role);
      const when = str(r.properties?.event_date);
      addEv(ctx, cid, companyName, "corporate_event", "Corporate event", `${humanize(r.name)}${role ? ` as ${role.toLowerCase()}` : ""}${when ? ` (${fmtDate(when)})` : ""}`, relSources(r), callId);
    }
    const series = extractSeries(data.numerical_observations);
    if (series) addEv(ctx, cid, companyName, "employee_series", "Headcount over time", series.text, series.sources, callId);
    step("profile", "done", `${n} sourced fields`);
  } catch (e) {
    step("profile", "error", errMsg(e));
    emit({ type: "fatal", message: `Cala profile lookup failed: ${errMsg(e)}` });
    return;
  }

  // 3. Team ---------------------------------------------------------------
  step("team", "running");
  const people: { id: string; name: string; role: string }[] = [];
  try {
    const teamRels = has.inc({ FOUNDED: { limit: 10 }, IS_CEO_OF: { limit: 4 }, IS_CTO_OF: { limit: 4 }, IS_VICEPRESIDENT_OF: { limit: 4 }, IS_BOARD_MEMBER_OF: { limit: 8 }, WORKS_AT: { limit: 12 } });
    if (Object.keys(teamRels).length === 0) {
      step("team", "skipped", "Cala lists no team relationships for this company");
      emit({ type: "ask", ask: { id: "team", text: `Cala has no founder or team records for ${companyName}. Do you know who is on the team? Add it as a note and it will be used in the brief.` } });
    } else {
      const data = company;
      const callId = profileCallId;
      const roleOf: Record<string, string> = { FOUNDED: "Founder", IS_CEO_OF: "CEO", IS_CTO_OF: "CTO", IS_VICEPRESIDENT_OF: "VP", IS_BOARD_MEMBER_OF: "Board member", WORKS_AT: "Team" };
      const seen = new Map<string, { id: string; name: string; roles: string[]; sources: Source[] }>();
      for (const rel of Object.keys(roleOf)) {
        for (const r of rels(data, "incoming", rel)) {
          if (r.entity_type !== "Person") continue;
          const role = rel === "WORKS_AT" ? (str(r.properties?.role) || "Team") : roleOf[rel];
          const past = r.properties?.valid_until ? ` (until ${fmtDate(String(r.properties.valid_until))})` : "";
          const p = seen.get(r.id) ?? { id: r.id, name: r.name, roles: [], sources: [] };
          p.roles.push(role + past);
          p.sources.push(...relSources(r));
          seen.set(r.id, p);
        }
      }
      for (const p of seen.values()) {
        const roles = [...new Set(p.roles)];
        addNode(ctx, { id: p.id, name: p.name, kind: "person", entityType: "Person", subtitle: roles.join(", "), callId });
        addEdge(ctx, p.id, cid, roles[0].toLowerCase(), p.sources, callId);
        addEv(ctx, p.id, p.name, "role", `Role at ${companyName}`, roles.join(", "), p.sources.slice(0, 4), callId);
        people.push({ id: p.id, name: p.name, role: roles.join(", ") });
      }
      const founders = people.filter((p) => /Founder/.test(p.role));
      step("team", "done", `${founders.length} founder${founders.length === 1 ? "" : "s"}, ${people.length} people · from the profile query`);
      if (founders.length === 0) {
        emit({ type: "ask", ask: { id: "founders", text: `Cala lists ${people.length ? "people at" : "no people for"} ${companyName} but no founders. If you know who founded it, add a note.` } });
      }
    }
  } catch (e) {
    step("team", "error", errMsg(e));
  }

  // 4. Funding ------------------------------------------------------------
  step("funding", "running");
  const investorHits = new Map<string, { id: string; name: string; type: string; lead: number; rounds: string[]; sources: Source[] }>();
  let roundCount = 0;
  try {
    const fundRelsOut = has.out({ PARTICIPATES_IN_FUNDING_ROUND: { limit: 25 } });
    const fundRelsIn = has.inc({ INVESTED_IN: { limit: 40 } });
    if (!Object.keys(fundRelsOut).length && !Object.keys(fundRelsIn).length) {
      step("funding", "skipped", "No funding rounds or investors in Cala");
      emit({ type: "ask", ask: { id: "funding", text: `Cala has no funding rounds for ${companyName}. If they've told you about their raise (amount, lead, terms), add it as a note.` } });
    } else {
      const data = company;
      const callId = profileCallId;
      for (const r of rels(data, "incoming", "INVESTED_IN")) {
        investorHits.set(r.id, { id: r.id, name: r.name, type: r.entity_type, lead: 0, rounds: [], sources: relSources(r) });
        addNode(ctx, { id: r.id, name: r.name, kind: "investor", entityType: r.entity_type, subtitle: r.entity_type === "Person" ? "angel" : "investor", callId });
        addEdge(ctx, r.id, cid, "invested in", relSources(r), callId);
      }
      const issued = rels(data, "outgoing", "PARTICIPATES_IN_FUNDING_ROUND").filter((r) => !r.properties?.role || String(r.properties.role).toUpperCase() === "ISSUER");
      // Most recent first, when dated.
      issued.sort((a, b) => String(b.properties?.event_date ?? "").localeCompare(String(a.properties?.event_date ?? "")));
      const rounds = issued.slice(0, 4);
      roundCount = issued.length;
      await Promise.all(
        rounds.map(async (round) => {
          try {
            // Cala ignores fields an entity doesn't have, so no introspection needed here.
            const { data: rd, callId: rcid } = await ctx.cala.retrieve("funding", round.id, {
              properties: ["name", "round_label", "instrument", "transaction_value", "transaction_value_units", "announcement_date", "event_date"],
              relationships: { incoming: { PARTICIPATES_IN_FUNDING_ROUND: { limit: 30 } } },
            });
            const p = rd.properties ?? {};
            const amount = p.transaction_value ? money(p.transaction_value.value, p.transaction_value_units?.value) : null;
            const date = p.event_date?.value || p.announcement_date?.value;
            const name = str(p.name?.value) || round.name || "Funding round";
            const label = `${name}${amount ? ` · ${amount}` : ""}${date ? ` · ${String(date).slice(0, 7)}` : ""}`;
            addNode(ctx, { id: round.id, name, kind: "round", entityType: "FundingRound", subtitle: [amount, date ? String(date).slice(0, 7) : null].filter(Boolean).join(" · "), callId: rcid });
            addEdge(ctx, cid, round.id, "raised", relSources(round), rcid);
            const srcs = [...normSources(p.transaction_value?.sources), ...normSources(p.event_date?.sources ?? p.announcement_date?.sources)];
            addEv(ctx, cid, companyName, "funding_round", "Funding round", label, srcs.length ? srcs : relSources(round), rcid);
            const parts = rels(rd, "incoming", "PARTICIPATES_IN_FUNDING_ROUND").filter((x) => x.id !== cid && String(x.properties?.role ?? "INVESTOR").toUpperCase() !== "ISSUER");
            const leads: string[] = [];
            for (const x of parts) {
              const isLead = x.properties?.is_lead === true;
              const hit = investorHits.get(x.id) ?? { id: x.id, name: x.name, type: x.entity_type, lead: 0, rounds: [], sources: [] };
              hit.rounds.push(name);
              if (isLead) {
                hit.lead++;
                leads.push(x.name);
              }
              hit.sources.push(...relSources(x));
              investorHits.set(x.id, hit);
              addNode(ctx, { id: x.id, name: x.name, kind: "investor", entityType: x.entity_type, subtitle: isLead ? "lead investor" : x.entity_type === "Person" ? "angel" : "investor", callId: rcid });
              addEdge(ctx, x.id, round.id, isLead ? "led" : String(x.properties?.role ?? "participated").toLowerCase(), relSources(x), rcid);
            }
            if (parts.length) {
              addEv(ctx, round.id, `${companyName} ${name}`, "participants", `${name} investors`, parts.map((x) => x.name + (x.properties?.is_lead ? " (lead)" : "")).join(", "), parts.flatMap(relSources).slice(0, 5), rcid);
            }
          } catch {
            /* individual round failure is logged in the call trail; keep going */
          }
        }),
      );
      for (const inv of investorHits.values()) {
        addEv(ctx, inv.id, inv.name, "investor_in_target", `Investor in ${companyName}`, `${inv.name}${inv.lead ? " — led " + inv.lead + " round" + (inv.lead > 1 ? "s" : "") : ""}${inv.rounds.length ? ` (${[...new Set(inv.rounds)].join(", ")})` : ""}`, inv.sources.slice(0, 4), ctx.nodes.get(inv.id)?.callId ?? "");
      }
      step("funding", "done", `${roundCount} round${roundCount === 1 ? "" : "s"}, ${investorHits.size} investor${investorHits.size === 1 ? "" : "s"}`);
    }
  } catch (e) {
    step("funding", "error", errMsg(e));
  }

  // 5. Founder backgrounds ------------------------------------------------
  step("people", "running");
  const focusPeople = [...people.filter((p) => /Founder/.test(p.role)), ...people.filter((p) => /CEO|CTO/.test(p.role) && !/Founder/.test(p.role))].slice(0, 3);
  if (!focusPeople.length) {
    step("people", "skipped", "No founders or executives to explore");
  } else {
    let found = 0;
    await Promise.all(
      focusPeople.map(async (person) => {
        try {
          const outWanted: Record<string, { limit: number }> = {};
          for (const r of ["FOUNDED", "IS_CEO_OF", "IS_CTO_OF", "IS_CFO_OF", "IS_COO_OF", "IS_CMO_OF", "WORKS_AT", "IS_BOARD_MEMBER_OF", "INVESTED_IN", "STUDIED_AT", "IS_ALUMNUS_OF", "GRADUATED_FROM"]) outWanted[r] = { limit: 8 };
          const { data, callId } = await ctx.cala.retrieve("people", person.id, {
            properties: ["name", "description", "nationality", "aliases"],
            relationships: { outgoing: outWanted },
          });
          const desc = str(data.properties?.description?.value) || data.description || null;
          if (desc) addEv(ctx, person.id, person.name, "description", "Background", desc, normSources(data.properties?.description?.sources), callId);
          for (const [rel, items] of Object.entries(data.relationships?.outgoing ?? {})) {
            for (const r of items ?? []) {
              if (r.id === cid) continue;
              const verb = relVerb(rel, r);
              addEv(ctx, person.id, person.name, rel, verb, `${r.name}${span(r)}`, relSources(r), callId);
              if (r.entity_type === "Company" || /EDUCAT|STUD|ALUMN|GRADUAT/i.test(rel)) {
                addNode(ctx, { id: r.id, name: r.name, kind: "context", entityType: r.entity_type, subtitle: verb.toLowerCase(), callId });
                addEdge(ctx, person.id, r.id, verb.toLowerCase(), relSources(r), callId);
              }
              found++;
            }
          }
        } catch {}
      }),
    );
    step("people", found ? "done" : "skipped", found ? `${found} prior roles, ventures and affiliations` : "No further background in Cala");
    if (!found) emit({ type: "ask", ask: { id: "background", text: `Cala has little on the founders' prior experience. What have you learned about their background? Add it as a note.` } });
  }

  // 6. Investor network ---------------------------------------------------
  step("network", "running");
  const investors = [...investorHits.values()].sort((a, b) => b.lead - a.lead || b.rounds.length - a.rounds.length).slice(0, 3);
  const portfolio = new Map<string, { id: string; name: string; via: { id: string; name: string; sources: Source[]; callId: string }[] }>();
  if (!investors.length) {
    step("network", "skipped", "No investors to explore");
  } else {
    await Promise.all(
      investors.map(async (inv) => {
        try {
          const { data, callId } = await ctx.cala.retrieve("network", inv.id, { properties: ["name"], relationships: { outgoing: { INVESTED_IN: { limit: 30 } } } });
          const items = rels(data, "outgoing", "INVESTED_IN").filter((r) => r.id !== cid && r.entity_type === "Company");
          if (items.length) addEv(ctx, inv.id, inv.name, "portfolio", "Other investments", items.slice(0, 12).map((r) => r.name).join(", ") + (items.length > 12 ? ` and ${items.length - 12} more` : ""), items.flatMap(relSources).slice(0, 4), callId);
          for (const r of items) {
            const p = portfolio.get(r.id) ?? { id: r.id, name: r.name, via: [] };
            p.via.push({ id: inv.id, name: inv.name, sources: relSources(r), callId });
            portfolio.set(r.id, p);
          }
        } catch {}
      }),
    );
    // Prefer companies backed by several of the same investors; they share the closest network.
    const ranked = [...portfolio.values()].sort((a, b) => b.via.length - a.via.length).slice(0, 3);
    await Promise.all(
      ranked.map(async (pc) => {
        try {
          const { data, callId } = await ctx.cala.retrieve("network", pc.id, {
            properties: ["name", "description", "funding_stage", "operational_status", "company_ownership_status", "founding_date"],
            relationships: { incoming: { FOUNDED: { limit: 4 } }, outgoing: { OPERATES_IN_INDUSTRY: { limit: 2 } } },
          });
          const industry = rels(data, "outgoing", "OPERATES_IN_INDUSTRY").map((r) => prettyCode(str(r.properties?.label) || r.name))[0];
          addNode(ctx, { id: pc.id, name: pc.name, kind: "portfolio", entityType: "Company", subtitle: industry ? industry.toLowerCase() : "portfolio company", callId });
          for (const v of pc.via) addEdge(ctx, v.id, pc.id, "invested in", v.sources, v.callId);
          const descr = str(data.properties?.description?.value);
          const evIds: string[] = [];
          const viaEv = addEv(ctx, pc.id, pc.name, "shared_investors", `Shares investors with ${companyName}`, pc.via.map((v) => v.name).join(", "), pc.via.flatMap((v) => v.sources).slice(0, 4), callId);
          evIds.push(viaEv);
          if (descr) evIds.push(addEv(ctx, pc.id, pc.name, "description", "Description", descr, normSources(data.properties?.description?.sources), callId));
          if (industry) evIds.push(addEv(ctx, pc.id, pc.name, "industry", "Industry", industry, [], callId));
          for (const fdr of rels(data, "incoming", "FOUNDED").filter((r) => r.entity_type === "Person").slice(0, 2)) {
            addNode(ctx, { id: fdr.id, name: fdr.name, kind: "person", entityType: "Person", subtitle: `founder, ${pc.name}`, callId });
            addEdge(ctx, fdr.id, pc.id, "founded", relSources(fdr), callId);
            const fev = addEv(ctx, fdr.id, fdr.name, "founded", "Founded", pc.name, relSources(fdr), callId);
            ctx.helpers.push({
              id: `H${ctx.helpers.length + 1}`,
              personId: fdr.id,
              name: fdr.name,
              basis: "shared-investor",
              relevance: `Founded ${pc.name}${industry ? ` (${industry.toLowerCase()})` : ""}`,
              route: `${pc.via.map((v) => v.name).join(" and ")} invested in both ${pc.name} and ${companyName}. That is a possible introduction path, not a known relationship.`,
              evidence: [fev, ...evIds],
            });
          }
        } catch {}
      }),
    );
    for (const h of ctx.helpers) emit({ type: "helper", helper: h });
    step("network", "done", `${portfolio.size} companies across ${investors.length} investor portfolio${investors.length === 1 ? "" : "s"}${ctx.helpers.length ? `, ${ctx.helpers.length} founder${ctx.helpers.length === 1 ? "" : "s"} reachable via shared investors` : ""}`);
  }

  // 7. Comparables --------------------------------------------------------
  step("comparables", "running");
  try {
    const desc = str(company.properties?.description?.value) || company.description || "";
    const industry = [...ctx.nodes.values()].find((n) => n.kind === "context" && n.subtitle === "industry")?.name;
    const q = `Which companies are most comparable to ${companyName}${desc ? ` (${desc.slice(0, 220)})` : ""}${industry ? ` in ${industry}` : ""}? Include companies that were acquired, shut down or struggled, not only successes.`;
    const { data, callId } = await ctx.cala.knowledge("comparables", q);
    const kbEv: string[] = [];
    for (const kb of (data.context ?? []).slice(0, 8)) {
      const srcs: Source[] = (kb.origins ?? []).slice(0, 3).map((o) => ({ name: o.source?.name || o.document?.name, url: o.document?.url || o.source?.url }));
      kbEv.push(addEv(ctx, "knowledge", "Cala knowledge search", "knowbit", "Sourced fact", kb.content, srcs, callId));
    }
    const exclude = new Set([cid, ...portfolio.keys()]);
    const cands = (data.entities ?? []).filter((e) => e.entity_type === "Company" && !exclude.has(e.id) && !sameName(e.name, companyName)).slice(0, 3);
    let added = 0;
    await Promise.all(
      cands.map(async (c) => {
        try {
          const { data: cd, callId: ccid } = await ctx.cala.retrieve("comparables", c.id, {
            properties: ["name", "description", "founding_date", "funding_stage", "total_funding", "total_funding_units", "operational_status", "company_ownership_status", "employee_count_range", "headquarters_address"],
            relationships: { outgoing: { OPERATES_IN_INDUSTRY: { limit: 2 }, PARTICIPATES_IN_CORPORATE_EVENT: { limit: 5 } }, incoming: { FOUNDED: { limit: 3 } } },
          });
          const name = cd.name || c.name;
          const status = str(cd.properties?.company_ownership_status?.value) || str(cd.properties?.operational_status?.value);
          addNode(ctx, { id: c.id, name, kind: "comparable", entityType: "Company", subtitle: status ? status.toLowerCase() : "comparable", callId: ccid });
          addEdge(ctx, cid, c.id, "comparable", [], callId);
          for (const [field, prop] of Object.entries(cd.properties ?? {})) {
            if (field === "id" || field === "name" || field.endsWith("_units")) continue;
            const v = formatProp(field, prop.value, cd.properties);
            if (v) addEv(ctx, c.id, name, field, PROP_LABELS[field] ?? humanize(field), v, normSources(prop.sources), ccid);
          }
          for (const r of rels(cd, "outgoing", "PARTICIPATES_IN_CORPORATE_EVENT")) {
            addEv(ctx, c.id, name, "corporate_event", "Corporate event", `${humanize(r.name)}${r.properties?.role ? ` as ${String(r.properties.role).toLowerCase()}` : ""}${r.properties?.event_date ? ` (${fmtDate(String(r.properties.event_date))})` : ""}`, relSources(r), ccid);
          }
          for (const fdr of rels(cd, "incoming", "FOUNDED").filter((r) => r.entity_type === "Person").slice(0, 2)) {
            const fev = addEv(ctx, fdr.id, fdr.name, "founded", "Founded", name, relSources(fdr), ccid);
            ctx.helpers.push({
              id: `H${ctx.helpers.length + 1}`,
              personId: fdr.id,
              name: fdr.name,
              basis: "comparable-company",
              relevance: `Founded ${name}, a comparable company${status ? ` (${status.toLowerCase()})` : ""}`,
              evidence: [fev],
            });
            emit({ type: "helper", helper: ctx.helpers[ctx.helpers.length - 1] });
          }
          added++;
        } catch {}
      }),
    );
    step("comparables", added || kbEv.length ? "done" : "skipped", added ? `${added} comparable compan${added === 1 ? "y" : "ies"}, ${kbEv.length} sourced facts` : kbEv.length ? `${kbEv.length} sourced facts, no comparable entities resolved` : "Cala returned no comparable companies. Add one you have in mind as a note.");
  } catch (e) {
    step("comparables", "error", errMsg(e));
  }

  // 8. Gaps ---------------------------------------------------------------
  step("gaps", "running");
  const gaps = findGaps(ctx, cid, companyName, { people, roundCount, investors: investorHits.size });
  for (const g of gaps) emit({ type: "gap", gap: g });
  step("gaps", "done", `${gaps.length} open question${gaps.length === 1 ? "" : "s"} · ${ctx.cala.count} Cala queries`);
  emit({ type: "done" });
}

// ---------------------------------------------------------------------------

function findGaps(ctx: Ctx, cid: string, name: string, s: { people: { role: string }[]; roundCount: number; investors: number }) {
  const fields = new Set(ctx.ev.filter((e) => e.entityId === cid).map((e) => e.field));
  const gaps: { id: string; title: string; why: string }[] = [];
  const add = (id: string, title: string, why: string) => gaps.push({ id, title, why });
  if (!s.people.some((p) => /Founder/.test(p.role))) add("founders", "Who founded the company", "Team is the main evidence at pre-seed. Cala has no founder records, which does not mean there are none.");
  const fb = ctx.ev.filter((e) => ["FOUNDED", "WORKS_AT", "IS_CEO_OF", "IS_CTO_OF", "description"].includes(e.field) && e.entityId !== cid && ctx.nodes.get(e.entityId)?.kind === "person");
  if (s.people.length && fb.length < 2) add("experience", "The founders' relevant experience", "Little public record of prior roles or ventures. Experience relevant to this problem has to come from the founders or references.");
  if (!s.roundCount && !s.investors) add("funding", "Funding history and current raise", "No public rounds. Ask about prior capital, the current round, and who else is committing.");
  else if (s.roundCount && !ctx.ev.some((e) => e.field === "participants" && /lead/.test(e.value))) add("lead", "Who led previous rounds", "Rounds are public but no lead investor is recorded. Leads usually did the deepest diligence and are worth a call.");
  if (!fields.has("employee_count_range") && !fields.has("employee_count") && !fields.has("employee_series")) add("headcount", "Team size and hiring", "No headcount data. Team size frames burn and execution capacity.");
  add("traction", "Revenue and traction", "Cala holds revenue only where companies publish it; early traction usually has to be requested directly.");
  if (!fields.has("founding_date")) add("age", "When the company started", "Founding date is missing, so stage and progress can't be compared fairly against peers.");
  return gaps.map((g, i) => ({ ...g, id: `G${i + 1}-${g.id}` }));
}

function schemaFilter(s: Introspection) {
  const props = new Set(s.properties ?? []);
  const out = new Set(s.relationships?.outgoing ?? []);
  const inc = new Set(s.relationships?.incoming ?? []);
  const pick = <T,>(set: Set<string>, want: Record<string, T>) => Object.fromEntries(Object.entries(want).filter(([k]) => set.has(k)));
  return {
    props: (want: string[]) => {
      const p = want.filter((w) => props.has(w));
      return p.includes("name") || !props.has("name") ? p : ["name", ...p];
    },
    out: <T,>(want: Record<string, T>) => pick(out, want),
    inc: <T,>(want: Record<string, T>) => pick(inc, want),
  };
}

function pickSeries(s: Introspection, re: RegExp): Record<string, string[]> | null {
  const out: Record<string, string[]> = {};
  for (const [type, list] of Object.entries(s.numerical_observations ?? {})) {
    if (!Array.isArray(list)) continue;
    const ids = list.filter((o) => re.test(`${o.name ?? ""} ${o.code ?? ""}`)).map((o) => o.id).slice(0, 2);
    if (ids.length) out[type] = ids;
  }
  return Object.keys(out).length ? out : null;
}

function extractSeries(raw: unknown): { text: string; sources: Source[] } | null {
  // Shape varies; collect any {date|period, value} pairs we can find.
  const points: { date: string; value: number; source?: Source }[] = [];
  const walk = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    if (Array.isArray(x)) return x.forEach(walk);
    const o = x as Record<string, unknown>;
    const date = (o.date ?? o.period_end ?? o.period ?? o.observation_date) as string | undefined;
    if (typeof o.value === "number" && typeof date === "string") {
      const origin = (o.origin ?? o.source) as { name?: string; url?: string; document?: string } | undefined;
      points.push({ date: date.slice(0, 10), value: o.value, source: origin ? { name: origin.name, url: origin.url ?? origin.document } : undefined });
      return;
    }
    Object.values(o).forEach(walk);
  };
  walk(raw);
  if (!points.length) return null;
  points.sort((a, b) => a.date.localeCompare(b.date));
  const recent = points.slice(-5);
  return {
    text: recent.map((p) => `${p.value.toLocaleString("en")} (${p.date.slice(0, 7)})`).join(" → "),
    sources: recent.map((p) => p.source).filter((s): s is Source => !!s).slice(-3),
  };
}

function addNode(ctx: Ctx, n: GraphNode) {
  const existing = ctx.nodes.get(n.id);
  if (existing) {
    // Don't demote the researched company or an investor to a weaker kind.
    if (existing.kind === "company" || existing.kind === "investor" || existing.kind === n.kind) return;
    if (n.kind === "context" || n.kind === "portfolio") return;
  }
  ctx.nodes.set(n.id, n);
  ctx.emit({ type: "node", node: n });
}

function addEdge(ctx: Ctx, from: string, to: string, label: string, sources: Source[], callId: string) {
  const id = `${from}>${to}>${label}`;
  if (ctx.edges.has(id) || from === to) return;
  ctx.edges.add(id);
  const edge: GraphEdge = { id, from, to, label, sources: sources.slice(0, 4), callId };
  ctx.emit({ type: "edge", edge });
}

function addEv(ctx: Ctx, entityId: string, entityName: string, field: string, label: string, value: string, sources: Source[], callId: string): string {
  const dup = ctx.ev.find((e) => e.entityId === entityId && e.field === field && e.value === value);
  if (dup) return dup.id;
  const ev: Evidence = { id: `E${ctx.ev.length + 1}`, entityId, entityName, field, label, value: value.length > 600 ? value.slice(0, 600) + "…" : value, sources: dedupeSources(sources), callId };
  ctx.ev.push(ev);
  ctx.emit({ type: "evidence", evidence: ev });
  return ev.id;
}

function dedupeSources(s: Source[]) {
  const seen = new Set<string>();
  return s.filter((x) => {
    const k = `${x.url ?? ""}|${x.name ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
}

function rels(e: Entity, dir: "outgoing" | "incoming", type: string): RelItem[] {
  const v = e.relationships?.[dir]?.[type];
  return Array.isArray(v) ? v : [];
}

function relSources(r: RelItem): Source[] {
  return normSources(r.properties?.sources as never);
}

function relVerb(rel: string, r: RelItem) {
  const role = str(r.properties?.role);
  const map: Record<string, string> = { FOUNDED: "Founded", IS_CEO_OF: "CEO of", IS_CTO_OF: "CTO of", IS_CFO_OF: "CFO of", IS_COO_OF: "COO of", IS_BOARD_MEMBER_OF: "Board member of", INVESTED_IN: "Invested in", WORKS_AT: role ? `${role} at` : "Worked at" };
  return map[rel] ?? humanize(rel);
}

function span(r: RelItem) {
  const a = r.properties?.valid_since ? String(r.properties.valid_since).slice(0, 4) : "";
  const b = r.properties?.valid_until ? String(r.properties.valid_until).slice(0, 4) : "";
  if (!a && !b) return "";
  return ` (${a || "?"}–${b || "now"})`;
}

function formatProp(field: string, v: unknown, all?: Record<string, { value: unknown }>): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (field === "total_funding" || field === "total_funding_excluding_debt") return money(v, all?.[`${field}_units`]?.value);
  if (field === "employee_count_range" && Array.isArray(v)) return v.length === 2 ? `${v[0]}–${v[1]} employees` : `${v[0]} employees`;
  if (field === "funding_stage" || field === "operational_status") return String(v).replace(/_/g, " ").toLowerCase();
  if (Array.isArray(v)) return v.length ? v.slice(0, 6).join(", ") : null;
  if (typeof v === "object") return null;
  return String(v);
}

function money(v: unknown, units?: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  if (!isFinite(n)) return String(v);
  const cur = typeof units === "string" ? units.toUpperCase() : "";
  const sym: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  const s = sym[cur] ?? (cur ? cur + " " : "");
  const fmt = n >= 1e9 ? (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B" : n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M" : n >= 1e3 ? Math.round(n / 1e3) + "K" : String(n);
  return s + fmt;
}

function prettyCode(s: string) {
  if (!/^[A-Z0-9_]+$/.test(s)) return s;
  const t = s.replace(/_/g, " ").toLowerCase().replace(/\band\b/g, "&");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function humanize(s: string) {
  const t = s.replace(/^IS_/, "").replace(/_/g, " ").toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function sameName(a: string, b: string) {
  const n = (x: string) => x.toLowerCase().replace(/\b(oy|ab|inc|ltd|gmbh|as|oyj|llc|corp|limited)\b\.?/g, "").replace(/[^a-z0-9]/g, "");
  return n(a) === n(b);
}

function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export const KIND_ORDER: NodeKind[] = ["company", "person", "investor", "round", "portfolio", "comparable", "context"];

// ---------------------------------------------------------------------------
// Founders-first research: for idea-stage companies with no public record yet.

const F_STEPS: { id: string; label: string }[] = [
  { id: "identify", label: "Find the founders" },
  { id: "profile", label: "Look for a company record" },
  { id: "team", label: "Confirm the team" },
  { id: "funding", label: "Check for public funding" },
  { id: "people", label: "Explore their earlier work" },
  { id: "network", label: "Find people who worked with them" },
  { id: "web", label: "Search the open web" },
  { id: "comparables", label: "Find comparable cases" },
  { id: "gaps", label: "Identify what's still unknown" },
];

export async function runFounders(opts: { key: string; exaKey?: string; founders: string[]; idea: string; name: string; emit: (e: ResearchEvent) => void }) {
  const { emit } = opts;
  const ctx: Ctx = { cala: new Cala(opts.key, (call) => emit({ type: "call", call })), emit, ev: [], nodes: new Map(), edges: new Set(), helpers: [] };
  for (const s of F_STEPS) emit({ type: "step", step: { ...s, status: "pending" } });
  const step = (id: string, status: StepStatus, detail?: string) => emit({ type: "step", step: { ...F_STEPS.find((x) => x.id === id)!, status, detail } });
  const name = opts.name.trim() || "New company";
  const cid = `idea:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const yours: Source[] = [{ name: "Your input (not from Cala)" }];

  // 1. Founders --------------------------------------------------------------
  step("identify", "running");
  addNode(ctx, { id: cid, name, kind: "company", entityType: "Company", subtitle: "idea · not registered yet", callId: "" });
  if (opts.idea) addEv(ctx, cid, name, "description", "What they're building (your words)", opts.idea, yours, "");
  const found: { id: string; name: string }[] = [];
  const unknown: { id: string; name: string }[] = [];
  for (const raw of opts.founders.slice(0, 4)) {
    try {
      const { data } = await ctx.cala.search("identify", raw, ["Person"], 5);
      const hit = (data.entities ?? []).find((e) => samePerson(e.name, raw));
      if (!hit) {
        // Keep them on the desk anyway: the founder is real even if no database knows them yet.
        const wid = `web:person:${slug(raw)}`;
        unknown.push({ id: wid, name: raw });
        addNode(ctx, { id: wid, name: raw, kind: "person", entityType: "Person", subtitle: "Founder · not in Cala", callId: "" });
        addEdge(ctx, wid, cid, "founder", yours, "");
        addEv(ctx, wid, raw, "role", `Role at ${name}`, "Founder", yours, "");
        emit({ type: "ask", ask: { id: `nf-${raw}`, text: `Cala has no record of ${raw} yet. If you know their background, add it as a note.` } });
        continue;
      }
      found.push({ id: hit.id, name: hit.name });
      addNode(ctx, { id: hit.id, name: hit.name, kind: "person", entityType: "Person", subtitle: "Founder", callId: "" });
      addEdge(ctx, hit.id, cid, "founder", yours, "");
      addEv(ctx, hit.id, hit.name, "role", `Role at ${name}`, "Founder", yours, "");
      if (hit.description) addEv(ctx, hit.id, hit.name, "summary", "Cala summary", hit.description, [], "");
    } catch {}
  }
  step("identify", found.length ? "done" : "error", `${found.length} of ${opts.founders.length} founder${opts.founders.length === 1 ? "" : "s"} found in Cala`);
  step("profile", "skipped", "No company record yet, which is normal this early");
  step("team", "done", "Team from your input");
  step("funding", "skipped", "No company record, so no public rounds");

  // 2. Earlier work ----------------------------------------------------------
  step("people", "running");
  const employers = new Map<string, { id: string; name: string; founders: string[] }>();
  await Promise.all(
    found.map(async (p) => {
      try {
        const out: Record<string, { limit: number }> = {};
        for (const r of ["FOUNDED", "IS_CEO_OF", "IS_CTO_OF", "IS_CFO_OF", "IS_COO_OF", "WORKS_AT", "IS_BOARD_MEMBER_OF", "INVESTED_IN"]) out[r] = { limit: 8 };
        const { data, callId } = await ctx.cala.retrieve("people", p.id, { properties: ["name", "description", "nationality"], relationships: { outgoing: out } });
        const desc = str(data.properties?.description?.value) || data.description;
        if (desc) addEv(ctx, p.id, p.name, "description", "Background", desc, normSources(data.properties?.description?.sources), callId);
        for (const [rel, items] of Object.entries(data.relationships?.outgoing ?? {})) {
          for (const r of items ?? []) {
            addEv(ctx, p.id, p.name, rel, relVerb(rel, r), `${r.name}${span(r)}`, relSources(r), callId);
            if (r.entity_type === "Company" && rel !== "INVESTED_IN") {
              addNode(ctx, { id: r.id, name: r.name, kind: "context", entityType: "Company", subtitle: relVerb(rel, r).toLowerCase(), callId });
              addEdge(ctx, p.id, r.id, relVerb(rel, r).toLowerCase(), relSources(r), callId);
              const e = employers.get(r.id) ?? { id: r.id, name: r.name, founders: [] };
              if (!e.founders.includes(p.name)) e.founders.push(p.name);
              employers.set(r.id, e);
            }
          }
        }
      } catch {}
    }),
  );
  step("people", employers.size ? "done" : "skipped", employers.size ? `${employers.size} earlier compan${employers.size === 1 ? "y" : "ies"}` : "No earlier roles in Cala");

  // 3. People who worked with them ------------------------------------------
  step("network", "running");
  const founderIds = new Set(found.map((f) => f.id));
  await Promise.all(
    [...employers.values()].slice(0, 3).map(async (emp) => {
      try {
        const { data, callId } = await ctx.cala.retrieve("network", emp.id, {
          properties: ["name", "description", "operational_status"],
          relationships: { incoming: { FOUNDED: { limit: 4 }, IS_CEO_OF: { limit: 2 }, IS_CTO_OF: { limit: 2 }, WORKS_AT: { limit: 10 } } },
        });
        const d = str(data.properties?.description?.value);
        const empEv = d ? addEv(ctx, emp.id, emp.name, "description", "Description", d, normSources(data.properties?.description?.sources), callId) : null;
        let added = 0;
        for (const rel of ["FOUNDED", "IS_CEO_OF", "IS_CTO_OF", "WORKS_AT"]) {
          for (const r of rels(data, "incoming", rel)) {
            if (r.entity_type !== "Person" || founderIds.has(r.id) || ctx.helpers.some((h) => h.personId === r.id) || added >= 3) continue;
            const role = rel === "WORKS_AT" ? str(r.properties?.role) || "Worked" : rel === "FOUNDED" ? "Co-founder" : relVerb(rel, r).replace(/ of$/, "");
            const ev1 = addEv(ctx, r.id, r.name, rel, `${role} at`, `${emp.name}${span(r)}`, relSources(r), callId);
            addNode(ctx, { id: r.id, name: r.name, kind: "person", entityType: "Person", subtitle: `${role.toLowerCase()}, ${emp.name}`, callId });
            addEdge(ctx, r.id, emp.id, role.toLowerCase(), relSources(r), callId);
            ctx.helpers.push({
              id: `H${ctx.helpers.length + 1}`,
              personId: r.id,
              name: r.name,
              basis: "shared-employer",
              relevance: `${role} at ${emp.name}${span(r)}`,
              route: `${emp.founders.join(" and ")} also worked at ${emp.name}. That is a possible route, not a known relationship.`,
              evidence: [ev1, ...(empEv ? [empEv] : [])],
            });
            emit({ type: "helper", helper: ctx.helpers[ctx.helpers.length - 1] });
            added++;
          }
        }
      } catch {}
    }),
  );
  step("network", ctx.helpers.length ? "done" : "skipped", ctx.helpers.length ? `${ctx.helpers.length} people who worked at the same companies` : "No colleagues found in Cala");

  // 4. Open web (Exa) --------------------------------------------------------
  // Very new founders and ideas are often only on a personal site, a launch post or a news item.
  // Everything found here is labelled "web": a lead to check, never a verified record.
  const web = opts.exaKey ? new Exa(opts.exaKey, (call) => emit({ type: "call", call })) : null;
  if (!web) {
    step("web", "skipped", "Add an Exa API key to also search the open web");
  } else {
    step("web", "running");
    const hasName = !!opts.name.trim();
    let kept = 0;
    const tasks: Promise<void>[] = [...found, ...unknown].map(async (p) => {
      try {
        const { data, callId } = await web.search("web", {
          query: hasName ? `${p.name} ${name}` : `${p.name} founder${opts.idea ? ` ${opts.idea.slice(0, 80)}` : ""}`,
          type: "auto",
          numResults: 6,
          contents: { highlights: { query: `What has ${p.name} worked on, built or founded?`, maxCharacters: 420 } },
        });
        const hits = data.results.filter((r) => mentionsPerson(r, p.name)).slice(0, 3);
        for (const r of hits) kept += addWeb(ctx, p.id, p.name, r, callId) ? 1 : 0;
      } catch {}
    });
    if (hasName) {
      tasks.push(
        (async () => {
          try {
            const { data, callId } = await web.search("web", {
              query: `${name}${opts.idea ? `: ${opts.idea.slice(0, 160)}` : " startup"}`,
              type: "auto",
              numResults: 8,
              contents: { highlights: { query: `What does ${name} do, who started it, and what stage is it at?`, maxCharacters: 420 } },
            });
            const own = slug(name).replace(/-/g, "");
            const hits = data.results
              .filter((r) => mentionsName(r, name))
              .sort((a, b) => Number(hostOf(b.url).replace(/[^a-z0-9]/g, "").includes(own)) - Number(hostOf(a.url).replace(/[^a-z0-9]/g, "").includes(own)))
              .slice(0, 4);
            for (const r of hits) kept += addWeb(ctx, cid, name, r, callId, own) ? 1 : 0;
          } catch {}
        })(),
      );
    }
    await Promise.all(tasks);
    step("web", kept ? "done" : "skipped", kept ? `${kept} web page${kept === 1 ? "" : "s"} that mention them · leads to check` : "Nothing on the web clearly about them yet");
  }

  // 5. Comparables -----------------------------------------------------------
  step("comparables", "running");
  if (!opts.idea) {
    step("comparables", "skipped", "Describe what they're building to find comparable companies");
  } else {
    try {
      const { data, callId } = await ctx.cala.knowledge("comparables", `Which companies build ${opts.idea.slice(0, 220)}? Include ones that were acquired, shut down or struggled, not only successes.`);
      for (const kb of (data.context ?? []).slice(0, 6)) {
        const srcs: Source[] = (kb.origins ?? []).slice(0, 3).map((o) => ({ name: o.source?.name || o.document?.name, url: o.document?.url || o.source?.url }));
        addEv(ctx, "knowledge", "Cala knowledge search", "knowbit", "Sourced fact", kb.content, srcs, callId);
      }
      const cands = (data.entities ?? []).filter((e) => e.entity_type === "Company" && !employers.has(e.id)).slice(0, 3);
      let added = 0;
      await Promise.all(
        cands.map(async (c) => {
          try {
            const { data: cd, callId: ccid } = await ctx.cala.retrieve("comparables", c.id, {
              properties: ["name", "description", "founding_date", "funding_stage", "total_funding", "total_funding_units", "operational_status", "company_ownership_status"],
            });
            const status = str(cd.properties?.company_ownership_status?.value) || str(cd.properties?.operational_status?.value);
            addNode(ctx, { id: c.id, name: cd.name || c.name, kind: "comparable", entityType: "Company", subtitle: status ? status.toLowerCase() : "comparable", callId: ccid });
            addEdge(ctx, cid, c.id, "comparable", [], callId);
            for (const [field, prop] of Object.entries(cd.properties ?? {})) {
              if (field === "id" || field === "name" || field.endsWith("_units")) continue;
              const v = formatProp(field, prop.value, cd.properties);
              if (v) addEv(ctx, c.id, cd.name || c.name, field, PROP_LABELS[field] ?? humanize(field), v, normSources(prop.sources), ccid);
            }
            added++;
          } catch {}
        }),
      );
      step("comparables", added ? "done" : "skipped", added ? `${added} comparable compan${added === 1 ? "y" : "ies"}` : "None resolved");
    } catch (e) {
      step("comparables", "error", errMsg(e));
    }
  }

  // 6. Gaps ------------------------------------------------------------------
  step("gaps", "running");
  const gaps: Gap[] = [];
  const g = (id: string, title: string, why: string) => gaps.push({ id: `G${gaps.length + 1}-${id}`, title, why });
  g("traction", "Who is using it, and how often", "At idea stage, early usage is the strongest signal and it's never in public data.");
  if (found.length < opts.founders.length) g("founders", "The background of founders Cala doesn't know", "Some founders have no public record; their experience has to come from them or references.");
  g("raise", "The current raise", "No public funding yet. Ask about the round size, who else is in, and the terms.");
  g("company", "When they will incorporate", "There's no company record yet. Ask about the entity, ownership split and IP.");
  for (const x of gaps) emit({ type: "gap", gap: x });
  step("gaps", "done", `${gaps.length} open questions · ${ctx.cala.count} Cala lookups${web ? ` · ${web.count} web searches` : ""}`);
  emit({ type: "done" });
}

function slug(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function flat(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function haystack(r: ExaResult) {
  return flat([r.title ?? "", r.url, ...(r.highlights ?? [])].join(" "));
}

/** Both first and last name appear on the page, so it's at least plausibly the same person. */
function mentionsPerson(r: ExaResult, name: string) {
  const parts = flat(name).split(/\s+/).filter((x) => x.length > 1);
  if (parts.length < 2) return false;
  const h = haystack(r);
  return h.includes(parts[0]) && h.includes(parts[parts.length - 1]);
}

function mentionsName(r: ExaResult, name: string) {
  const n = flat(name).trim();
  if (n.length < 3) return false;
  const h = haystack(r);
  return h.includes(n) || h.replace(/[^a-z0-9]/g, "").includes(n.replace(/[^a-z0-9]/g, ""));
}

/** Add one web page as evidence. Returns false if it had nothing usable. */
function addWeb(ctx: Ctx, entityId: string, entityName: string, r: ExaResult, callId: string, ownSlug?: string) {
  const text = (r.highlights ?? []).join(" … ").replace(/\s+/g, " ").trim() || (r.text ?? "").slice(0, 400).trim();
  if (!text) return false;
  const host = hostOf(r.url);
  const own = !!ownSlug && host.replace(/[^a-z0-9]/g, "").includes(ownSlug);
  const label = own ? "Their own website" : (r.title || host || "Web page").replace(/\s+/g, " ").slice(0, 90);
  const value = text.length > 360 ? text.slice(0, 357).replace(/\s+\S*$/, "") + "…" : text;
  const date = r.publishedDate ? r.publishedDate.slice(0, 10) : undefined;
  addEv(ctx, entityId, entityName, "web", label, value, [{ name: host || "web page", url: r.url, date, rank: "WEB", web: true }], callId);
  return true;
}

function samePerson(a: string, b: string) {
  const n = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z ]/g, "").split(/\s+/).filter(Boolean);
  const A = n(a), B = n(b);
  if (!A.length || !B.length) return false;
  return A[0] === B[0] && A[A.length - 1] === B[B.length - 1];
}
