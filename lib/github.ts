import fs from "node:fs/promises";
import path from "node:path";
import type { StoredEnrichment } from "./enrich";

const GRAPHQL_ENDPOINT = "https://api.github.com/graphql";
const DATA_DIR = path.join(process.cwd(), ".data", "github");

/**
 * Every temporal assumption in this module, in one place.
 *
 * Scattered through the file these were easy to miss and easy to make
 * disagree: an earlier version counted merges over all time against
 * opens over three years and read the difference as signal.
 *
 * All windows roll from the moment of the call rather than snapping to
 * calendar boundaries, so two people fetched a week apart are measured
 * over slightly different periods. Fine for ranking inside one run, not
 * safe for comparing a saved shortlist against a later one.
 */
export const WINDOWS = {
  /** One-year contribution windows to fetch. The API caps a single
   *  contributionsCollection at a year, so this is a loop count. */
  contributionYears: 3,
  /** Months counted for activeMonths24. Matches contributionYears so no
   *  fetched calendar data is discarded. */
  activityMonths: 36,
  /** Merged PRs newer than this are notable or trivial; older ones are
   *  dated, and kept only if the repository is prominent. */
  prRecencyYears: 3,
  /** Cached evidence older than this is refetched. */
  cacheDays: 7,
} as const;

const YEARS_BACK = WINDOWS.contributionYears;
const CACHE_MAX_AGE_DAYS = WINDOWS.cacheDays;
const PR_RECENCY_YEARS = WINDOWS.prRecencyYears;

/** People per GraphQL request.
 *
 * Two, not four. Each person carries three full contribution calendars
 * (~366 day nodes each) on top of 100 pull requests and 50 repositories,
 * and at four the endpoint started returning 502 HTML pages rather than
 * GraphQL errors. The node ceiling was never the binding constraint; the
 * server-side time budget was. */
const BATCH_SIZE = 2;

/**
 * Below this, a merged pull request is not evidence of engineering.
 *
 * Measured against the first live cohort, where the top "contributions"
 * included adding one's own name to an awesome-list, a one-word typo fix,
 * and a favicon. All are single-file, sub-ten-line diffs. Filtering on
 * diff size removes them deterministically, which beats asking a model:
 * same answer, no tokens, reproducible across runs.
 */
const MIN_CHANGED_FILES = 2;
const MIN_DIFF_LINES = 10;

/**
 * Star count above which a small diff still counts.
 *
 * Size alone gets this wrong in one direction. A three-line change merged
 * into facebook/lexical passed review by maintainers of a project with
 * twenty-four thousand stars; a three-line change to a tutorial repo did
 * not. What a small PR proves is not the work but the access, and access
 * to a prominent codebase is the thing worth knowing.
 */
const PROMINENT_REPO_STARS = 1000;

/** Merged work older than the recency window is kept only when the
 *  repository clears this bar. See legacyPrs. */
const MAX_PRS_PER_REPO = 2;

/** How many of the person's own repositories to keep, best first. */
const TOP_REPOS = 8;

/**
 * Why this module exists.
 *
 * Crustdata's dev platform block is all first-party: repos the person owns,
 * stars other people gave them, a bio they wrote. None of it shows work
 * somebody else reviewed and accepted, which is the only thing on GitHub
 * that cannot be self-granted.
 *
 * Everything here runs on the GraphQL endpoint, which bills against a
 * 5,000-point hourly pool. The REST search endpoint this used to depend on
 * is a separate 30-requests-per-minute bucket, and a nine-person cohort
 * came within eight calls of exhausting it. Reading merged pull requests
 * off the user object instead removes that ceiling entirely, and returns
 * diff sizes that search never exposed.
 */

export interface ExternalRepo {
  nameWithOwner: string;
  url: string;
  prs: number;
  commits: number;
  stars: number;
  language: string | null;
  /**
   * employer    - the repo belongs to an org matching a company in the
   *               person's employment history. Public professional work:
   *               recent, real, merged by colleagues. Arguably the strongest
   *               evidence here, but it is not open-source contribution and
   *               the card should not imply it is.
   * third_party - somebody else's project entirely.
   */
  relation: "employer" | "third_party";
}

/**
 * One repository the person owns, ranked by stars rather than recency.
 *
 * All-time on purpose. Someone can have stopped contributing three years
 * ago and still have built the most interesting artifact in the pool: one
 * live profile shows 153 private contributions, no merged pull requests
 * and a React component library with 1,174 stars that the recency-scoped
 * fields rendered completely invisible.
 *
 * Whether old work counts is a property of the ROLE, not of the
 * collector. RoleBrief already carries `penaliseStale` for exactly this
 * judgement, so the collector's job is to surface the artifact and let
 * the scorer decide what it is worth.
 */
export interface OwnedRepo {
  nameWithOwner: string;
  url: string;
  description: string | null;
  stars: number;
  language: string | null;
  createdAt: string | null;
  pushedAt: string | null;
}

/** An organisation whose repositories this person contributes to.
 *
 * Grouped because the pattern is more informative than any single repo.
 * One live profile had 28 commits and 5 pull requests spread across six
 * `overleaf/*` repositories while Crustdata listed exactly one job for
 * her, at a different company. Sustained work across several repos of one
 * org is probable employment, and it can surface history the professional
 * profile simply does not contain. */
