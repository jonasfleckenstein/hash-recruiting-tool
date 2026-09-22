import fs from "node:fs/promises";
import path from "node:path";
import type { IdentifiedEvidence } from "./github";
import type { PhotoCheck } from "./photo";

const DATA_DIR = path.join(process.cwd(), ".data", "people");
const REGISTRY = path.join(DATA_DIR, "registry.json");

/**
 * How long an enrichment counts as current.
 *
 * A month. Employment, titles and skills move slowly enough that a
 * four-week-old profile is still a fair description of someone, and
 * re-buying it is a straight waste of credits. GitHub evidence has its
 * own, shorter window in lib/github.ts, because it is free.
 */
const FRESHNESS_DAYS = 30;

/**
 * Why this store exists.
 *
 * Enrichments used to live in `.data/enrichments/{searchId}.json`, one
 * file per search. That shape cannot answer the only question that
 * matters before spending a credit: has anyone, in any hire, already
 * enriched this person recently? A frontend search and a full-stack
 * search will surface the same people, and paying twice for them is pure
 * waste.
 *
 * So people are stored once, by person, and searches hold references.
 *
 *   registry.json      crustdata id -> internal id, plus the counter
 *   P-00001.json       one person: who they are, what each source said
 *
 * The registry is the ONLY place a vendor's identifier is used as a key.
 * Everything downstream of enrichment addresses people by internal id,
 * which is what makes it possible to add or replace a data source later
 * without rewriting the parts of the system that consume it.
 */

/** A source's contribution to a person record, with its own timestamp,
 *  because the two are fetched separately and age at different rates. */
export interface SourceRecord<T> {
  source: string;
  fetchedAt: string;
  data: T;
}

export interface Person {
  /** Sequential and human-readable: P-00001. Stable for the life of the
   *  person, and intended to outlive hiring as a personnel number. */
  internalId: string;
  /**
   * The vendor identifier this person was first matched on.
   *
   * Kept on the record as well as in the registry so a person file is
   * self-describing: anyone holding P-00042 can get back to the
   * Crustdata profile without loading the registry, and an export can
   * carry both columns.
   */
  crustdataPersonId: number;
  name: string;
  linkedinUrl: string | null;
  githubLogin: string | null;

  /** The Crustdata enrichment exactly as returned. */
  crustdata: SourceRecord<Record<string, unknown>>;
  /** GitHub evidence, absent when the person has no handle. Absent means
   *  unknown, never zero. */
  github: SourceRecord<IdentifiedEvidence> | null;
  /**
   * What their profile photo shows.
   *
   * Its own source because it is neither Crustdata's claim nor
   * GitHub's: it is something read off an image, and the card has to be
   * able to say so.
   */
  photo: SourceRecord<PhotoCheck> | null;

  firstSeenAt: string;
  /** Every hire whose search surfaced this person. The reason the store
   *  is worth having: the second hire pays nothing. */
  seenInHires: string[];
}

interface Registry {
  version: number;
  /** Next sequence number to mint. */
  nextSequence: number;
  /** crustdata id (as string, since JSON object keys are strings) -> internal id. */
  byCrustdataId: Record<string, string>;
}

const EMPTY_REGISTRY: Registry = {
  version: 1,
  nextSequence: 1,
  byCrustdataId: {},
};

/* -------------------------------------------------------------------------- */
/* Registry                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Serialise registry writes.
 *
 * Enrichment mints ids for a batch of people at once. Two concurrent
 * read-modify-write cycles on the counter would hand the same number to
 * two people, which is the one bug this store cannot tolerate. A promise
 * chain is enough: this runs on one machine, in one process.
 */
let queue: Promise<unknown> = Promise.resolve();
function serialise<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function readRegistry(): Promise<Registry> {
  try {
    const parsed = JSON.parse(await fs.readFile(REGISTRY, "utf8")) as Partial<Registry>;
    return { ...EMPTY_REGISTRY, ...parsed };
  } catch {
    return { ...EMPTY_REGISTRY };
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(REGISTRY, JSON.stringify(registry, null, 2), "utf8");
}

export function formatInternalId(sequence: number): string {
  return `P-${String(sequence).padStart(5, "0")}`;
}

/** The internal id for a Crustdata id, if this person is already known. */
export async function findInternalId(
  crustdataPersonId: number
): Promise<string | null> {
  const registry = await readRegistry();
  return registry.byCrustdataId[String(crustdataPersonId)] ?? null;
}

/** Internal id -> Crustdata id, for the rare direction back to the vendor. */
export async function findCrustdataId(internalId: string): Promise<number | null> {
  const person = await readPerson(internalId);
  return person?.crustdataPersonId ?? null;
}

/* -------------------------------------------------------------------------- */
/* People                                                                      */
/* -------------------------------------------------------------------------- */

function fileFor(internalId: string): string {
  return path.join(DATA_DIR, `${internalId}.json`);
}

export async function readPerson(internalId: string): Promise<Person | null> {
  try {
    return JSON.parse(await fs.readFile(fileFor(internalId), "utf8")) as Person;
  } catch {
    return null;
  }
}

export async function readPersonByCrustdataId(
  crustdataPersonId: number
): Promise<Person | null> {
  const internalId = await findInternalId(crustdataPersonId);
  return internalId ? readPerson(internalId) : null;
}

async function writePerson(person: Person): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(fileFor(person.internalId), JSON.stringify(person, null, 2), "utf8");
}

