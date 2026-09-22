import { cardsForShortlist } from "./cards";
import { elsewhere, forHire, readDecisions } from "./decisions";
import { judgeCohort } from "./judge";
import { readMatchSet } from "./matching";
import { readDrafts } from "./outreach";
import { readPerson } from "./people";
import { readShortlist } from "./shortlists";

/**
 * Getting the work out of the tool.
 *
 * Two CSVs rather than one, because they answer different questions and
 * squashing them together would make both worse.
 *
 *   candidates  one row per person, one column per requirement. The
 *               shape a spreadsheet wants: sort it, filter it, pivot
 *               it, hand it to somebody who has never seen this tool.
 *
 *   evidence    one row per verdict, carrying the quote it rests on.
 *               Long text, so it would wreck the first file, but it is
 *               the file that lets a decision be audited rather than
 *               taken on faith.
 *
 * Plus a JSON dump for anyone who wants everything without the
 * flattening. Nothing here reads from a source or spends anything: the
 * export is a view of what is already on disk.
 */

/** RFC 4180: quote when needed, and double any quote inside. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: unknown[][]): string {
  // A BOM, so Excel opens UTF-8 names correctly instead of mangling
  // every accented character in the file.
  return "\uFEFF" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

async function gather(searchId: string, listId?: string) {
  const [matchSet, shortlist, drafts, allDecisions] = await Promise.all([
    readMatchSet(searchId),
    readShortlist(searchId, listId),
    readDrafts(searchId),
    readDecisions(),
  ]);

  const cards = await cardsForShortlist(searchId, shortlist?.id);
  const people = (
    await Promise.all(cards.map((c) => readPerson(c.internalId)))
  ).filter((p): p is NonNullable<typeof p> => p !== null);

  // Cache only: an export must never cost anything.
  const { judgements } = await judgeCohort(
    searchId,
    people,
    matchSet.criteria,
    matchSet.context,
    true
  );

  return {
    matchSet,
    shortlist,
    cards,
    drafts,
    judgements,
    here: forHire(allDecisions, searchId),
    other: elsewhere(allDecisions, searchId),
  };
}

export async function candidatesCsv(
  searchId: string,
  listId?: string
): Promise<string> {
  const g = await gather(searchId, listId);
  const criteria = g.matchSet.criteria;

  const header = [
    "internal_id",
    "name",
    "current_title",
    "current_company",
    "location",
    "linkedin",
    "github",
    "decision",
    "decided_elsewhere",
    "must_met",
    "must_total",
    "nice_met",
    "nice_total",
    "skills_declared",
    "roles_on_record",
    "avg_tenure_years",
    "years_since_degree",
    "github_active_months_of_36",
    "open_to_work",
    "profile_age_days",
    "outreach_drafted",
    "shortlist",
    // One column per requirement, named by the requirement itself so the
    // file explains itself without this tool beside it.
    ...criteria.map((c) => `${c.kind}: ${c.label}`),
  ];

  const mustTotal = criteria.filter((c) => c.kind === "must").length;
  const niceTotal = criteria.length - mustTotal;

  const rows: unknown[][] = [header];

  for (const card of g.cards) {
    const j = g.judgements.find((x) => x.internalId === card.internalId);
    const verdicts = j?.verdicts ?? [];
    const kindOf = new Map(criteria.map((c) => [c.id, c.kind]));

    let mustMet = 0;
    let niceMet = 0;
    let declared = 0;
    for (const v of verdicts) {
      if (v.declaredSkill) declared += 1;
      if (v.verdict !== "met") continue;
      if (kindOf.get(v.criterionId) === "nice") niceMet += 1;
      else mustMet += 1;
    }

    const key = String(card.crustdataPersonId);

    rows.push([
      card.internalId,
      card.name,
      card.currentTitle,
      card.currentCompany,
      card.location,
      card.links.find((l) => l.label === "LinkedIn")?.url ?? "",
      card.links.find((l) => l.label === "GitHub")?.url ?? "",
      g.here[key] ?? "",
      (g.other[key] ?? [])
        .map((d) => `${d.state} for ${d.roleTitle} on ${d.at.slice(0, 10)}`)
        .join("; "),
      mustMet,
      mustTotal,
      niceMet,
      niceTotal,
      declared,
      card.facts.roleCount,
      card.facts.avgTenureYears,
      card.facts.yearsSinceDegree,
      card.facts.activeMonths,
      card.facts.openToWork ? "yes" : "",
      card.coverage.crustdataAgeDays,
      g.drafts[card.internalId] ? "yes" : "",
      g.shortlist?.id ?? "",
      ...criteria.map((c) => {
        const v = verdicts.find((x) => x.criterionId === c.id);
        if (!v) return "";
        if (v.verdict === "met") return "met";
        if (v.declaredSkill) return "declared";
        if (v.verdict === "unreadable") return "unreadable";
        return "no";
      }),
    ]);
  }

  return toCsv(rows);
}

export async function evidenceCsv(
  searchId: string,
  listId?: string
): Promise<string> {
  const g = await gather(searchId, listId);
  const byId = new Map(g.matchSet.criteria.map((c) => [c.id, c]));

  const rows: unknown[][] = [
    [
      "internal_id",
      "name",
      "requirement",
      "kind",
      "verdict",
      "basis",
      "declared_skill",
      "evidence_quote",
      "evidence_source",
      "reason",
    ],
  ];

  for (const j of g.judgements) {
    const card = g.cards.find((c) => c.internalId === j.internalId);
    for (const v of j.verdicts) {
      const c = byId.get(v.criterionId);
      rows.push([
        j.internalId,
        card?.name ?? j.name,
        c?.label ?? v.criterionId,
        c?.kind ?? "",
        v.verdict,
        v.basis ?? "",
        v.declaredSkill ?? "",
        v.span ?? "",
        v.field ?? "",
        v.reason,
      ]);
    }
  }

  return toCsv(rows);
}

/** Everything, unflattened, for anyone who wants to do their own thing
 *  with it. */
export async function fullJson(
  searchId: string,
  listId?: string
): Promise<string> {
  const g = await gather(searchId, listId);
  return JSON.stringify(
    {
      searchId,
      shortlist: g.shortlist,
      exportedAt: new Date().toISOString(),
      requirements: g.matchSet.criteria,
      context: g.matchSet.context,
      candidates: g.cards,
      verdicts: g.judgements,
      outreach: g.drafts,
      decisions: { thisHire: g.here, otherHires: g.other },
    },
    null,
    2
  );
}