export interface ExternalOrg {
  owner: string;
  repos: number;
  prs: number;
  commits: number;
  topStars: number;
  relation: "employer" | "third_party";
}

export interface MergedPr {
  title: string;
  url: string;
  repo: string;
  repoStars: number;
  /** Why this survived the filter: a diff big enough to be work, or a
   *  repository prominent enough that being let in is the signal. */
  keptFor: "diff" | "prominence";
  mergedAt: string | null;
  changedFiles: number;
  additions: number;
  deletions: number;
  /** Review comments on the PR. A long thread is collaboration evidence. */
  discussion: number;
  relation: "employer" | "third_party";
}

export interface GithubEvidence {
  /**
   * ok        - the account was read
   * not_found - the handle does not resolve. A rename or a deleted account,
   *             so a data problem rather than a statement about the person.
   * error     - the call failed. Retryable, and distinct from an empty
   *             profile, which is a real finding.
   */
  status: "ok" | "not_found" | "error";
  login: string;
  /** Handles get renamed; the numeric id does not. */
  userId: number | null;
  profileUrl: string;
  displayName: string | null;
  accountCreatedAt: string | null;

  /**
   * Pull requests OPENED against repositories the person does not own.
   *
   * Opened, not merged. These two diverge and the difference matters:
   * one live profile had two opened against shadcn-ui/ui (124k stars)
   * and korotovsky/slack-mcp-server, and neither was merged. A rejected
   * pull request to a famous repository is ambition, not evidence, and
   * an earlier version of this type called this field `externalPrs`
   * sitting next to a merged-PR list, which invited exactly that
   * misreading.
   */
  externalPrsOpened: number;
  /**
   * Merged into a repo they do not own, WITHIN the recency window.
   *
   * Deliberately aligned to the same three years as externalPrsOpened.
   * An earlier version counted merges over all time against opens over
   * three years, which produced people with 0 opened and 58 merged and
   * no way to tell that the two numbers were measuring different
   * periods.
   */
  externalPrsMergedRecent: number;
  /** Every merged PR on the account, GitHub's own total. Context only:
   *  it includes the person's own repositories. */
  mergedPrsAllTime: number;
  /**
   * True when the account has more merged pull requests than one page
   * can carry, so everything derived from that list is a sample of the
   * most recent 100 rather than the whole history. Prolific contributors
   * are exactly the people this happens to, so it has to be visible.
   */
  prWindowTruncated: boolean;
  /**
   * GitHub's "Available for hire" checkbox, read live.
   *
   * Not scored. It is a toggle people tick once and forget, so it is a
   * claim about intent rather than evidence of anything, and letting it
   * move a ranking would put a stale checkbox above real work. Kept
   * because it is free to read and occasionally worth knowing before
   * writing to someone.
   *
   * null means the account does not set it, which is not the same as
   * "not looking".
   */
  isHireable: boolean | null;
  /** The one-line self-description on their GitHub profile. Short, and
   *  often more current than a professional summary written years ago. */
  bio: string | null;
  reviewsGiven: number;
  externalCommits: number;
  issuesOpened: number;

  /**
   * Contributions to private repositories, count only.
   *
   * The rescue signal, and on live data the densest one: eight of nine in
   * the first cohort had some, one of them nearly ten thousand against a
   * public profile that had looked dormant since 2023. An empty public
   * account usually means employed, not inactive.
   */
  privateContributions: number;

  /** Months with at least one contribution, public or private, across the
   *  activity window. Consistency rather than volume, and unlike public
   *  push recency it does not just measure who has side-project time. */
  activeMonths: number;

  lastPushAt: string | null;
  lastPushRepo: string | null;

  /** Their own public repositories, most-starred first, no date filter.
   *  See OwnedRepo. */
  topRepos: OwnedRepo[];

  externalRepos: ExternalRepo[];
  /** externalRepos rolled up by owner. See ExternalOrg. */
  externalOrgs: ExternalOrg[];
  /** Survivors of the diff-size, prominence and recency filters. Capped
   *  per repository so one busy codebase cannot crowd out the rest. */
  notablePrs: MergedPr[];
  /** Merged inside the window but too small to be evidence. */
  trivialPrs: number;
  /** Merged outside the recency window, whatever their size. Checked
   *  before size, so the three buckets partition cleanly rather than
   *  depending on the order of the tests. */
  datedPrs: number;
  /**
   * Merged outside the recency window but into a prominent repository.
   *
   * The detail is kept rather than reduced to a count, because a merged
   * pull request into a well-known project does not stop being evidence
   * of what someone can do just because it happened four years ago. It
   * is separated from notablePrs so a scorer can weight it down and an
   * outreach draft can avoid opening with it.
   */
  legacyPrs: MergedPr[];

  /** Declared elsewhere-accounts: X, Bluesky, personal site. Not scored,
   *  used by the outreach step. */
  socialAccounts: { provider: string; url: string }[];

