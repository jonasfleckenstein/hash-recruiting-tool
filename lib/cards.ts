import { readPerson } from "./people";
import { readShortlist } from "./shortlists";
import type { Person } from "./people";
import type { GithubEvidence } from "./github";

/**
 * Turning a person into a card.
 *
 * The brief asks for structured cards with evidence links, and the word
 * doing the work is "evidence". Everything a card asserts carries where
 * it came from and how much weight that origin deserves, because the two
 * sources behind a card are not equally trustworthy and pretending
 * otherwise is the failure mode of every recruiting tool.
 *
 *   attested      somebody other than the candidate caused this to exist.
 *                 A merged pull request, a contribution timestamp, a
 *                 review given. Hard to fake, and the strongest thing
 *                 here.
 *   self-reported the candidate typed it. Skills, role descriptions,
 *                 summaries, job titles. Useful, often true, never
 *                 evidence on its own.
 *   derived       computed from the above. Years in discipline, median
 *                 tenure, months active. Only as good as its input, so
 *                 the input is named.
 */
export type Basis = "attested" | "self-reported" | "derived";
export type Source = "crustdata" | "github";

export interface Claim {
  label: string;
  value: string;
  source: Source;
  basis: Basis;
  /** Where a reader can go to check it. */
  url?: string;
  /** Anything the reader should know before believing it. */
  caveat?: string;
}

export interface CardSection {
  title: string;
  /**
   * Where the whole section comes from and how much it is worth.
   *
   * Carried once here rather than tagged on every claim. Each section
   * draws on exactly one source, so a chip beside every row repeated
   * the same two words ten times and made the card harder to read
   * without making it more honest.
   */
  source: Source;
  basis: Basis;
  /**
   * The candidate in their own words, for this source.
   *
   * Kept per section rather than once at the top of the card, because
   * the two are written for different readers and often say different
   * things. One profile's professional summary is a paragraph of
   * career narrative; the same person's GitHub bio is one line about
   * being a physicist in Berlin. Showing them apart is more useful
   * than merging them.
   */
  quote?: string;
  claims: Claim[];
  /** Shown when the section is empty, so a gap is explained rather than
   *  looking like an oversight. */
  emptyNote?: string;
}

export interface Role {
  title: string;
  company: string;
  start: string | null;
  end: string | null;
  description: string | null;
  headcount: string | null;
  url?: string;
  current: boolean;
}

export interface CandidateCard {
  internalId: string;
  crustdataPersonId: number;
  name: string;
  headline: string | null;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  summary: string | null;

  links: { label: string; url: string; source: Source }[];

  /**
   * GitHub's "Available for hire" checkbox.
   *
   * Shown, never scored. It is a toggle people tick once and forget, so
   * letting it move a ranking would put a stale checkbox above real
   * work. It is worth a glance before writing to someone, and nothing
   * more. False and unset are the same thing here: nobody unticks a box
   * to say they are happy where they are.
   */
  openToWork: boolean;
  /**
   * Set since the professional profile was last read.
   *
   * GitHub says yes and Crustdata's snapshot of the same flag does not,
   * so the box was ticked somewhere between the two reads. That is a
   * dated signal rather than a standing one, which is the version worth
   * acting on: someone who turned it on last week is in a different
   * frame of mind from someone who turned it on in 2019 and forgot.
   *
   * Measured across 25 live profiles this never fired, because both
   * sources were read minutes apart. It only becomes meaningful as the
   * Crustdata record ages, since that refreshes monthly and GitHub
   * weekly.
   */
  recentlyOpenToWork: boolean;
  /** How stale the Crustdata read is, which is what bounds "recently". */
  openToWorkWindowDays: number | null;

  /**
   * What the profile photo shows.
   *
   * The frame is the only route to LinkedIn's open-to-work signal,
   * since Crustdata carries no such field, and it is the better signal
   * of the two: LinkedIn prompts people to remove it when they stop
   * looking, GitHub never does. But it is read off pixels, so it is
   * `derived` and stated as a property of the photo rather than of the
   * person.
   */
  photo: {
    url: string | null;
    openToWorkFrame: boolean;
    /** The measurements behind the call, so a wrong one is inspectable. */
    arcGreen: number;
    topGreen: number;
    hueSpread: number | null;
    status: string;
  } | null;

