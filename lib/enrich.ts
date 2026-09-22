import fs from "node:fs/promises";
import path from "node:path";
import { CRUSTDATA_API_VERSION } from "./crustdata";
import { noteHire, planEnrichment, upsertCrustdata } from "./people";
import type { Person } from "./people";

const ENRICH_ENDPOINT = "https://api.crustdata.com/person/enrich";
const DATA_DIR = path.join(process.cwd(), ".data", "enrichments");

/** Max profile URLs per enrich call, per the reference. */
const BATCH_SIZE = 25;

/**
 * Sections that cost nothing beyond the base profile credit.
 *
 * `fields` defaults to `basic_profile` and `social_handles` only, so
 * everything else has to be asked for by name. Skills and the GitHub block
 * are the whole reason to enrich, and neither appears without this list.
 *
 * Deliberately absent: `social_posts`, which is a beta add-on costing a
 * flat 5 credits per profile on top of the base charge. Nothing here should
 * ever request it by accident.
 */
const CORE_FIELDS = [
  "crustdata_person_id",
  "updated_at",
  "basic_profile",
  "professional_network",
  "social_handles",
  "experience",
  "education",
  "skills",
  "dev_platform_profiles",
];

/**
 * Sections that need field-level permission on the API key. Naming one the
 * account lacks returns 403 and fails the whole request, so they are tried
 * once and dropped if refused. `assessment` is free when granted.
 */
const GATED_FIELDS = ["assessment", "certifications", "honors"];

export interface EnrichedRecord {
  matched_on?: string;
  match_type?: string;
  match_status?: "matched" | "not_found" | "redacted" | string;
  matches?: { confidence_score?: number; person_data?: Record<string, unknown> }[];
}

/**
 * Which slice of a search an enrichment covers.
 *
 *  shortlist - the people you intend to contact. The real artifact.
 *  control   - a sample from the bottom of the ranking, enriched only to
 *              check whether the pre-enrichment ranker is doing anything.
 *              If the bottom five look the same as the top twenty on
 *              evidence depth, the ranker is noise and you want to know
 *              before building on it. Delete once that question is
 *              settled; it is measurement, not recruiting.
 */
export type EnrichmentCohort = "shortlist" | "control";

/** Who was enriched and where they sat in the ranking at the time, so a
 *  cohort can still be interpreted after the weights have moved on. */
export interface EnrichedSelection {
  url: string;
  name: string;
  rank: number;
  score: number;
  /** The vendor id, carried so the person store can be consulted before
   *  anything is bought. Null only for rows that arrived without one. */
  crustdataPersonId: number | null;
}

/** One person who cost nothing because the store already had them. */
export interface ReusedPerson {
  internalId: string;
  crustdataPersonId: number;
  name: string;
  ageDays: number | null;
}

export interface StoredEnrichment {
  searchId: string;
  cohort: EnrichmentCohort;
  enrichedAt: string;
  fieldsUsed: string[];
  creditsUsed: number;
  /** The ranking snapshot these profiles were drawn from. */
  selection: EnrichedSelection[];
  /** Profiles bought in this run. */
  records: EnrichedRecord[];
  /**
   * People this run did NOT pay for, because another hire had already
   * enriched them recently. The whole point of the person store, and
   * worth recording per run so the saving is visible rather than
   * invisible.
   */
  reused: ReusedPerson[];
  /** Everyone in this cohort, bought or reused, by internal id. The
   *  handle downstream steps should use. */
  internalIds: string[];
}

/** Cohorts live in separate files so one never overwrites the other, and
 *  so the control set can be deleted without touching the real work. */
function fileFor(searchId: string, cohort: EnrichmentCohort): string {
  return path.join(DATA_DIR, cohort === "control" ? `${searchId}.control.json` : `${searchId}.json`);
}

async function save(enrichment: StoredEnrichment): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      fileFor(enrichment.searchId, enrichment.cohort),
      JSON.stringify(enrichment, null, 2),
      "utf8"
    );
  } catch {
    // Persisting is a convenience. A disk failure should not lose data
    // that has already been paid for.
  }
}

export async function readEnrichment(
  searchId: string,
  cohort: EnrichmentCohort = "shortlist"
): Promise<StoredEnrichment | null> {
  try {
    const raw = await fs.readFile(fileFor(searchId, cohort), "utf8");
    // Cast to a partial: files written before cohorts existed are missing
    // these keys on disk, whatever the type says.
    const parsed = JSON.parse(raw) as Partial<StoredEnrichment>;
    return {
      searchId,
      enrichedAt: "",
      fieldsUsed: [],
      creditsUsed: 0,
      records: [],
      ...parsed,
      cohort: parsed.cohort ?? "shortlist",
      selection: parsed.selection ?? [],
      reused: parsed.reused ?? [],
      internalIds: parsed.internalIds ?? [],
    };
  } catch {
    return null;
  }
}