  fetchedAt: string;
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Handles                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Pull the login out of a profile URL.
 *
 * The API keys on the login, never a display name and never the URL.
 * Name lookup is not done here on purpose: across one live pool, seven of
 * twenty-one display names disagreed with the professional profile ("Dom
 * Smith" for Dominic Smith) and seven handles were underivable from any
 * name (thelartians, flipswitchingmonkey, teneightfive). A wrong match is
 * worse than no match: it credits one person's work to another and then
 * writes outreach praising it.
 */
export function handleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const cleaned = url.trim().split(/[?#]/)[0].replace(/\/+$/, "");
  const last = cleaned.split("/").pop() ?? "";
  return /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(last)
    ? last
    : null;
}

/**
 * A person to look up, with the context needed to interpret what comes back.
 *
 * `crustdataPersonId` is the join key back to the enrichment record, and
 * the reason no merge step is needed anywhere downstream. The two sources
 * never make competing claims (Crustdata describes employment, education
 * and skills; GitHub describes contributions), so connecting them is a
 * map lookup on this id rather than a reconciliation.
 *
 * It is also the only stable key available. The obvious alternative, the
 * person's name, is a display string that has already been observed
 * arriving mis-encoded, and joining two sources on a field one of them
 * corrupts is a silent-failure waiting to happen.
 */
export interface GithubTarget {
  crustdataPersonId: number | null;
  name: string;
  login: string;
  /** Company names from the employment history, for employer-repo tagging. */
  employers: string[];
  /** GitHub's hireable flag as Crustdata last saw it, carried so the
   *  live read can be checked against the snapshot. */
  crustdataHireable: boolean | null;
  /** LinkedIn URL, carried through so a resolved handle can be verified. */
  linkedinUrl?: string;
  /** X handle from Crustdata, a second verification signal. */
  twitter?: string;
  /** Any URLs found in the profile summary. Thin, but occasionally a
   *  personal site that a GitHub profile also lists. */
  websites: string[];
}

function normaliseCompany(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(gmbh|ltd|limited|inc|llc|ag|bv|sa|plc|group|technologies|labs)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Turn one Crustdata profile into a lookup target.
 *
 * `login` is empty when the profile carries no handle; callers split on
 * that rather than this returning null, because a person with no GitHub
 * still needs counting.
 */
export function buildTarget(person: Record<string, any>): GithubTarget {
  const employment = person.experience?.employment_details ?? {};
  const employers: string[] = [
    ...(employment.current ?? []),
    ...(employment.past ?? []),
  ]
    .map((r: any) => r?.name)
    .filter((n: unknown): n is string => typeof n === "string" && n.length > 1);

  /**
   * The handle lives on the dev platform block, NOT on
   * `social_handles.dev_platform_identifier.profile_url`, which is null
   * on every profile in every enrichment file written so far, including
   * the ones that plainly have GitHub accounts. Reading the obvious
   * path finds nothing and fails silently.
   */
  const login = handleFromUrl(person.dev_platform_profiles?.[0]?.profile_url);

  return {
    crustdataPersonId:
      typeof person.crustdata_person_id === "number"
        ? person.crustdata_person_id
        : null,
    name: person.basic_profile?.name ?? "Unnamed profile",
    login: login ?? "",
    employers: Array.from(new Set(employers)),
    crustdataHireable:
      typeof person.dev_platform_profiles?.[0]?.is_hireable === "boolean"
        ? person.dev_platform_profiles[0].is_hireable
        : null,
    linkedinUrl:
      person.social_handles?.professional_network_identifier?.profile_url ??
      undefined,
    twitter: person.social_handles?.twitter_identifier?.slug || undefined,
    websites: Array.from(
      new Set(
        String(person.basic_profile?.summary ?? "").match(
          /https?:\/\/[^\s),\]]+/g
        ) ?? []
      )
    ),
  };
}

/**
 * Split a set of profiles into those with a handle and those without.
 *
 * Takes profiles rather than an enrichment file. The file's `records`
 * only holds people BOUGHT in that run, so once the person store began
 * reusing enrichments a run where everyone was already known wrote
 * `records: []`, and reading handles from there found nobody. The
 * GitHub step then silently did nothing in exactly the case the store
 * exists to create.
 */
export function splitTargets(profiles: Record<string, any>[]): {
  withHandle: GithubTarget[];
  withoutHandle: GithubTarget[];
} {
  const withHandle: GithubTarget[] = [];
  const withoutHandle: GithubTarget[] = [];
  const seen = new Set<string>();

  for (const profile of profiles) {
    if (!profile) continue;
    const target = buildTarget(profile);
    if (!target.login) {
      withoutHandle.push(target);
      continue;
    }
    if (seen.has(target.login.toLowerCase())) continue;
    seen.add(target.login.toLowerCase());
    withHandle.push(target);
  }

  return { withHandle, withoutHandle };
}

export function targetsFromEnrichment(
  enrichment: StoredEnrichment
): { withHandle: GithubTarget[]; withoutHandle: GithubTarget[] } {
  return splitTargets(
    (enrichment.records ?? []).flatMap((record) =>
      (record.matches ?? [])
        .map((m) => m.person_data as Record<string, any> | undefined)
        .filter((p): p is Record<string, any> => Boolean(p))
    )
  );
}

/* -------------------------------------------------------------------------- */
/* Cache                                                                       */
/* -------------------------------------------------------------------------- */

/** `.data` is gitignored, which matters more here than elsewhere: this
 *  directory holds named individuals' activity histories and the repository
 *  is public. */
function cacheFile(login: string): string {
  return path.join(DATA_DIR, `${login.toLowerCase()}.json`);
}

async function readCache(login: string): Promise<GithubEvidence | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(cacheFile(login), "utf8")
    ) as GithubEvidence;
    const ageDays =
      (Date.now() - Date.parse(parsed.fetchedAt)) / (1000 * 60 * 60 * 24);
    if (!Number.isFinite(ageDays) || ageDays > CACHE_MAX_AGE_DAYS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(evidence: GithubEvidence): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(
      cacheFile(evidence.login),
      JSON.stringify(evidence, null, 2),
      "utf8"
    );
  } catch {
    // Caching is a convenience. Losing it costs a few free calls.
  }
}