  roles: Role[];
  education: { school: string; degree: string | null; field: string | null; years: string | null }[];
  skills: string[];
  languages: string[];

  sections: CardSection[];

  /** What is known and what is simply absent, stated rather than implied. */
  coverage: {
    crustdataAgeDays: number | null;
    github: "ok" | "no_handle" | "error";
    githubNote: string;
    hasRoleDescriptions: boolean;
  };
}

/* -------------------------------------------------------------------------- */

function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

function years(start: string | null, end: string | null): string | null {
  const from = monthYear(start);
  if (!from) return null;
  return `${from} to ${monthYear(end) ?? "now"}`;
}

function daysBetween(iso: string): number | null {
  const n = (Date.now() - Date.parse(iso)) / 86400000;
  return Number.isFinite(n) ? Math.floor(n) : null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Comparable form of a URL, so the same link from two sources collapses.
 *
 * Query strings and fragments are dropped. On profile links they are
 * almost always tracking or locale noise (?utm_source, ?lang=en) rather
 * than part of the address, and keeping them shows one account twice.
 * Only the key is stripped: the link the card opens is whatever the
 * source gave, so nothing is lost by following it.
 */
function normaliseUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .split(/[?#]/)[0]
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(
      /^www\./,
      ""
    );
  } catch {
    return normaliseUrl(url);
  }
}

/**
 * A key that treats the same destination as the same link.
 *
 * String equality is not enough. One live profile produced two LinkedIn
 * chips and three X chips: LinkedIn serves country subdomains, so
 * uk.linkedin.com and www.linkedin.com are one profile, and X is still
 * published under both twitter.com and x.com. For LinkedIn only the
 * /in/ slug is durable; locale paths and query strings vary by source.
 */
function canonicalKey(url: string): string {
  const host = hostOf(url);
  const linkedin = /linkedin\.com\/in\/([^/?#]+)/i.exec(url);
  if (linkedin) {
    try {
      return `linkedin:${decodeURIComponent(linkedin[1]).toLowerCase()}`;
    } catch {
      return `linkedin:${linkedin[1].toLowerCase()}`;
    }
  }
  const site = /^(twitter|x)\.com$/.test(host) ? "x.com" : host;
  const path = normaliseUrl(url).slice(hostOf(url).length);
  return `${site}${path}`;
}

/** The @handle at the end of a profile URL, for telling two accounts on
 *  the same network apart. */
function handleOf(url: string): string | null {
  const last = normaliseUrl(url).split("/").filter(Boolean).pop();
  return last && last !== hostOf(url) ? last : null;
}

/**
 * What to call a link.
 *
 * Known networks get their name; everything else is labelled with its
 * hostname rather than something generic like "Website".
 *
 * That is deliberate. A declared personal site is not always the
 * person's: in this data one candidate's "website" resolved to
 * Instagram and another's to docs.nestjs.com, which is a framework's
 * documentation rather than anything he owns. Showing the host means a
 * wrong link is obvious at a glance instead of being dressed up as a
 * portfolio.
 */
function labelFor(url: string, provider?: string): string {
  const host = hostOf(url);
  const p = (provider ?? "").toLowerCase();
  if (p.includes("twitter") || p === "x" || /(^|\.)(twitter|x)\.com$/.test(host))
    return "X";
  if (p.includes("bluesky") || host.endsWith("bsky.app")) return "Bluesky";
  if (p.includes("linkedin") || host.endsWith("linkedin.com")) return "LinkedIn";
  if (p.includes("github") || host.endsWith("github.com")) return "GitHub";
  if (host.endsWith("mastodon.social") || p.includes("mastodon")) return "Mastodon";
  return host;
}

/* -------------------------------------------------------------------------- */

function githubSection(
  gh: GithubEvidence | null,
  fallbackBio: string | null
): CardSection {
  /** Prefer the live read; fall back to the copy Crustdata took, which
   *  is older but exists for records fetched before bio was requested. */
  const bio = gh?.bio ?? fallbackBio ?? undefined;
  const shell = {
    title: "GitHub",
    source: "github" as Source,
    basis: "attested" as Basis,
    quote: bio,
  };

  if (!gh || gh.status !== "ok") {
    return {
      ...shell,
      claims: [],
      emptyNote:
        "No public GitHub account found. For most commercial engineers that means their work is private, not that there is none, so this is unknown rather than a negative.",
    };
  }

  const claims: Claim[] = [];

  if (gh.activeMonths > 0) {
    claims.push({
      /**
       * Not volume. Someone with one heroic week scores worse here than
       * someone who shipped something small every month for two years,
       * which is the right way round for judging whether a person is
       * currently practising.
       */
      label: "Consistency",
      value: `Active in ${gh.activeMonths} of the last 36 months`,
      source: "github",
      basis: "attested",
      url: gh.profileUrl,
      caveat:
        gh.privateContributions > 0
          ? `Includes ${gh.privateContributions.toLocaleString()} contributions to private repositories, which GitHub counts but does not detail.`
          : undefined,
    });
  }

  if (gh.externalPrsMergedRecent > 0) {
    claims.push({
      label: "Merged into others' repos",
      value: plural(gh.externalPrsMergedRecent, "pull request"),
      source: "github",
      basis: "attested",
      caveat:
        gh.trivialPrs > 0
          ? `${gh.trivialPrs} more were too small to count as evidence.`
          : undefined,
    });
  }

  if (gh.reviewsGiven > 0) {
    claims.push({
      label: "Code reviews given",
      value: plural(gh.reviewsGiven, "review"),
      source: "github",
      basis: "attested",
      caveat: "Reviewing other people's work is senior behaviour and is invisible on a professional profile.",
    });
  }

  for (const pr of gh.notablePrs.slice(0, 4)) {
    claims.push({
      label: pr.repo,
      value: pr.title,
      source: "github",
      basis: "attested",
      url: pr.url,
      caveat: [
        `${pr.changedFiles} files, +${pr.additions}/-${pr.deletions}`,
        pr.repoStars > 0 ? `${pr.repoStars.toLocaleString()} stars` : null,
        pr.relation === "employer" ? "their employer's repo" : null,
        pr.keptFor === "prominence" ? "small diff, prominent project" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const repo of gh.topRepos.filter((r) => r.stars >= 25).slice(0, 3)) {
    claims.push({
      label: "Built",
      value: `${repo.nameWithOwner} (${repo.stars.toLocaleString()} stars)`,
      source: "github",
      basis: "attested",
      url: repo.url,
      caveat: [repo.language, repo.description].filter(Boolean).join(" · ") || undefined,
    });
  }

  /**
   * Sustained work across several repos of one org usually means
   * employment. Worth stating, because it has shown up on a profile
   * whose employment history did not mention the company at all.
   */
  for (const org of gh.externalOrgs.filter((o) => o.repos >= 3).slice(0, 2)) {
    claims.push({
      label: "Sustained work in one org",
      value: `${org.owner}: ${plural(org.repos, "repo")}, ${plural(org.commits, "commit")}`,
      source: "github",
      basis: "attested",
      url: `https://github.com/${org.owner}`,
      caveat:
        org.relation === "employer"
          ? "Matches their employment history."
          : "Not in their employment history, so possibly an employer they have not listed.",
    });
  }

  if (claims.length === 0) {
    return {
      ...shell,
      claims: [],
      emptyNote: `GitHub account found (${gh.login}) but nothing substantive in public: no recent merged pull requests, no reviews, no starred projects.${
        gh.privateContributions > 0
          ? ` ${gh.privateContributions.toLocaleString()} private contributions recorded, so they are working, just not in the open.`
          : ""
      }`,
    };
  }

  return { ...shell, claims };
}

/* -------------------------------------------------------------------------- */

export function buildCard(person: Person): CandidateCard {
  const d = person.crustdata.data as Record<string, any>;
  const bp = d.basic_profile ?? {};
  const emp = d.experience?.employment_details ?? {};
  const current: any[] = emp.current ?? [];
  const past: any[] = emp.past ?? [];
  const gh = person.github?.data ?? null;

  const roles: Role[] = [...current, ...past]
    .filter((r) => r?.title || r?.name)
    .map((r) => ({
      title: r.title ?? "Role not stated",
      company: r.name ?? "Company not stated",
      start: r.start_date ?? null,
      end: r.end_date ?? null,
      description: r.description ?? null,
      headcount: r.company_headcount_range ?? null,
      url: r.company_website_domain ? `https://${r.company_website_domain}` : undefined,
      current: current.includes(r),
    }));

  /**
   * Every way to reach this person, from both sources.
   *
   * Crustdata and GitHub each hold links the other does not: Crustdata
   * has the professional profile and an X handle, the dev platform
   * block has a website and declared handles, and GitHub's own
   * socialAccounts has whatever the person put on their profile there.
   * Collected together and de-duplicated, because the same site turning
   * up twice is noise rather than corroboration.
   */
  const dev = d.dev_platform_profiles?.[0] ?? {};
  const raw: { label?: string; url: string; source: Source; provider?: string }[] = [];

  if (person.linkedinUrl)
    raw.push({ label: "LinkedIn", url: person.linkedinUrl, source: "crustdata" });
  if (gh?.profileUrl) raw.push({ label: "GitHub", url: gh.profileUrl, source: "github" });

  const twitterSlug = d.social_handles?.twitter_identifier?.slug;
  if (twitterSlug)
    raw.push({
      label: "X",
      url: `https://x.com/${twitterSlug}`,
      source: "crustdata",
    });

  if (dev.website_url) raw.push({ url: String(dev.website_url), source: "crustdata" });
  for (const h of dev.declared_handles ?? []) {
    if (h?.url) raw.push({ url: String(h.url), source: "crustdata", provider: h.provider });
  }
  for (const a of gh?.socialAccounts ?? []) {
    raw.push({ url: a.url, source: "github", provider: a.provider });
  }

  const seen = new Set<string>();
  const links: { label: string; url: string; source: Source }[] = [];
  for (const l of raw) {
    const key = canonicalKey(l.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    links.push({
      label: l.label ?? labelFor(l.url, l.provider),
      url: l.url.startsWith("http") ? l.url : `https://${l.url}`,
      source: l.source,
    });
  }

  /**
   * Two accounts on the same network are not a bug. One candidate runs
   * @PouyaJabbari and @DeveloperPouya and both are his. Labelling them
   * both "X" is what makes that look like a duplicate, so where a label
   * repeats, the handle is appended to tell them apart.
   */
  const labelCounts = new Map<string, number>();
  for (const l of links) labelCounts.set(l.label, (labelCounts.get(l.label) ?? 0) + 1);
  for (const l of links) {
    if ((labelCounts.get(l.label) ?? 0) < 2) continue;
    const handle = handleOf(l.url);
    if (handle) l.label = `${l.label} @${handle}`;
  }

  const skills: string[] = d.skills?.professional_network_skills ?? [];

  /** Average months in a position, across every role with a duration.
   *  Says more about how someone works than the count of roles does. */
  const durations: number[] = [...current, ...past]
    .map((r: any) => r?.years_at_company_raw)
    .filter((v: unknown): v is number => typeof v === "number" && v > 0);
  const avgYears =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;

  /** Years since the most recent qualification finished. */
  const endYears: number[] = (d.education?.schools ?? [])
    .map((s: any) => Number(s?.end_year))
    .filter((y: number) => Number.isFinite(y) && y > 1950 && y <= new Date().getFullYear());
  const sinceDegree =
    endYears.length > 0 ? new Date().getFullYear() - Math.max(...endYears) : null;

  const track: CardSection = {
    title: "Crustdata",
    source: "crustdata",
    basis: "self-reported",
    quote: bp.summary ?? undefined,
    claims: [
      ...(current.length > 0
        ? [
            {
              label: "Now",
              value: `${current[0].title ?? "Role"} at ${current[0].name ?? "unknown"}${
                current[0].years_at_company_raw
                  ? `, ${Math.round(current[0].years_at_company_raw * 10) / 10} years`
                  : ""
              }`,
              source: "crustdata" as Source,
              basis: "self-reported" as Basis,
              url: person.linkedinUrl ?? undefined,
              caveat:
                current.length > 1
                  ? `Holds ${current.length} current roles, so one may be contract or a side project.`
                  : undefined,
            },
          ]
        : []),
      {
        label: "Positions on record",
        value:
          avgYears !== null
            ? `${plural(roles.length, "role")}, ${Math.round(avgYears * 10) / 10} years on average`
            : plural(roles.length, "role"),
        source: "crustdata" as Source,
        basis: "derived" as Basis,
      },
      ...(sinceDegree !== null
        ? [
            {
              label: "Years since last degree",
              value: String(sinceDegree),
              source: "crustdata" as Source,
              basis: "derived" as Basis,
            },
          ]
        : []),
    ],
  };

  return {
    internalId: person.internalId,
    crustdataPersonId: person.crustdataPersonId,
    name: person.name,
    headline: bp.headline ?? null,
    currentTitle: current[0]?.title ?? bp.current_title ?? null,
    currentCompany: current[0]?.name ?? null,
    location: bp.location?.full_location ?? bp.location?.city ?? null,
    summary: bp.summary ?? null,
    openToWork: gh?.isHireable === true,
    /**
     * Crustdata omits the flag rather than sending false, so anything
     * other than an explicit true means its snapshot did not have it.
     */
    recentlyOpenToWork:
      gh?.isHireable === true && dev.is_hireable !== true,
    openToWorkWindowDays: daysBetween(person.crustdata.fetchedAt),
    photo: person.photo
      ? {
          url: person.photo.data.url,
          openToWorkFrame: person.photo.data.openToWorkFrame,
          arcGreen: person.photo.data.arcGreen,
          topGreen: person.photo.data.topGreen,
          hueSpread: person.photo.data.hueSpread,
          status: person.photo.data.status,
        }
      : null,
    links,
    roles,
    education: (d.education?.schools ?? []).map((s: any) => ({
      school: s.school ?? "School not stated",
      degree: s.degree ?? null,
      field: s.field_of_study ?? null,
      years:
        s.start_year && s.end_year
          ? `${s.start_year} to ${s.end_year}`
          : s.end_year
            ? String(s.end_year)
            : null,
    })),
    skills,
    languages: bp.languages ?? [],
    sections: [track, githubSection(gh, dev.bio ?? null)],
    coverage: {
      crustdataAgeDays: daysBetween(person.crustdata.fetchedAt),
      github: !gh ? "no_handle" : gh.status === "ok" ? "ok" : "error",
      githubNote: !gh
        ? "No GitHub handle on the profile."
        : gh.status === "ok"
          ? `Read ${daysBetween(person.github!.fetchedAt) ?? 0} days ago.`
          : (gh.error ?? "The GitHub read failed."),
      hasRoleDescriptions: roles.some((r) => r.description && r.description.trim()),
    },
  };
}

/**
 * The people on one shortlist.
 *
 * Defaults to the most recent, which is what someone arriving from the
 * search results almost always wants. Older lists stay reachable by id
 * so a hire keeps a record of what was considered and when.
 */
export async function cardsForShortlist(
  searchId: string,
  listId?: string | null
): Promise<CandidateCard[]> {
  const list = await readShortlist(searchId, listId);
  if (!list) return [];

  const cards: CandidateCard[] = [];
  for (const internalId of list.internalIds) {
    const person = await readPerson(internalId);
    if (person) cards.push(buildCard(person));
  }
  return cards;
}
