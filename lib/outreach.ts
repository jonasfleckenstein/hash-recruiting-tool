import fs from "node:fs/promises";
import path from "node:path";
import { SONNET, askForJson } from "./anthropic";
import { buildCard } from "./cards";
import { readVerdictCache } from "./judge";
import { readMatchSet } from "./matching";
import type { Person } from "./people";

const DATA_DIR = path.join(process.cwd(), ".data", "outreach");

/**
 * What the company is, in the writer's own words.
 *
 * Short and concrete on purpose. An earlier version handed over the
 * careers-page paragraph and asked for a summary; what came back read
 * like a summary. One plain line about what is actually being built
 * beats three lines of positioning.
 *
 * Belongs in settings once there is more than one employer using this.
 */
const COMPANY = `HASH is building an open-source Palantir, and works on process foundation models.`;

export interface OutreachDraft {
  internalId: string;
  /** What the operator said they liked. The steer for the whole draft. */
  note: string;
  subject: string;
  body: string;
  generatedAt: string;
  model: string;
}

/** Who is writing. Stored once for the operator rather than per hire,
 *  since it is the same person every time. */
export interface Sender {
  name: string;
  role: string;
}

/* -------------------------------------------------------------------------- */
/* Prompt                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Why this prompt is shaped the way it is.
 *
 * Recruiting outreach fails in a recognisable way: it opens with a
 * pleasantry, praises a background in general terms, describes the
 * company at length, and closes by asking for time. Every part of that
 * is generic, so the reader learns in one line that it was sent to
 * hundreds of people.
 *
 * The answer is not more personality. It is a plain, short message in
 * a fixed shape, with one true sentence in it about this particular
 * person. The structure is given verbatim because a model left to
 * choose its own reaches for the recruiter register every time.
 */
const SYSTEM = `You write a short first message from someone at a startup to one engineer. Plain, warm, direct. The kind of note a busy person actually answers.

FOLLOW THIS STRUCTURE EXACTLY, filling the angle brackets:

Hi <their first name>,

My name is <sender name> and I am <a or the, whichever reads naturally><sender role> at HASH. <One short sentence on what HASH is building, from the company note.> We are growing very fast right now and looking for new people.

I found your profile and thought you could be a great addition as <role title>. <One sentence saying why they are a good fit, taken from what the sender wrote.> We are looking for someone with experience in <two or three short phrases from the must-haves>.

If you are interested, I would be keen to talk.

Best,
<sender name>

HOW TO WRITE IT
- Under 110 words in total.
- Short sentences. Easy English. Never a long word where a short one works.
- Use the article that reads naturally before the sender's role: "a Founder's Associate", "the CTO". If the role already reads as a title with no article, leave it out.
- The fit sentence comes from what the sender wrote about this person. Put it in your own plain words. If the sender wrote nothing, take one concrete thing from the evidence instead.
- Keep the company line to one sentence.

NEVER
- Change the structure, add paragraphs, or add a PS.
- Add a sentence describing the team, the mission, or the market.
- Use: reach out, touch base, synergies, rockstar, passionate, exciting opportunity, perfect fit, journey, leverage, I hope this finds you well.
- Use an exclamation mark.
- Flatter, or pile on adjectives.
- Invent anything. If it is not in the evidence or the sender's note, it does not go in.
- Mention a database, a tool, a search, or AI.

OUTPUT
Return only JSON: {"subject": "...", "body": "..."}
Subject: under eight words, no colon, sentence case.
Body: plain text, blank lines between paragraphs, exactly the structure above.`;