/* -------------------------------------------------------------------------- */
/* API                                                                         */
/* -------------------------------------------------------------------------- */

function token(): string {
  const value = process.env.GITHUB_TOKEN;
  if (!value) {
    throw new Error(
      "GITHUB_TOKEN is not set. A classic token with no scopes ticked is enough for public data."
    );
  }
  return value;
}

export interface RateState {
  remaining: number | null;
  cost: number;
}


/**
 * One GraphQL call.
 *
 * Returns data and errors together rather than throwing on errors, which
 * matters once several people share a request: one unresolvable handle
 * makes GitHub return 200 with that alias null and an entry in `errors`,
 * and throwing there would discard three good results to report one bad
 * one.
 */
export async function graphql(
  query: string,
  variables: Record<string, unknown>,
  rate: RateState,
  attempt = 0
): Promise<{ data: any; errors: any[] }> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      "user-agent": "role-to-shortlist",
    },
    body: JSON.stringify({ query, variables }),
  });

  /**
   * Read as text first.
   *
   * A heavy query can time out server-side, and GitHub answers that with
   * an HTML error page, not GraphQL JSON. Calling res.json() straight off
   * turns a clear "502, try a smaller query" into an unreadable parse
   * error about an unexpected '<'.
   */
  const raw = await res.text();
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    // 5xx and secondary-limit pages are transient. One backed-off retry
    // costs a second and usually succeeds.
    if (attempt < 2 && (res.status >= 500 || res.status === 403)) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return graphql(query, variables, rate, attempt + 1);
    }
    throw new Error(
      `GitHub returned ${res.status} as ${res.headers.get("content-type") ?? "unknown"}, ` +
        `not JSON. First bytes: ${raw.slice(0, 160).replace(/\s+/g, " ")}`
    );
  }

  if (typeof body?.data?.rateLimit?.remaining === "number") {
    rate.remaining = body.data.rateLimit.remaining;
  }
  if (typeof body?.data?.rateLimit?.cost === "number") {
    rate.cost += body.data.rateLimit.cost;
  }

  if (!res.ok) {
    throw new Error(
      body?.message
        ? `GitHub GraphQL returned ${res.status}: ${body.message}`
        : `GitHub GraphQL returned ${res.status}.`
    );
  }

  // A bad token or malformed query fails wholesale, with no data at all.
  // That is worth throwing on; a per-alias NOT_FOUND is not.
  if (!body?.data) {
    throw new Error(body?.errors?.[0]?.message ?? "GraphQL returned no data.");
  }

  return { data: body.data, errors: Array.isArray(body.errors) ? body.errors : [] };
}

/**
 * Everything wanted about one person, in one selection set.
 *
 * `pullRequests` replaces a call to the REST search endpoint. It costs
 * GraphQL points instead of the 30-a-minute search budget, and it returns
 * `additions`, `deletions` and `changedFiles`, which search does not. Those
 * three fields are what make the trivial-PR filter possible without a model.
 *
 * `repositoriesContributedTo` with `includeUserRepositories: false` is
 * GitHub's own definition of work outside your own projects, which is
 * preferable to reconstructing it by filtering on repository owner.
 *
 * `socialAccounts` is not scored. It is kept because it is the only place
 * an outreach draft can find someone's X, Bluesky or personal site, and
 * because a candidate who publishes those is easier to reach than one who
 * does not.
 *
 * Organization membership is deliberately absent. It is the one field on
 * the user object that requires a token scope (`read:org`), Crustdata
 * already carries it for every enriched profile, and the only consumer
 * that genuinely needed it was the handle resolver, which no longer
 * exists. Leaving it out keeps the token requirement at zero scopes.
 */
