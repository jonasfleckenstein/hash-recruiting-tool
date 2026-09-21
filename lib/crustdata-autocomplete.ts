import { CRUSTDATA_API_VERSION } from "./crustdata";

const ENDPOINT = "https://api.crustdata.com/person/search/autocomplete";

/**
 * Autocomplete targets come from a fixed allowlist on Crustdata's side, so
 * these are the ones we have verified against their reference.
 *
 * `city` is a normalized field, not the raw location string, which is why it
 * returns "London" rather than "Greater London, England, United Kingdom".
 */
export const AUTOCOMPLETE_FIELD = {
  title: "experience.employment_details.current.title",
  /**
   * Full location strings, assembled from the parsed parts, so a value
   * already carries its country: "Paris, Ile-de-France, France". That is one
   * lookup instead of a city lookup followed by a country lookup.
   */
  location: "basic_profile.location.full_location",
  city: "basic_profile.location.city",
  country: "basic_profile.location.country",
  skill: "skills.professional_network_skills",
  employmentType: "employment_type",
} as const;

export interface AutocompleteFilter {
  field: string;
  type: string;
  value: unknown;
}

/**
 * Free (no credits), rate limited at 45 requests per minute, so results are
 * memoised for the life of the dev server.
 */
const cache = new Map<string, string[]>();
const CACHE_LIMIT = 500;

function remember(key: string, values: string[]) {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, values);
}

/**
 * Returns the indexed values for a field, or null when the lookup could not
 * run at all (no API key, network failure, rejected request). Null and an
 * empty array mean different things: null is "we could not ask", [] is "we
 * asked and the index has nothing".
 */
export async function crustdataAutocomplete(
  field: string,
  query: string,
  options: { limit?: number; filters?: AutocompleteFilter } = {}
): Promise<string[] | null> {
  const apiKey = process.env.CRUSTDATA_API_KEY;
  if (!apiKey) return null;

  const body = {
    field,
    query,
    limit: options.limit ?? 10,
    ...(options.filters ? { filters: options.filters } : {}),
  };

  const key = JSON.stringify(body);
  const hit = cache.get(key);
  if (hit) return hit;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        "x-api-version": CRUSTDATA_API_VERSION,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as { suggestions?: { value?: unknown }[] };
    const values = (data.suggestions ?? [])
      .map((s) => s?.value)
      // Blank values come back on fields with many empty records.
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .map((v) => v.trim());

    remember(key, values);
    return values;
  } catch {
    return null;
  }
}