async function post(urls: string[], fields: string[], apiKey: string) {
  const res = await fetch(ENRICH_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      "x-api-version": CRUSTDATA_API_VERSION,
    },
    body: JSON.stringify({
      professional_network_profile_urls: urls,
      fields,
    }),
  });

  const credits = Number(res.headers.get("x-credits-used") ?? 0) || 0;
  const body = await res.json();
  return { ok: res.ok, status: res.status, credits, body };
}

/**
 * Enrich a set of profiles and keep the result.
 *
 * Consults the person store first. A profile someone else's hire
 * enriched inside the freshness window is reused rather than re-bought,
 * which at roughly a credit a head is the difference between a search
 * being cheap to explore and expensive to repeat. A frontend hire and a
 * full-stack hire surface many of the same people; the second should pay
 * for the difference, not the overlap.
 *
 * A `redacted` status means the person asked Crustdata to remove their
 * data: nothing is billed and retrying will not change it, which is
 * worth surfacing rather than treating as a failure.
 */
export async function enrichProfiles(
  searchId: string,
  selection: EnrichedSelection[],
  cohort: EnrichmentCohort = "shortlist"
): Promise<StoredEnrichment> {
  const apiKey = process.env.CRUSTDATA_API_KEY;
  if (!apiKey) throw new Error("CRUSTDATA_API_KEY is not set.");

  /**
   * Decide what to buy before buying anything.
   *
   * Rows without a vendor id cannot be checked against the store, so
   * they are treated as new. That is the safe direction: the cost of
   * being wrong is one credit, against a wrong reuse serving stale data
   * as if it were current.
   */
  const withId = selection.filter(
    (s): s is EnrichedSelection & { crustdataPersonId: number } =>
      typeof s.crustdataPersonId === "number"
  );
  const plans = await planEnrichment(withId.map((s) => s.crustdataPersonId));
  const planById = new Map(
    plans.map((p, i) => [withId[i].crustdataPersonId, p] as const)
  );

  const reused: ReusedPerson[] = [];
  const internalIds: string[] = [];
  const toBuy: EnrichedSelection[] = [];

  for (const row of selection) {
    const plan =
      typeof row.crustdataPersonId === "number"
        ? planById.get(row.crustdataPersonId)
        : undefined;

    if (plan && plan.action === "reuse") {
      // Costs nothing, but the hire still needs recording against the
      // person so "who has this come up for" stays answerable.
      await noteHire(plan.person.internalId, searchId);
      reused.push({
        internalId: plan.person.internalId,
        crustdataPersonId: plan.person.crustdataPersonId,
        name: plan.person.name,
        ageDays: plan.ageDays,
      });
      internalIds.push(plan.person.internalId);
      continue;
    }
    toBuy.push(row);
  }

  const urls = Array.from(new Set(toBuy.map((s) => s.url))).filter(Boolean);
  const wanted = [...CORE_FIELDS, ...GATED_FIELDS];
  let fieldsUsed = wanted;
  let creditsUsed = 0;
  const records: EnrichedRecord[] = [];

  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batch = urls.slice(i, i + BATCH_SIZE);

    let result = await post(batch, fieldsUsed, apiKey);
    creditsUsed += result.credits;

    // A refused gated field rejects the entire call, so fall back to the
    // core set once and stay there for the remaining batches.
    if (!result.ok && result.status === 403 && fieldsUsed !== CORE_FIELDS) {
      fieldsUsed = CORE_FIELDS;
      result = await post(batch, fieldsUsed, apiKey);
      creditsUsed += result.credits;
    }

    if (!result.ok) {
      const message =
        (result.body as { error?: { message?: string } })?.error?.message ??
        `Crustdata returned ${result.status}.`;
      throw new Error(message);
    }

    if (Array.isArray(result.body)) records.push(...(result.body as EnrichedRecord[]));
  }

  const enrichedAt = new Date().toISOString();

  /**
   * Write every bought profile into the store before returning.
   *
   * This is what makes the next hire cheap, so it happens here rather
   * than being left to a caller who might forget. A store write failing
   * must not lose data already paid for, so failures are swallowed per
   * person and the run still returns its records.
   */
  for (const record of records) {
    for (const match of record.matches ?? []) {
      const data = match.person_data as Record<string, any> | undefined;
      if (!data) continue;
      let person: Person | null = null;
      try {
        person = await upsertCrustdata(data, searchId, enrichedAt);
      } catch {
        person = null;
      }
      if (person) internalIds.push(person.internalId);
    }
  }

  const enrichment: StoredEnrichment = {
    searchId,
    cohort,
    enrichedAt,
    fieldsUsed,
    creditsUsed: Number(creditsUsed.toFixed(2)),
    selection,
    records,
    reused,
    internalIds: Array.from(new Set(internalIds)),
  };

  await save(enrichment);
  return enrichment;
}