const EVIDENCE_FRAGMENT = `
fragment Evidence on User {
  databaseId
  login
  name
  createdAt
  url
  isHireable
  bio
  socialAccounts(first: 10) { nodes { provider url } }
  repositories(
    first: 1
    isFork: false
    privacy: PUBLIC
    ownerAffiliations: [OWNER]
    orderBy: { field: PUSHED_AT, direction: DESC }
  ) {
    nodes { nameWithOwner pushedAt }
  }
  topRepos: repositories(
    first: 8
    isFork: false
    privacy: PUBLIC
    ownerAffiliations: [OWNER]
    orderBy: { field: STARGAZERS, direction: DESC }
  ) {
    nodes {
      nameWithOwner
      url
      description
      stargazerCount
      createdAt
      pushedAt
      primaryLanguage { name }
    }
  }
  repositoriesContributedTo(
    first: 50
    includeUserRepositories: false
    privacy: PUBLIC
    contributionTypes: [COMMIT, PULL_REQUEST]
  ) {
    totalCount
    nodes { nameWithOwner url stargazerCount owner { login } primaryLanguage { name } }
  }
  pullRequests(states: MERGED, first: 100, orderBy: { field: CREATED_AT, direction: DESC }) {
    totalCount
    nodes {
      title
      url
      mergedAt
      additions
      deletions
      changedFiles
      comments { totalCount }
      reviews { totalCount }
      repository { nameWithOwner stargazerCount owner { login } }
    }
  }
}`;

/** One aliased contribution window. Three of these per person, because the
 *  API caps a contributionsCollection at one year. */
function windowField(alias: string, from: string, to: string): string {
  return `
  ${alias}: contributionsCollection(from: "${from}", to: "${to}") {
    totalCommitContributions
    totalPullRequestReviewContributions
    totalIssueContributions
    restrictedContributionsCount
    contributionCalendar { weeks { contributionDays { date contributionCount } } }
    commitContributionsByRepository(maxRepositories: 50) {
      repository { nameWithOwner url stargazerCount owner { login } primaryLanguage { name } }
      contributions { totalCount }
    }
    pullRequestContributionsByRepository(maxRepositories: 50) {
      repository { nameWithOwner url stargazerCount owner { login } primaryLanguage { name } }
      contributions { totalCount }
    }
  }`;
}

function yearWindows(years: number): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  const now = new Date();
  for (let i = 0; i < years; i += 1) {
    const to = new Date(now);
    to.setUTCFullYear(now.getUTCFullYear() - i);
    const from = new Date(to);
    from.setUTCFullYear(to.getUTCFullYear() - 1);
    from.setUTCDate(from.getUTCDate() + 1);
    out.push({ from: from.toISOString(), to: to.toISOString() });
  }
  return out;
}

/** The last N whole calendar months, as YYYY-MM keys. Bounded
 *  explicitly because contribution windows anchored on today touch one
 *  more calendar month than they span, which produced an activeMonths of
 *  25 out of 24 on the first run. */
function recentMonthKeys(): Set<string> {
  const keys = new Set<string>();
  const cursor = new Date();
  cursor.setUTCDate(1);
  for (let i = 0; i < WINDOWS.activityMonths; i += 1) {
    keys.add(cursor.toISOString().slice(0, 7));
    cursor.setUTCMonth(cursor.getUTCMonth() - 1);
  }
  return keys;
}

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

function emptyEvidence(login: string): GithubEvidence {
  return {
    status: "ok",
    login,
    userId: null,
    profileUrl: `https://github.com/${login}`,
    displayName: null,
    accountCreatedAt: null,
    externalPrsOpened: 0,
    externalPrsMergedRecent: 0,
    mergedPrsAllTime: 0,
    prWindowTruncated: false,
    isHireable: null,
    bio: null,
    reviewsGiven: 0,
    externalCommits: 0,
    issuesOpened: 0,
    privateContributions: 0,
    activeMonths: 0,
    lastPushAt: null,
    lastPushRepo: null,
    topRepos: [],
    externalRepos: [],
    externalOrgs: [],
    notablePrs: [],
    trivialPrs: 0,
    datedPrs: 0,
    legacyPrs: [],
    socialAccounts: [],
    fetchedAt: new Date().toISOString(),
  };
}