/** Whether an enrichment is recent enough to reuse instead of re-buying. */
export function isFresh(person: Person, maxAgeDays = FRESHNESS_DAYS): boolean {
  const age =
    (Date.now() - Date.parse(person.crustdata.fetchedAt)) / (1000 * 60 * 60 * 24);
  return Number.isFinite(age) && age <= maxAgeDays;
}

export function ageInDays(person: Person): number | null {
  const age =
    (Date.now() - Date.parse(person.crustdata.fetchedAt)) / (1000 * 60 * 60 * 24);
  return Number.isFinite(age) ? Math.floor(age) : null;
}

/**
 * What to do about one profile before spending anything on it.
 *
 *  reuse   - enriched recently by some hire. Costs nothing.
 *  refresh - known, but the enrichment has aged out.
 *  new     - never seen.
 */
export type EnrichmentPlan =
  | { action: "reuse"; person: Person; ageDays: number | null }
  | { action: "refresh"; person: Person; ageDays: number | null }
  | { action: "new"; crustdataPersonId: number };

export async function planEnrichment(
  crustdataPersonIds: number[],
  maxAgeDays = FRESHNESS_DAYS
): Promise<EnrichmentPlan[]> {
  const registry = await readRegistry();
  const plans: EnrichmentPlan[] = [];

  for (const id of crustdataPersonIds) {
    const internalId = registry.byCrustdataId[String(id)];
    const person = internalId ? await readPerson(internalId) : null;
    if (!person) {
      plans.push({ action: "new", crustdataPersonId: id });
      continue;
    }
    plans.push({
      action: isFresh(person, maxAgeDays) ? "reuse" : "refresh",
      person,
      ageDays: ageInDays(person),
    });
  }
  return plans;
}

/**
 * Record a Crustdata enrichment, minting an internal id on first sight.
 *
 * `hireId` is appended rather than replaced, so a person record
 * accumulates the hires that surfaced them. That history is what makes
 * "this person already came up for the frontend role" answerable.
 */
export async function upsertCrustdata(
  personData: Record<string, any>,
  hireId: string,
  enrichedAt = new Date().toISOString()
): Promise<Person | null> {
  const crustdataPersonId = personData?.crustdata_person_id;
  if (typeof crustdataPersonId !== "number") return null;

  return serialise(async () => {
    const registry = await readRegistry();
    const key = String(crustdataPersonId);
    let internalId = registry.byCrustdataId[key];

    if (!internalId) {
      internalId = formatInternalId(registry.nextSequence);
      registry.byCrustdataId[key] = internalId;
      registry.nextSequence += 1;
      await writeRegistry(registry);
    }

    const existing = await readPerson(internalId);
    const person: Person = {
      internalId,
      crustdataPersonId,
      name: personData?.basic_profile?.name ?? existing?.name ?? "Unnamed profile",
      linkedinUrl:
        personData?.social_handles?.professional_network_identifier?.profile_url ??
        existing?.linkedinUrl ??
        null,
      githubLogin:
        (personData?.dev_platform_profiles?.[0]?.profile_url ?? "")
          .replace(/\/+$/, "")
          .split("/")
          .pop() || existing?.githubLogin || null,
      crustdata: { source: "crustdata", fetchedAt: enrichedAt, data: personData },
      // Keep any GitHub evidence already held: it is fetched separately
      // and a Crustdata refresh says nothing about whether it is stale.
      github: existing?.github ?? null,
      photo: existing?.photo ?? null,
      firstSeenAt: existing?.firstSeenAt ?? enrichedAt,
      seenInHires: Array.from(new Set([...(existing?.seenInHires ?? []), hireId])),
    };

    await writePerson(person);
    return person;
  });
}

