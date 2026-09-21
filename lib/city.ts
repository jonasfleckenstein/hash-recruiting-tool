import { AUTOCOMPLETE_FIELD, crustdataAutocomplete } from "./crustdata-autocomplete";

/**
 * Locations as the index holds them, already carrying their country:
 * "Paris, Ile-de-France, France" rather than a bare "Paris".
 *
 * One lookup, ranked by how many people are in each place, so the most
 * likely one is first and picking it is the whole interaction. That is why
 * this uses full_location rather than the city field: a bare city would need
 * a second call to find out which country it is in.
 *
 * Free, no credits.
 */
export async function suggestLocations(query: string, limit = 8): Promise<string[]> {
  return (await crustdataAutocomplete(AUTOCOMPLETE_FIELD.location, query, { limit })) ?? [];
}