function shapeUser(node: any, target: GithubTarget): GithubEvidence {
  const evidence = emptyEvidence(target.login);
  const login = (node.login ?? target.login) as string;
  const owned = login.toLowerCase();

  const employerKeys = new Set(target.employers.map(normaliseCompany).filter(Boolean));
  const relationOf = (owner: string): "employer" | "third_party" => {
    const key = normaliseCompany(owner);
    if (!key) return "third_party";
    for (const e of employerKeys) {
      if (e.length >= 4 && (e.includes(key) || key.includes(e))) return "employer";
    }
    return "third_party";
  };

  evidence.login = login;
  evidence.userId = node.databaseId ?? null;
  evidence.displayName = node.name ?? null;
  evidence.accountCreatedAt = node.createdAt ?? null;
  evidence.isHireable =
    typeof node.isHireable === "boolean" ? node.isHireable : null;
  evidence.bio = typeof node.bio === "string" && node.bio.trim() ? node.bio.trim() : null;
  evidence.profileUrl = node.url ?? evidence.profileUrl;
  evidence.socialAccounts = (node.socialAccounts?.nodes ?? [])
    .filter((s: any) => s?.url)
    .map((s: any) => ({ provider: String(s.provider ?? ""), url: String(s.url) }));

  const freshest = node.repositories?.nodes?.[0];
  evidence.lastPushAt = freshest?.pushedAt ?? null;
  evidence.lastPushRepo = freshest?.nameWithOwner ?? null;

  evidence.topRepos = (node.topRepos?.nodes ?? [])
    .filter((r: any) => r?.nameWithOwner)
    .slice(0, TOP_REPOS)
    .map((r: any) => ({
      nameWithOwner: r.nameWithOwner,
      url: r.url ?? `https://github.com/${r.nameWithOwner}`,
      description: r.description ?? null,
      stars: r.stargazerCount ?? 0,
      language: r.primaryLanguage?.name ?? null,
      createdAt: r.createdAt ?? null,
      pushedAt: r.pushedAt ?? null,
    }));

  // External repos, seeded from GitHub's own contributed-to set and then
  // topped up with per-window counts.
  const repos = new Map<string, ExternalRepo>();
  for (const r of node.repositoriesContributedTo?.nodes ?? []) {
    if (!r?.nameWithOwner) continue;
    const owner = r.owner?.login ?? "";
    repos.set(r.nameWithOwner, {
      nameWithOwner: r.nameWithOwner,
      url: r.url ?? `https://github.com/${r.nameWithOwner}`,
      prs: 0,
      commits: 0,
      stars: r.stargazerCount ?? 0,
      language: r.primaryLanguage?.name ?? null,
      relation: relationOf(owner),
    });
  }

  const monthKeys = recentMonthKeys();
  const activeMonths = new Set<string>();

  for (let i = 0; i < YEARS_BACK; i += 1) {
    const c = node[`y${i}`];
    if (!c) continue;

    evidence.reviewsGiven += c.totalPullRequestReviewContributions ?? 0;
    evidence.issuesOpened += c.totalIssueContributions ?? 0;
    evidence.privateContributions += c.restrictedContributionsCount ?? 0;

    const bump = (entries: any[], field: "prs" | "commits") => {
      for (const entry of entries ?? []) {
        const r = entry?.repository;
        const owner = r?.owner?.login ?? "";
        if (!r?.nameWithOwner) continue;
        if (owner.toLowerCase() === owned) continue;
        const existing =
          repos.get(r.nameWithOwner) ??
          ({
            nameWithOwner: r.nameWithOwner,
            url: r.url ?? `https://github.com/${r.nameWithOwner}`,
            prs: 0,
            commits: 0,
            stars: 0,
            language: null,
            relation: relationOf(owner),
          } as ExternalRepo);
        existing[field] += entry.contributions?.totalCount ?? 0;
        // Whichever path saw this repo first may have seen it bare.
        existing.stars = Math.max(existing.stars, r.stargazerCount ?? 0);
        existing.language = existing.language ?? r.primaryLanguage?.name ?? null;
        repos.set(r.nameWithOwner, existing);
      }
    };
    bump(c.pullRequestContributionsByRepository, "prs");
    bump(c.commitContributionsByRepository, "commits");

    for (const week of c.contributionCalendar?.weeks ?? []) {
      for (const day of week?.contributionDays ?? []) {
        if ((day?.contributionCount ?? 0) > 0 && typeof day.date === "string") {
          const key = day.date.slice(0, 7);
          if (monthKeys.has(key)) activeMonths.add(key);
        }
      }
    }
  }

  evidence.externalRepos = [...repos.values()].sort(
    (a, b) => b.prs + b.commits - (a.prs + a.commits)
  );
  evidence.externalPrsOpened = evidence.externalRepos.reduce((n, r) => n + r.prs, 0);
  evidence.externalCommits = evidence.externalRepos.reduce((n, r) => n + r.commits, 0);
  evidence.activeMonths = activeMonths.size;

  // Roll repositories up by owner.
  const orgs = new Map<string, ExternalOrg>();
  for (const r of evidence.externalRepos) {
    const owner = r.nameWithOwner.split("/")[0];
    const existing =
      orgs.get(owner) ??
      ({ owner, repos: 0, prs: 0, commits: 0, topStars: 0, relation: r.relation } as ExternalOrg);
    existing.repos += 1;
    existing.prs += r.prs;
    existing.commits += r.commits;
    existing.topStars = Math.max(existing.topStars, r.stars);
    if (r.relation === "employer") existing.relation = "employer";
    orgs.set(owner, existing);
  }
  evidence.externalOrgs = [...orgs.values()].sort(
    (a, b) => b.prs + b.commits - (a.prs + a.commits)
  );

  // Merged pull requests, external only. Every one falls into exactly
  // one of three buckets, so the counts reconcile against the total.
  const cutoff = Date.now() - PR_RECENCY_YEARS * 365 * 24 * 60 * 60 * 1000;
  const prNodes = node.pullRequests?.nodes ?? [];
  evidence.mergedPrsAllTime = node.pullRequests?.totalCount ?? prNodes.length;
  evidence.prWindowTruncated = evidence.mergedPrsAllTime > prNodes.length;

  const candidates: MergedPr[] = [];
  const legacy: MergedPr[] = [];

  const shapePr = (pr: any, owner: string, keptFor: "diff" | "prominence"): MergedPr => ({
    title: String(pr.title ?? ""),
    url: String(pr.url),
    repo: pr.repository?.nameWithOwner ?? "",
    repoStars: pr.repository?.stargazerCount ?? 0,
    keptFor,
    mergedAt: pr.mergedAt ?? null,
    changedFiles: pr.changedFiles ?? 0,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    discussion: (pr.comments?.totalCount ?? 0) + (pr.reviews?.totalCount ?? 0),
    relation: relationOf(owner),
  });
  for (const pr of prNodes) {
    const owner = pr?.repository?.owner?.login ?? "";
    if (!pr?.url || !owner || owner.toLowerCase() === owned) continue;

    // Recency first, so age and size do not compete for the same PR.
    if (!pr.mergedAt || Date.parse(pr.mergedAt) < cutoff) {
      evidence.datedPrs += 1;
      /**
       * Old, but not necessarily worthless. Michael Auerswald's four
       * largest n8n contributions (up to 790 added lines across 14
       * files, into a 205k-star repository) fell outside the window by
       * a matter of weeks, and reducing them to a tally threw away the
       * strongest evidence on his profile.
       *
       * Both tests apply here, unlike inside the window. Prominence
       * alone was enough to readmit a one-line link fix to an
       * awesome-list from 2015 and a documentation typo from 2019: the
       * exact noise the size filter exists to remove. Age is not a
       * reason to lower the bar, only a reason to file the result
       * separately.
       */
      if (
        (pr.repository?.stargazerCount ?? 0) >= PROMINENT_REPO_STARS &&
        (pr.changedFiles ?? 0) >= MIN_CHANGED_FILES &&
        (pr.additions ?? 0) + (pr.deletions ?? 0) >= MIN_DIFF_LINES
      ) {
        legacy.push(shapePr(pr, owner, "prominence"));
      }
      continue;
    }
    evidence.externalPrsMergedRecent += 1;

    const bigDiff =
      (pr.changedFiles ?? 0) >= MIN_CHANGED_FILES &&
      (pr.additions ?? 0) + (pr.deletions ?? 0) >= MIN_DIFF_LINES;
    const prominent = (pr.repository?.stargazerCount ?? 0) >= PROMINENT_REPO_STARS;

    if (!bigDiff && !prominent) {
      evidence.trivialPrs += 1;
      continue;
    }

    candidates.push(shapePr(pr, owner, bigDiff ? "diff" : "prominence"));
  }

  /**
   * Pick a representative sample, not the newest ten.
   *
   * Sorting purely by date let one busy codebase take every slot: a live
   * profile returned ten of ten from databricks/appkit, burying merged
   * work in solidjs, vitejs/vite and a 22k-star Rust project. That reads
   * as a single-repo contributor, which is the opposite of true.
   *
   * Third-party work ranks above employer work because it is the harder
   * thing to obtain: anyone can merge into their own company's repo.
   */
  const perRepo = new Map<string, number>();
  evidence.notablePrs = candidates
    .sort((a, b) => {
      if (a.relation !== b.relation) return a.relation === "third_party" ? -1 : 1;
      return String(b.mergedAt).localeCompare(String(a.mergedAt));
    })
    .filter((pr) => {
      const seen = perRepo.get(pr.repo) ?? 0;
      if (seen >= MAX_PRS_PER_REPO) return false;
      perRepo.set(pr.repo, seen + 1);
      return true;
    })
    .slice(0, 10);

  // Best of the old work: most prominent repositories first, since age
  // is already the thing that put them here.
  evidence.legacyPrs = legacy
    .sort((a, b) => b.repoStars - a.repoStars)
    .slice(0, 5);

  evidence.fetchedAt = new Date().toISOString();
  return evidence;
}