/** Attach GitHub evidence to a person already in the store. */
export async function attachGithub(
  internalId: string,
  evidence: IdentifiedEvidence
): Promise<Person | null> {
  const person = await readPerson(internalId);
  if (!person) return null;
  person.github = {
    source: "github",
    fetchedAt: evidence.fetchedAt,
    data: evidence,
  };
  person.githubLogin = evidence.login || person.githubLogin;
  await writePerson(person);
  return person;
}

/** Attach the result of reading someone's profile photo. */
export async function attachPhoto(
  internalId: string,
  check: PhotoCheck
): Promise<Person | null> {
  const person = await readPerson(internalId);
  if (!person) return null;
  person.photo = { source: "photo", fetchedAt: check.checkedAt, data: check };
  await writePerson(person);
  return person;
}

/** Note that a hire's search surfaced this person, without re-enriching. */
export async function noteHire(internalId: string, hireId: string): Promise<void> {
  const person = await readPerson(internalId);
  if (!person || person.seenInHires.includes(hireId)) return;
  person.seenInHires.push(hireId);
  await writePerson(person);
}

export interface PersonSummary {
  internalId: string;
  crustdataPersonId: number;
  name: string;
  githubLogin: string | null;
  enrichedAt: string;
  ageDays: number | null;
  fresh: boolean;
  hasGithub: boolean;
  seenInHires: string[];
}

export async function listPeople(): Promise<PersonSummary[]> {
  try {
    const files = await fs.readdir(DATA_DIR);
    const people = await Promise.all(
      files
        .filter((f) => f.startsWith("P-") && f.endsWith(".json"))
        .map((f) => readPerson(f.replace(/\.json$/, "")))
    );
    return people
      .filter((p): p is Person => p !== null)
      .map((p) => ({
        internalId: p.internalId,
        crustdataPersonId: p.crustdataPersonId,
        name: p.name,
        githubLogin: p.githubLogin,
        enrichedAt: p.crustdata.fetchedAt,
        ageDays: ageInDays(p),
        fresh: isFresh(p),
        hasGithub: p.github !== null,
        seenInHires: p.seenInHires,
      }))
      .sort((a, b) => a.internalId.localeCompare(b.internalId));
  } catch {
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Migration                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Move already-paid-for enrichments into the store.
 *
 * Idempotent, and deliberately preserves each file's original
 * `enrichedAt` rather than stamping today. Some of those dates are
 * already close to the freshness limit, so the imported records will age
 * out and refresh on next use, which is the correct behaviour: pretending
 * old data is new would be worse than paying for it again.
 *
 * Reads, never deletes. The enrichment files stay where they are as a
 * record of what each search cost.
 */
export async function importLegacyEnrichments(): Promise<{
  files: number;
  imported: number;
  skipped: number;
  hires: string[];
}> {
  const legacyDir = path.join(process.cwd(), ".data", "enrichments");
  let files: string[] = [];
  try {
    files = (await fs.readdir(legacyDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return { files: 0, imported: 0, skipped: 0, hires: [] };
  }

  let imported = 0;
  let skipped = 0;
  const hires = new Set<string>();

  for (const file of files) {
    let parsed: any;
    try {
      parsed = JSON.parse(await fs.readFile(path.join(legacyDir, file), "utf8"));
    } catch {
      continue;
    }

    /**
     * Each enrichment file belongs to one search, and one hire is one
     * search, so the searchId is the hire. The control cohort shares its
     * searchId with the shortlist and is the same hire, correctly.
     */
    const hireId: string = parsed?.searchId ?? file.replace(/\.(control\.)?json$/, "");
    const enrichedAt: string = parsed?.enrichedAt ?? new Date().toISOString();
    hires.add(hireId);

    for (const record of parsed?.records ?? []) {
      for (const match of record?.matches ?? []) {
        const personData = match?.person_data;
        if (!personData?.crustdata_person_id) {
          skipped += 1;
          continue;
        }
        const existing = await readPersonByCrustdataId(personData.crustdata_person_id);
        // A later file wins only if it is actually newer.
        if (existing && Date.parse(existing.crustdata.fetchedAt) >= Date.parse(enrichedAt)) {
          await noteHire(existing.internalId, hireId);
          skipped += 1;
          continue;
        }
        const person = await upsertCrustdata(personData, hireId, enrichedAt);
        if (person) imported += 1;
        else skipped += 1;
      }
    }
  }

  return { files: files.length, imported, skipped, hires: [...hires] };
}
