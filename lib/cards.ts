import { readEnrichment } from "./enrich";
import { readPerson } from "./people";
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

/* -------------------------------------------------------------------------- */

function githubSection(gh: GithubEvidence | null): CardSection {
  if (!gh || gh.status !== "ok") {
    return {
      title: "Evidence of work",
      claims: [],
      emptyNote:
        "No public GitHub account found. For most commercial engineers that means their work is private, not that there is none, so this is unknown rather than a negative.",
    };
  }

  const claims: Claim[] = [];

  if (gh.activeMonths > 0) {
    claims.push({
      label: "Active months",
      value: `${gh.activeMonths} of the last 36`,
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
      title: "Evidence of work",
      claims: [],
      emptyNote: `GitHub account found (${gh.login}) but nothing substantive in public: no recent merged pull requests, no reviews, no starred projects.${
        gh.privateContributions > 0
          ? ` ${gh.privateContributions.toLocaleString()} private contributions recorded, so they are working, just not in the open.`
          : ""
      }`,
    };
  }

  return { title: "Evidence of work", claims };
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

  const links: { label: string; url: string; source: Source }[] = [];
  if (person.linkedinUrl)
    links.push({ label: "LinkedIn", url: person.linkedinUrl, source: "crustdata" });
  if (gh?.profileUrl) links.push({ label: "GitHub", url: gh.profileUrl, source: "github" });
  for (const account of gh?.socialAccounts ?? []) {
    links.push({
      label: account.provider.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()),
      url: account.url,
      source: "github",
    });
  }

  const skills: string[] = d.skills?.professional_network_skills ?? [];
  const withDescriptions = roles.filter((r) => r.description && r.description.trim());

  const track: CardSection = {
    title: "Track record",
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
        value: plural(roles.length, "role"),
        source: "crustdata" as Source,
        basis: "self-reported" as Basis,
      },
      ...(withDescriptions.length > 0
        ? [
            {
              label: "Written up",
              value: `${withDescriptions.length} of ${roles.length} roles`,
              source: "crustdata" as Source,
              basis: "self-reported" as Basis,
              caveat:
                "People write a job up after they leave it, so a blank current role is normal.",
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
    sections: [track, githubSection(gh)],
    coverage: {
      crustdataAgeDays: daysBetween(person.crustdata.fetchedAt),
      github: !gh ? "no_handle" : gh.status === "ok" ? "ok" : "error",
      githubNote: !gh
        ? "No GitHub handle on the profile."
        : gh.status === "ok"
          ? `Read ${daysBetween(person.github!.fetchedAt) ?? 0} days ago.`
          : (gh.error ?? "The GitHub read failed."),
      hasRoleDescriptions: withDescriptions.length > 0,
    },
  };
}

/** Every enriched person for a hire, in the order they were enriched. */
export async function cardsForHire(searchId: string): Promise<CandidateCard[]> {
  const enrichment = await readEnrichment(searchId);
  if (!enrichment) return [];

  const cards: CandidateCard[] = [];
  for (const internalId of enrichment.internalIds ?? []) {
    const person = await readPerson(internalId);
    if (person) cards.push(buildCard(person));
  }
  return cards;
}