/**
 * GitHub evidence tagged with the person it belongs to.
 *
 * The identifiers are stamped on at return time rather than written into
 * the cache file. The file on disk stays a faithful record of what GitHub
 * returned for one account, so it can be reused across searches and
 * audited on its own; who that account belongs to is the caller's
 * knowledge, not GitHub's.
 */
export type IdentifiedEvidence = GithubEvidence & {
  crustdataPersonId: number | null;
  name: string;
};

/** Look up several people in one request. */
async function fetchBatch(
  targets: GithubTarget[],
  rate: RateState
): Promise<IdentifiedEvidence[]> {
  const windows = yearWindows(YEARS_BACK);
  const selections = targets
    .map(
      (t, i) => `
  p${i}: user(login: ${JSON.stringify(t.login)}) {
    ...Evidence
    ${windows.map((w, y) => windowField(`y${y}`, w.from, w.to)).join("\n")}
  }`
    )
    .join("\n");

  const query = `${EVIDENCE_FRAGMENT}
query {
  rateLimit { cost remaining }
  ${selections}
}`;

  const { data } = await graphql(query, {}, rate);

  return targets.map((t, i) => {
    const node = data?.[`p${i}`];
    // A null alias alongside an errors entry means the handle does not
    // resolve. The other aliases in the same response are unaffected.
    const base = node
      ? shapeUser(node, t)
      : { ...emptyEvidence(t.login), status: "not_found" as const };
    return { ...base, crustdataPersonId: t.crustdataPersonId, name: t.name };
  });
}

/**
 * A whole cohort.
 *
 * One request per four people, sequentially. GitHub's secondary limits
 * punish concurrency harder than volume, and there is nothing to gain by
 * racing: a twenty-one person cohort is six requests against a 5,000-point
 * hourly budget.
 */