function evidenceFor(person: Person, metSpans: string[]): string {
  const card = buildCard(person);
  const gh = person.github?.data ?? null;
  const parts: string[] = [];

  parts.push(`Name: ${card.name}`);
  if (card.currentTitle || card.currentCompany) {
    parts.push(
      `Now: ${[card.currentTitle, card.currentCompany].filter(Boolean).join(" at ")}`
    );
  }
  if (card.location) parts.push(`Based: ${card.location}`);

  if (card.summary) parts.push(`\nTheir own summary:\n${card.summary}`);

  const bio = gh?.bio;
  if (bio) parts.push(`\nTheir GitHub bio:\n${bio}`);

  if (metSpans.length > 0) {
    parts.push(
      `\nThings they wrote about their work that fit this role:\n${metSpans
        .map((s) => `- ${s}`)
        .join("\n")}`
    );
  }

  const prs = (gh?.notablePrs ?? []).slice(0, 4);
  if (prs.length > 0) {
    parts.push(
      `\nPublic work, merged into other people's projects:\n${prs
        .map(
          (p) =>
            `- ${p.title} (${p.repo}${p.repoStars > 500 ? `, ${p.repoStars.toLocaleString()} stars` : ""})`
        )
        .join("\n")}`
    );
  }

  const repos = (gh?.topRepos ?? []).filter((r) => r.stars >= 50).slice(0, 3);
  if (repos.length > 0) {
    parts.push(
      `\nProjects of their own:\n${repos
        .map(
          (r) =>
            `- ${r.nameWithOwner}, ${r.stars.toLocaleString()} stars${r.description ? `: ${r.description}` : ""}`
        )
        .join("\n")}`
    );
  }

  const roles = card.roles.filter((r) => r.description).slice(0, 3);
  if (roles.length > 0) {
    parts.push(
      `\nHow they describe past roles:\n${roles
        .map((r) => `- ${r.title} at ${r.company}: ${r.description?.slice(0, 400)}`)
        .join("\n")}`
    );
  }

  return parts.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Generate                                                                    */
/* -------------------------------------------------------------------------- */

export async function generateDraft(options: {
  searchId: string;
  person: Person;
  roleTitle: string;
  note: string;
  sender: Sender;
}): Promise<OutreachDraft> {
  const { searchId, person, roleTitle, note, sender } = options;

  /**
   * The verdicts already found the passages that matter. Reusing them
   * means the draft cites the same evidence the matching page showed,
   * rather than the model picking something different out of the same
   * profile and leaving the two views disagreeing.
   */
  const [cache, matchSet] = await Promise.all([
    readVerdictCache(searchId),
    readMatchSet(searchId),
  ]);
  const labels = new Map(matchSet.criteria.map((c) => [c.id, c.label]));
  const metSpans = Object.values(cache)
    .filter((v) => v.verdict === "met" && v.span)
    .map((v) => `${labels.get(v.criterionId) ?? "fit"}: ${v.span}`);
  const musts = matchSet.criteria
    .filter((c) => c.kind === "must")
    .map((c) => c.label);

  const user = [
    `SENDER\nName: ${sender.name || "(not given)"}\nRole: ${sender.role || "(not given)"}`,
    `\nROLE BEING HIRED FOR\n${roleTitle}`,
    musts.length > 0
      ? `\nMUST-HAVES (compress two or three of these into short plain phrases)\n${musts.map((m) => `- ${m}`).join("\n")}`
      : "",
    `\nTHE COMPANY (use this for the one company sentence)\n${COMPANY}`,
    note.trim()
      ? `\nWHY THE SENDER THINKS THIS PERSON FITS (this is the fit sentence, put it in plain words)\n${note.trim()}`
      : "",
    `\nEVIDENCE ABOUT THIS PERSON\n${evidenceFor(person, metSpans)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const reply = (await askForJson({
    model: SONNET,
    system: SYSTEM,
    user,
    maxTokens: 800,
  })) as { subject?: string; body?: string };

  return {
    internalId: person.internalId,
    note,
    subject: (reply.subject ?? "").trim(),
    body: (reply.body ?? "").trim(),
    generatedAt: new Date().toISOString(),
    model: SONNET,
  };
}

/* -------------------------------------------------------------------------- */
/* Sender                                                                      */
/* -------------------------------------------------------------------------- */

/** Global, not per hire: the same person writes every message. */
const SENDER_FILE = path.join(DATA_DIR, "sender.json");

export async function readSender(): Promise<Sender> {
  try {
    const parsed = JSON.parse(await fs.readFile(SENDER_FILE, "utf8"));
    return { name: parsed.name ?? "", role: parsed.role ?? "" };
  } catch {
    return { name: "", role: "" };
  }
}

export async function writeSender(sender: Sender): Promise<Sender> {
  const next = { name: sender.name.trim(), role: sender.role.trim() };
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(SENDER_FILE, JSON.stringify(next, null, 2), "utf8");
  } catch {
    // Retyping a name is a small cost.
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Selection                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Who is on the outreach list for this hire.
 *
 * Persisted rather than passed in a URL, because it is a decision
 * rather than a view. Ticking someone on the matching page puts them
 * on the list and they stay there across reloads and between sessions;
 * unticking is the only thing that removes them. A selection that
 * evaporated on navigation would make the tick feel like a filter,
 * which is not what it means.
 *
 * Order is the order they were picked, which is usually the order
 * someone means to write in.
 */
function selectionFile(searchId: string): string {
  return path.join(DATA_DIR, `${searchId}.selection.json`);
}

export async function readSelection(searchId: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(await fs.readFile(selectionFile(searchId), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function writeSelection(
  searchId: string,
  internalIds: string[]
): Promise<string[]> {
  const unique = Array.from(new Set(internalIds.filter(Boolean)));
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      selectionFile(searchId),
      JSON.stringify(unique, null, 2),
      "utf8"
    );
  } catch {
    // The list is a convenience; losing it costs a few ticks.
  }
  return unique;
}

/* -------------------------------------------------------------------------- */
/* Store                                                                       */
/* -------------------------------------------------------------------------- */

function fileFor(searchId: string): string {
  return path.join(DATA_DIR, `${searchId}.json`);
}

export async function readDrafts(
  searchId: string
): Promise<Record<string, OutreachDraft>> {
  try {
    return JSON.parse(await fs.readFile(fileFor(searchId), "utf8"));
  } catch {
    return {};
  }
}

export async function saveDraft(
  searchId: string,
  draft: OutreachDraft
): Promise<void> {
  const all = await readDrafts(searchId);
  all[draft.internalId] = draft;
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(fileFor(searchId), JSON.stringify(all, null, 2), "utf8");
  } catch {
    // A lost draft costs one regeneration, not the work behind it.
  }
}
