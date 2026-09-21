import { effectiveTitles } from "./crustdata";
import type { Criterion, RoleBrief } from "./types";

/**
 * One role in someone's history. `description` is what the person wrote
 * about the job, and it is the richest thing search returns: most evidence
 * for anything beyond a job title comes from here. Nullable, so never
 * assume it is present.
 */
export interface EmploymentRole {
  name?: string | null;
  title?: string | null;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  seniority_level?: string | null;
  function_category?: string | null;
  years_at_company_raw?: number | null;
  company_headcount_latest?: number | null;
  company_headcount_range?: string | null;
  company_industries?: string[] | null;
  company_type?: string | null;
}

/** The shape of a profile as Person Search returns it. Everything is
 *  optional: search returns a lightweight subset and the docs are explicit
 *  that fields go missing. */
export interface RawProfile {
  crustdata_person_id?: number;
  basic_profile?: {
    name?: string;
    headline?: string;
    current_title?: string;
    profile_picture_permalink?: string | null;
    location?: {
      city?: string | null;
      state?: string | null;
      country?: string | null;
      raw?: string | null;
    } | null;
    normalized_title?: {
      matched_title?: string | null;
      department?: string | null;
      sub_department?: string | null;
      confident?: boolean | null;
    } | null;
  };
  social_handles?: {
    professional_network_identifier?: { profile_url?: string };
    dev_platform_identifier?: { profile_url?: string | null };
    twitter_identifier?: { slug?: string | null } | null;
  };
  experience?: {
    employment_details?: {
      current?: EmploymentRole[];
      past?: EmploymentRole[];
    };
  };
  education?: {
    schools?: { school?: string; degree?: string | null }[];
  };
  /** Availability flag only, and entitlement-gated, so often absent. */
  contact?: { has_business_email?: boolean };
  /** When Crustdata last refreshed this profile. */
  metadata?: { updated_at?: string | null };
}

export interface Candidate {
  id: number;
  name: string;
  headline?: string;
  currentTitle?: string;
  currentCompany?: string;
  location?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  /** Crustdata's own classification of the current title. Beta, so shown
   *  rather than relied on. */
  department?: string;
  subDepartment?: string;
  education: { school: string; degree?: string }[];
  past: { company: string; title: string }[];
  /** When Crustdata last refreshed the profile, if it said. */
  updatedAt?: string;
  /** Whether a verified business email exists, when the account may see it. */
  hasBusinessEmail?: boolean;
  /** Searched titles this person's current title satisfies. */
  matchedTitles: string[];
  /** Backgrounds found somewhere in their job history. */
  matchedBackgrounds: string[];
  /**
   * Criteria that cannot be checked from a search response at all. Skills
   * and GitHub data are filterable but never returned, so a skill match is
   * something the API asserted rather than something we can show. Proving
   * it needs an enrich call on the shortlist.
   */
  unverifiable: string[];
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter(Boolean);
}

/** The same all-words rule Crustdata's `(.)` operator applies, so what the
 *  card claims about a match agrees with what the query asked for. */
function allWordsPresent(haystack: string, needle: string): boolean {
  const hay = new Set(tokens(haystack));
  const need = tokens(needle);
  return need.length > 0 && need.every((t) => hay.has(t));
}

function joinLocation(location: RawProfile["basic_profile"] extends infer T
  ? T extends { location?: infer L }
    ? L
    : never
  : never): string | undefined {
  if (!location) return undefined;
  const { city, country, raw } = location as {
    city?: string | null;
    country?: string | null;
    raw?: string | null;
  };
  const parts = [city, country].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : raw ?? undefined;
}

export function toCandidate(raw: RawProfile, brief: RoleBrief): Candidate {
  const current = raw.experience?.employment_details?.current ?? [];
  const past = raw.experience?.employment_details?.past ?? [];
  const allRoles = [...current, ...past];

  const currentTitles = current
    .map((r) => r?.title ?? "")
    .filter(Boolean)
    .concat(raw.basic_profile?.current_title ?? []);

  const searchedTitles = effectiveTitles(brief);
  const matchedTitles = searchedTitles.filter((t) =>
    currentTitles.some((ct) => allWordsPresent(ct, t))
  );

  const gatingBackgrounds = brief.criteria
    .filter((c): c is Criterion => c.selected && c.check === "filter")
    .flatMap((c) => c.backgrounds ?? []);

  const matchedBackgrounds = Array.from(
    new Set(
      gatingBackgrounds.filter((b) =>
        allRoles.some((r) => allWordsPresent(r?.title ?? "", b))
      )
    )
  );

  const unverifiable = brief.criteria
    .filter((c) => c.selected && c.check === "filter" && (c.skills?.length ?? 0) > 0)
    .map((c) => c.label);

  return {
    id: raw.crustdata_person_id ?? 0,
    name: raw.basic_profile?.name ?? "Unnamed profile",
    headline: raw.basic_profile?.headline ?? undefined,
    currentTitle: current[0]?.title ?? raw.basic_profile?.current_title ?? undefined,
    currentCompany: current[0]?.name ?? undefined,
    location: joinLocation(raw.basic_profile?.location),
    linkedinUrl: raw.social_handles?.professional_network_identifier?.profile_url,
    githubUrl: raw.social_handles?.dev_platform_identifier?.profile_url ?? undefined,
    department: raw.basic_profile?.normalized_title?.department ?? undefined,
    subDepartment: raw.basic_profile?.normalized_title?.sub_department ?? undefined,
    education: (raw.education?.schools ?? [])
      .filter((s) => s?.school)
      .slice(0, 3)
      .map((s) => ({ school: s.school as string, degree: s.degree ?? undefined })),
    past: past
      .filter((r) => r?.name || r?.title)
      .slice(0, 3)
      .map((r) => ({ company: r.name ?? "", title: r.title ?? "" })),
    updatedAt: raw.metadata?.updated_at ?? undefined,
    hasBusinessEmail: raw.contact?.has_business_email,
    matchedTitles,
    matchedBackgrounds,
    unverifiable,
  };
}