export async function fetchCohort(
  targets: GithubTarget[],
  force = false
): Promise<{ rate: RateState; evidence: IdentifiedEvidence[] }> {
  const rate: RateState = { remaining: null, cost: 0 };
  const evidence: IdentifiedEvidence[] = [];
  const pending: GithubTarget[] = [];

  for (const target of targets) {
    if (!force) {
      const cached = await readCache(target.login);
      if (cached) {
        evidence.push({
          ...cached,
          crustdataPersonId: target.crustdataPersonId,
          name: target.name,
        });
        continue;
      }
    }
    pending.push(target);
  }

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    if (rate.remaining !== null && rate.remaining < 50) break;
    const batch = pending.slice(i, i + BATCH_SIZE);

    let rows: IdentifiedEvidence[];
    try {
      rows = await fetchBatch(batch, rate);
    } catch (err) {
      /**
       * A batch that fails wholesale is usually one heavy account, not a
       * broken query: someone with a decade of pull requests can push a
       * two-person request past the server's time budget on its own.
       * Retrying one at a time isolates them, so one expensive profile
       * costs its neighbour nothing.
       */
      const failed = (t: GithubTarget, e: unknown): IdentifiedEvidence => ({
        ...emptyEvidence(t.login),
        status: "error" as const,
        error: e instanceof Error ? e.message : "Unknown GitHub error.",
        crustdataPersonId: t.crustdataPersonId,
        name: t.name,
      });

      if (batch.length === 1) {
        rows = [failed(batch[0], err)];
      } else {
        rows = [];
        for (const one of batch) {
          try {
            rows.push(...(await fetchBatch([one], rate)));
          } catch (inner) {
            rows.push(failed(one, inner));
          }
        }
      }
    }

    for (const row of rows) {
      if (row.status === "ok") await writeCache(row);
      evidence.push(row);
    }
  }

  // Restore the caller's ordering, which cache hits above disturbed.
  const order = new Map(targets.map((t, i) => [t.login.toLowerCase(), i]));
  evidence.sort(
    (a, b) =>
      (order.get(a.login.toLowerCase()) ?? 0) - (order.get(b.login.toLowerCase()) ?? 0)
  );

  return { rate, evidence };
}

/* -------------------------------------------------------------------------- */
/* Inspection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Index evidence by the Crustdata person id.
 *
 * The whole of the connection between the two data sources. Downstream
 * code does `byPerson(evidence).get(profile.crustdata_person_id)` and
 * gets either the GitHub record or undefined, where undefined means no
 * handle and therefore unknown, never zero.
 */
export function byPerson(
  evidence: IdentifiedEvidence[]
): Map<number, IdentifiedEvidence> {
  const map = new Map<number, IdentifiedEvidence>();
  for (const row of evidence) {
    if (typeof row.crustdataPersonId === "number") {
      map.set(row.crustdataPersonId, row);
    }
  }
  return map;
}

/**
 * What actually arrived, in the same spirit as the Crustdata coverage
 * panel: find out whether a signal is dense enough to score on before
 * building anything on top of it. On the first cohort this is what
 * demoted peer validation from a scoring axis to a bonus, and promoted
 * private contributions from a footnote to the main liveness measure.
 */
export function summariseGithub(
  evidence: IdentifiedEvidence[]
): { total: number; rows: { label: string; present: number; note?: string }[] } {
  const ok = evidence.filter((e) => e.status === "ok");
  const has = (fn: (e: GithubEvidence) => boolean) => ok.filter(fn).length;

  return {
    total: evidence.length,
    rows: [
      { label: "Account resolved", present: ok.length },
      {
        label: "Merged a PR into a repo they do not own, last 3 years",
        present: has((e) => e.externalPrsMergedRecent > 0),
        note: "merged, not merely opened: the two diverge",
      },
      {
        label: "...substantive and within 3 years",
        present: has((e) => e.notablePrs.length > 0),
        note: "2+ files and 10+ lines, or any size into a 1000-star repo",
      },
      {
        label: "...of which to a third-party project",
        present: has((e) => e.notablePrs.some((p) => p.relation === "third_party")),
        note: "open source rather than public work for an employer",
      },
      {
        label: "Owns a repo with 100+ stars",
        present: has((e) => e.topRepos.some((r) => r.stars >= 100)),
        note: "all-time, so it survives a career gone private",
      },
      {
        label: "Merged into a prominent repo, any date",
        present: has(
          (e) =>
            e.legacyPrs.length > 0 ||
            e.notablePrs.some((p) => p.repoStars >= PROMINENT_REPO_STARS)
        ),
      },
      {
        label: "Reviewed someone else's code",
        present: has((e) => e.reviewsGiven > 0),
      },
      {
        label: "Private contributions recorded",
        present: has((e) => e.privateContributions > 0),
        note: "rescues people whose work sits behind a company firewall",
      },
      {
        label: `Active in 12+ of the last ${WINDOWS.activityMonths} months`,
        present: has((e) => e.activeMonths >= 12),
      },
      {
        label: "Sustained work across one org's repos",
        present: has((e) => e.externalOrgs.some((o) => o.repos >= 3)),
        note: "probable employment, sometimes absent from the CV",
      },
      {
        label: "Declares an X, Bluesky or personal site on GitHub",
        present: has((e) => e.socialAccounts.length > 0),
        note: "a reachable channel for outreach",
      },
    ],
  };
}
