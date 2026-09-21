import type { RawProfile } from "./candidates";

/**
 * What actually arrived, as opposed to what was asked for.
 *
 * Requesting a field family does not mean every profile carries it. Role
 * descriptions in particular are nullable, and they are the main evidence a
 * scorer has for anything beyond a job title. If most profiles have none,
 * scoring from search data alone will be thin and enrichment stops being
 * optional. This panel is here so that is a measured decision rather than an
 * assumption.
 */
export interface CoverageRow {
  label: string;
  present: number;
  note?: string;
}

export interface Coverage {
  total: number;
  rows: CoverageRow[];
  /** Median age of the profile data in whole months, when dates came back. */
  medianAgeMonths: number | null;
}

function count(profiles: RawProfile[], has: (p: RawProfile) => boolean): number {
  return profiles.filter((p) => {
    try {
      return has(p);
    } catch {
      return false;
    }
  }).length;
}

function roles(p: RawProfile) {
  const e = p.experience?.employment_details;
  return [...(e?.current ?? []), ...(e?.past ?? [])];
}

function monthsSince(iso: string): number | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.round((Date.now() - then) / (1000 * 60 * 60 * 24 * 30.44));
}

export function summariseCoverage(profiles: RawProfile[]): Coverage {
  const total = profiles.length;

  const ages = profiles
    .map((p) => p.metadata?.updated_at)
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map(monthsSince)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);

  const medianAgeMonths =
    ages.length > 0 ? ages[Math.floor(ages.length / 2)] : null;

  const rows: CoverageRow[] = [
    { label: "Name", present: count(profiles, (p) => Boolean(p.basic_profile?.name)) },
    {
      label: "Headline",
      present: count(profiles, (p) => Boolean(p.basic_profile?.headline)),
    },
    {
      label: "Location",
      present: count(profiles, (p) => Boolean(p.basic_profile?.location?.raw)),
    },
    {
      label: "Current role",
      present: count(
        profiles,
        (p) => (p.experience?.employment_details?.current?.length ?? 0) > 0
      ),
    },
    {
      label: "Past roles",
      present: count(
        profiles,
        (p) => (p.experience?.employment_details?.past?.length ?? 0) > 0
      ),
    },
    {
      label: "Any role description",
      present: count(profiles, (p) => roles(p).some((r) => Boolean(r?.description))),
      note: "the main evidence for anything beyond a job title",
    },
    {
      label: "Role dates",
      present: count(profiles, (p) => roles(p).some((r) => Boolean(r?.start_date))),
    },
    {
      label: "Education",
      present: count(profiles, (p) => (p.education?.schools?.length ?? 0) > 0),
    },
    {
      label: "Profile link",
      present: count(profiles, (p) =>
        Boolean(p.social_handles?.professional_network_identifier?.profile_url)
      ),
    },
    {
      label: "GitHub link",
      present: count(profiles, (p) =>
        Boolean(p.social_handles?.dev_platform_identifier?.profile_url)
      ),
      note: "the link only; repos and languages need Dev Platform Enrich",
    },
    {
      label: "Normalized title",
      present: count(profiles, (p) =>
        Boolean(p.basic_profile?.normalized_title?.department)
      ),
    },
    {
      label: "Refresh date",
      present: count(profiles, (p) => Boolean(p.metadata?.updated_at)),
    },
    {
      label: "Business email flag",
      present: count(profiles, (p) => p.contact?.has_business_email !== undefined),
      note: "entitlement-gated, so zero may mean the account cannot see it",
    },
  ];

  return { total, rows, medianAgeMonths };
}
