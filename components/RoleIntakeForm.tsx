"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import CandidateList, { type SearchOutcome } from "@/components/CandidateList";
import Combobox from "@/components/Combobox";
import TitleCombobox from "@/components/TitleCombobox";
import {
  ALL_CONTINENTS,
  DEFAULT_FETCH_LIMIT,
  FIELD_CATALOG,
  buildCrustdataQuery,
  continentsForWindow,
  effectiveTitles,
} from "@/lib/crustdata";
import type {
  Criterion,
  CriterionKind,
  EmploymentType,
  GateMode,
  LocationMode,
  RoleBrief,
  SkillMatch,
  SuggestResult,
  TitleVariant,
} from "@/lib/types";

const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
];

/**
 * Preset cities, qualified with their country. The country is what stops
 * "London" resolving to London, Ontario when Crustdata geocodes the string.
 */
const CITY_PRESETS = ["Berlin, Germany", "London, United Kingdom"];

const TZ_RANGE = Array.from({ length: 27 }, (_, i) => i - 12);
const tzLabel = (offset: number) =>
  `UTC${offset >= 0 ? "+" : ""}${offset}`;

const FIELD_OPTIONS = Object.entries(FIELD_CATALOG);

let localId = 0;
const makeId = (prefix: string) => `${prefix}-local-${(localId += 1)}`;

export default function RoleIntakeForm() {
  const [title, setTitle] = useState("");
  const [jd, setJd] = useState("");
  const [showJd, setShowJd] = useState(false);

  const [variants, setVariants] = useState<TitleVariant[]>([]);
  const [showSynonyms, setShowSynonyms] = useState(false);
  const [criteria, setCriteria] = useState<Criterion[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [statusNote, setStatusNote] = useState("");
  const [error, setError] = useState("");

  const [locationMode, setLocationMode] = useState<LocationMode>("onsite");
  const [city, setCity] = useState("");
  const [cityTouched, setCityTouched] = useState(false);
  const [radius, setRadius] = useState(50);
  const [radiusUnit, setRadiusUnit] = useState<"km" | "mi">("km");
  const [tzMin, setTzMin] = useState(0);
  const [tzMax, setTzMax] = useState(2);
  const [regions, setRegions] = useState<string[]>(() => continentsForWindow(0, 2));
  const [regionsTouched, setRegionsTouched] = useState(false);

  const [employmentType, setEmploymentType] = useState<EmploymentType>("full_time");
  const [employmentTouched, setEmploymentTouched] = useState(false);
  const [locationTouched, setLocationTouched] = useState(false);
  const [minYears, setMinYears] = useState("");
  const [maxYears, setMaxYears] = useState("");
  const [yearsTouched, setYearsTouched] = useState(false);
  const [gateMode, setGateMode] = useState<GateMode>("any");
  /** Which fields the job ad filled in, so nothing changes silently. */
  const [adFilled, setAdFilled] = useState<string[]>([]);

  const [newVariant, setNewVariant] = useState("");
  const lastRequest = useRef("");

  const [count, setCount] = useState<{
    total: number | null;
    relation: string | null;
    remarks: { message?: string; hint?: string }[];
    breakdown: {
      id: string;
      label: string;
      reach: number | null;
      withoutTotal: number | null;
    }[];
    creditsUsed: number | null;
    /** The query these numbers were measured against. */
    signature: string;
  } | null>(null);
  const [countError, setCountError] = useState("");
  const [counting, setCounting] = useState(false);

  const [fetchLimit, setFetchLimit] = useState(String(DEFAULT_FETCH_LIMIT));
  /** Clamped to Crustdata's per-page maximum, so the projected cost is real. */
  const plannedFetch = Math.min(
    1000,
    Math.max(0, Math.round(Number(fetchLimit) || 0))
  );
  const [searchResult, setSearchResult] = useState<SearchOutcome | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searching, setSearching] = useState(false);

  // Regions follow the timezone window until the operator edits them by hand.
  useEffect(() => {
    if (!regionsTouched) setRegions(continentsForWindow(tzMin, tzMax));
  }, [tzMin, tzMax, regionsTouched]);

  const fetchCities = async (query: string) => {
    const res = await fetch("/api/city-resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const data = (await res.json()) as { locations?: string[] };
    return { values: data.locations ?? [] };
  };

  const runSuggest = useCallback(
    async (force = false) => {
      const trimmed = title.trim();
      const ad = jd.trim();
      // Either input is enough on its own. With only an ad, the model reads
      // the role's title out of it and we fill the field in below.
      if (trimmed.length < 3 && ad.length === 0) return;

      const signature = `${trimmed.toLowerCase()}|${ad}`;
      if (!force && signature === lastRequest.current) return;
      lastRequest.current = signature;

      setStatus("loading");
      setError("");
      try {
        const res = await fetch("/api/suggest", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: trimmed, jd, force }),
        });
        const data = (await res.json()) as SuggestResult & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Suggestion request failed.");

        // Titles the operator added themselves survive a re-suggest.
        setVariants((prev) => [
          ...prev.filter((v) => v.tier === "manual"),
          ...data.titleVariants,
        ]);

        if (trimmed.length === 0 && data.normalizedTitle) {
          // Pin the signature first so the debounced title watcher does not
          // fire a second call for the title we just learned.
          lastRequest.current = `${data.normalizedTitle.trim().toLowerCase()}|${ad}`;
          setTitle(data.normalizedTitle);
        }

        // Anything the ad states about the role itself fills in the form.
        //
        // The test is whether the operator has touched the field, not
        // whether it is empty. A value this step filled in earlier can be
        // corrected by a later read; a value the operator typed is never
        // overwritten. Emptiness alone would leave a wrong value stuck
        // forever, since the fill that put it there also made the field
        // non-empty.
        const filled: string[] = [];
        const setup = data.setup;
        if (setup) {
          if (setup.city && !cityTouched) {
            setCity(setup.city);
            filled.push("location");
          }
          if (setup.remote !== null && !locationTouched) {
            setLocationMode(setup.remote ? "remote" : "onsite");
            filled.push(setup.remote ? "remote" : "on-site");
          }
          if (setup.employmentType && !employmentTouched) {
            setEmploymentType(setup.employmentType);
            filled.push("employment type");
          }
          if (!yearsTouched) {
            // Written even when null, so a number from a previous ad does
            // not survive into a role that never mentions one.
            setMinYears(setup.minYears === null ? "" : String(setup.minYears));
            setMaxYears(setup.maxYears === null ? "" : String(setup.maxYears));
            if (setup.minYears !== null || setup.maxYears !== null) {
              filled.push("experience range");
            }
          }
        }
        setAdFilled(filled);

        // Anything the operator typed themselves survives a re-suggest.
        setCriteria((prev) => [
          ...prev.filter((c) => c.source === "manual"),
          ...data.criteria,
        ]);
        setStatus("ready");
        setStatusNote(data.cached ? "from cache" : "from Sonnet");
      } catch (err) {
        lastRequest.current = "";
        setError(err instanceof Error ? err.message : "Suggestion request failed.");
        setStatus("error");
      }
    },
    [title, jd, cityTouched, yearsTouched, locationTouched, employmentTouched]
  );

  useEffect(() => {
    const timer = setTimeout(() => void runSuggest(false), 700);
    return () => clearTimeout(timer);
    // Intentionally keyed on the title only: the job ad is applied by button,
    // so typing a long ad does not fire a call per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title]);

  const brief: RoleBrief = useMemo(
    () => ({
      title: title.trim(),
      titleVariants: variants,
      locationMode,
      city,
      radius,
      radiusUnit,
      tzMin,
      tzMax,
      regions,
      employmentType,
      minYears: minYears.trim() === "" ? null : Number(minYears),
      maxYears: maxYears.trim() === "" ? null : Number(maxYears),
      gateMode,
      criteria,
    }),
    [
      title, variants, locationMode, city, radius, radiusUnit,
      tzMin, tzMax, regions, employmentType, minYears, maxYears, gateMode,
      criteria,
    ]
  );

  const query = useMemo(() => buildCrustdataQuery(brief), [brief]);
  const querySignature = useMemo(() => JSON.stringify(query), [query]);

  /**
   * Counts are kept when the query changes, and marked stale instead.
   * Clearing them would throw away the only numbers on screen the moment
   * you act on them, which is exactly when they are most useful as a
   * before-and-after.
   */
  const countStale = count !== null && count.signature !== querySignature;

  const countsById = useMemo(() => {
    const map = new Map<
      string,
      { reach: number | null; withoutTotal: number | null }
    >();
    for (const row of count?.breakdown ?? []) {
      map.set(row.id, { reach: row.reach, withoutTotal: row.withoutTotal });
    }
    return map;
  }, [count]);

  const checkCount = async () => {
    setCounting(true);
    setCountError("");
    try {
      const res = await fetch("/api/count", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The count request failed.");
      setCount({ ...data, signature: querySignature });
    } catch (err) {
      setCountError(err instanceof Error ? err.message : "The count request failed.");
    }
    setCounting(false);
  };

  const findCandidates = async () => {
    setSearching(true);
    setSearchError("");
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief, limit: Number(fetchLimit) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "The search failed.");
      setSearchResult(data);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "The search failed.");
    }
    setSearching(false);
  };

  const musts = criteria.filter((c) => c.kind === "must");
  const nices = criteria.filter((c) => c.kind === "nice");
  // Must-haves split by what they actually do. A must-have that no field can
  // evidence still counts against the score, but it narrows nothing, and
  // putting the two in one list hid that.
  const mustFilters = musts.filter((c) => c.check === "filter");
  const mustJudged = musts.filter((c) => c.check === "judge");
  const gateCount = mustFilters.filter((c) => c.selected).length;
  const judgeCount = criteria.filter((c) => c.selected && c.check === "judge").length;

  // Synonyms and hand-added titles sit together: both are the role itself.
  const synonyms = variants.filter((v) => v.tier !== "adjacent");
  const adjacent = variants.filter((v) => v.tier === "adjacent");

  // The titles that survive into the query, so a chip that changes nothing
  // can say so instead of looking active.
  const activeTitles = useMemo(
    () => new Set(effectiveTitles(brief).map((t) => t.toLowerCase())),
    [brief]
  );
  const titlesInQuery = activeTitles.size;

  const toggleVariant = (label: string) =>
    setVariants((prev) =>
      prev.map((v) => (v.label === label ? { ...v, selected: !v.selected } : v))
    );

  const addVariant = (label: string) => {
    const clean = label.trim();
    if (!clean) return;
    setVariants((prev) =>
      prev.some((v) => v.label.toLowerCase() === clean.toLowerCase())
        ? prev
        : [...prev, { label: clean, selected: true, tier: "manual" as const }]
    );
    setNewVariant("");
  };

  const updateCriterion = (id: string, patch: Partial<Criterion>) =>
    setCriteria((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  const removeCriterion = (id: string) =>
    setCriteria((prev) => prev.filter((c) => c.id !== id));

  const addCriterion = (kind: CriterionKind, label: string, field: string, match: string) => {
    const spec = FIELD_CATALOG[field];
    const usable = Boolean(spec) && match.trim().length > 0;
    setCriteria((prev) => [
      ...prev,
      {
        id: makeId(kind),
        label: label.trim(),
        kind,
        check: usable ? "filter" : "judge",
        field: usable ? field : undefined,
        match: usable ? match.trim() : undefined,
        weight: 2,
        source: "manual",
        selected: true,
      },
    ]);
  };

  /**
   * A skill added by hand goes through the same checks as a suggested one:
   * traits are refused, and the index decides whether it can be a filter.
   */
  const addSkill = async (
    kind: CriterionKind,
    label: string
  ): Promise<string | null> => {
    const res = await fetch("/api/skill-resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skill: label }),
    });
    const data = (await res.json()) as { match?: SkillMatch; message?: string };

    if (!data.match) return data.message ?? "That skill could not be added.";

    const usable = data.match.status !== "absent";
    setCriteria((prev) => [
      ...prev,
      {
        id: makeId(kind),
        label: label.trim(),
        kind,
        check: usable ? "filter" : "judge",
        skills: usable ? [data.match] : undefined,
        weight: 2,
        source: "manual",
        selected: true,
      },
    ]);
    return null;
  };

  const downloadBrief = () => {
    const payload = JSON.stringify({ brief, query }, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title.trim() || "role").toLowerCase().replace(/\s+/g, "-")}-brief.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-6">
        {/* Role */}
        <Section title="Role" step={1}>
          <div>
            <p className="mb-1 text-sm font-medium text-neutral-700">Job title</p>
            <TitleCombobox
              value={title}
              onChange={setTitle}
              placeholder="e.g. Full-Stack Engineer"
            />
          </div>

          <div className="mt-2 flex items-center gap-3 text-xs text-neutral-500">
            {status === "loading" && <span>Reading the title…</span>}
            {status === "ready" && <span>Suggestions {statusNote}</span>}
            <button
              type="button"
              onClick={() => setShowJd((v) => !v)}
              className="underline underline-offset-2 hover:text-neutral-900"
            >
              {showJd ? "Hide job ad" : "Paste the job ad (optional)"}
            </button>
          </div>

          {showJd && (
            <div className="mt-3">
              <textarea
                value={jd}
                onChange={(e) => setJd(e.target.value)}
                rows={6}
                placeholder="Paste the full text of the advert. Criteria taken straight from it get tagged 'from ad' instead of 'inferred'. You can paste an ad without typing a title: the title gets read out of it."
                className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
              <button
                type="button"
                onClick={() => void runSuggest(true)}
                disabled={jd.trim().length === 0}
                className="mt-2 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {title.trim()
                  ? "Re-read criteria from the ad"
                  : "Read the role from the ad"}
              </button>
              {adFilled.length > 0 && (
                <p className="mt-2 text-[11px] text-neutral-500">
                  Filled from the ad: {adFilled.join(", ")}. Fields you had
                  already set were left alone.
                </p>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {error}
            </p>
          )}

          {variants.length > 0 && (
            <div className="mt-4 space-y-4">
              {synonyms.length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowSynonyms((v) => !v)}
                    className="text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-900"
                  >
                    {showSynonyms ? "Hide" : "Show"} the {synonyms.length} synonyms
                    searched automatically
                  </button>

                  {showSynonyms && (
                    <div className="mt-2">
                      <p className="mb-2 text-xs text-neutral-500">
                        The same job written differently. Deselect anything that
                        does not belong.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {synonyms.map((v) => {
                          const covered =
                            v.selected && !activeTitles.has(v.label.toLowerCase());
                          return (
                            <span
                              key={v.label}
                              className="inline-flex items-center gap-1"
                            >
                              <button
                                type="button"
                                onClick={() => toggleVariant(v.label)}
                                className={chipClass(v.selected)}
                              >
                                {v.label}
                              </button>
                              {covered && (
                                <span className="text-[10px] text-neutral-400">
                                  already covered
                                </span>
                              )}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {adjacent.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-neutral-700">
                    Widen the search
                  </p>
                  <p className="mb-2 text-xs text-neutral-500">
                    Nearby roles, not the same job. These stay out of the query
                    until you turn one on.
                  </p>
                  <ul className="space-y-1.5">
                    {adjacent.map((v) => (
                      <li key={v.label} className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleVariant(v.label)}
                          className={chipClass(v.selected)}
                        >
                          {v.selected ? v.label : `+ ${v.label}`}
                        </button>
                        {v.note && (
                          <span className="text-[11px] text-neutral-500">
                            {v.note}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  addVariant(newVariant);
                }}
                className="flex gap-2"
              >
                <div className="flex-1">
                  <TitleCombobox
                    value={newVariant}
                    onChange={setNewVariant}
                    onSelect={addVariant}
                    placeholder="Add a title"
                    className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
                >
                  Add
                </button>
              </form>
            </div>
          )}
        </Section>

        {/* Where */}
        <Section title="Where and how" step={2}>
          <div className="flex gap-2">
            <Toggle
              active={locationMode === "onsite"}
              onClick={() => {
                setLocationMode("onsite");
                setLocationTouched(true);
              }}
            >
              On-site or hybrid
            </Toggle>
            <Toggle
              active={locationMode === "remote"}
              onClick={() => {
                setLocationMode("remote");
                setLocationTouched(true);
              }}
            >
              Remote
            </Toggle>
          </div>

          {locationMode === "onsite" ? (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <p className="mb-1 text-sm font-medium text-neutral-700">City</p>
                  <div className="w-56">
                    <Combobox
                      value={city}
                      onChange={(v) => {
                        setCity(v);
                        setCityTouched(true);
                      }}
                      fetchOptions={fetchCities}
                      placeholder="e.g. Paris"
                      className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base font-normal outline-none focus:border-neutral-900"
                    />
                  </div>
                </div>
                <label className="text-sm font-medium text-neutral-700">
                  Within
                  <div className="mt-1 flex">
                    <input
                      type="number"
                      min={1}
                      value={radius}
                      onChange={(e) => setRadius(Number(e.target.value) || 1)}
                      className="w-20 rounded-l-lg border border-neutral-300 bg-white px-3 py-2 text-base font-normal outline-none focus:border-neutral-900"
                    />
                    <select
                      value={radiusUnit}
                      onChange={(e) => setRadiusUnit(e.target.value as "km" | "mi")}
                      className="rounded-r-lg border border-l-0 border-neutral-300 bg-white px-2 py-2 text-sm"
                    >
                      <option value="km">km</option>
                      <option value="mi">mi</option>
                    </select>
                  </div>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {CITY_PRESETS.map((preset) => {
                  const on = preset.toLowerCase() === city.trim().toLowerCase();
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setCity(on ? "" : preset);
                        setCityTouched(true);
                      }}
                      className={chipClass(on)}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm font-medium text-neutral-700">
                  Must overlap from
                  <select
                    value={tzMin}
                    onChange={(e) => setTzMin(Number(e.target.value))}
                    className="mt-1 block rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                  >
                    {TZ_RANGE.map((o) => (
                      <option key={o} value={o}>
                        {tzLabel(o)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-neutral-700">
                  to
                  <select
                    value={tzMax}
                    onChange={(e) => setTzMax(Number(e.target.value))}
                    className="mt-1 block rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
                  >
                    {TZ_RANGE.map((o) => (
                      <option key={o} value={o}>
                        {tzLabel(o)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <p className="text-sm font-medium text-neutral-700">Regions searched</p>
                <p className="mb-2 text-xs text-neutral-500">
                  Crustdata has no timezone field, so the window above is converted
                  into continents for the query and re-checked against the
                  candidate&apos;s stated location at scoring time.
                </p>
                <div className="flex flex-wrap gap-2">
                  {ALL_CONTINENTS.map((region) => {
                    const on = regions.includes(region);
                    return (
                      <button
                        key={region}
                        type="button"
                        onClick={() => {
                          setRegionsTouched(true);
                          setRegions((prev) =>
                            on ? prev.filter((r) => r !== region) : [...prev, region]
                          );
                        }}
                        className={chipClass(on)}
                      >
                        {region}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          <div className="mt-4">
            <label className="text-sm font-medium text-neutral-700">
              Employment type
              <select
                value={employmentType}
                onChange={(e) => {
                  setEmploymentType(e.target.value as EmploymentType);
                  setEmploymentTouched(true);
                }}
                className="mt-1 block rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
              >
                {EMPLOYMENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </Section>

        {/* Criteria */}
        <Section title="Must-haves, filtering and scoring" step={3}>
          <div className="mb-4 border-b border-neutral-100 pb-4">
            <p className="text-sm font-medium text-neutral-700">
              Years of experience
            </p>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={0}
                value={minYears}
                onChange={(e) => {
                  setMinYears(e.target.value);
                  setYearsTouched(true);
                }}
                placeholder="min"
                className="w-20 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base font-normal outline-none focus:border-neutral-900"
              />
              <span className="text-neutral-400">to</span>
              <input
                type="number"
                min={0}
                value={maxYears}
                onChange={(e) => {
                  setMaxYears(e.target.value);
                  setYearsTouched(true);
                }}
                placeholder="max"
                className="w-20 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base font-normal outline-none focus:border-neutral-900"
              />
              <span className="text-[11px] text-neutral-500">
                applied to everyone, unlike the criteria below
              </span>
            </div>
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-neutral-500">A candidate needs</span>
            <button
              type="button"
              onClick={() => setGateMode("any")}
              className={chipClass(gateMode === "any")}
            >
              any one of these
            </button>
            <button
              type="button"
              onClick={() => setGateMode("all")}
              className={chipClass(gateMode === "all")}
            >
              all of these
            </button>
          </div>

          <p className="mb-3 text-xs text-neutral-500">
            {gateMode === "any"
              ? "These narrow the search, but nobody is dropped for missing one. Every miss is reported on their card instead."
              : "Every one of these is required. A much smaller and more exact pool, at the cost of losing people who simply never listed one of them, with no card and no chance to judge."}
          </p>
          <CriterionList
            items={mustFilters}
            counts={countsById}
            countsStale={countStale}
            gateMode={gateMode}
            total={count?.total ?? null}
            emptyLabel="Nothing here yet. Without one of these the search is scoped only by title, location and experience."
            onUpdate={updateCriterion}
            onRemove={removeCriterion}
          />
          <AddCriterion kind="must" onAdd={addCriterion} onAddSkill={addSkill} />
        </Section>

        <Section title="Must-haves, scoring only" step={4}>
          <p className="mb-3 text-xs text-neutral-500">
            Requirements no field in the data can evidence. They narrow
            nothing, so they never cost you a candidate at search time. Each
            one is read off the profile during scoring and has to be backed by
            an evidence link.
          </p>
          <CriterionList
            items={mustJudged}
            emptyLabel="Nothing yet."
            onUpdate={updateCriterion}
            onRemove={removeCriterion}
          />
          <AddCriterion
            kind="must"
            judgedOnly
            onAdd={addCriterion}
            onAddSkill={addSkill}
          />
        </Section>

        <Section title="Nice-to-haves, scoring only" step={5}>
          <p className="mb-3 text-xs text-neutral-500">
            These never filter anyone out, whether or not the data could
            support it. They only move the score.
          </p>
          <CriterionList
            items={nices}
            emptyLabel="Nothing yet."
            onUpdate={updateCriterion}
            onRemove={removeCriterion}
          />
          <AddCriterion kind="nice" onAdd={addCriterion} onAddSkill={addSkill} />
        </Section>
      </div>

      {/* Preview */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-neutral-900">Search query</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Exactly what gets posted to Crustdata. Nothing is sent yet.
          </p>

          <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Stat label="Titles" value={String(titlesInQuery)} />
            <Stat label="Must gates" value={String(gateCount)} />
            <Stat label="Judged" value={String(judgeCount)} />
          </dl>

          <pre className="mt-3 max-h-[420px] overflow-auto rounded-lg bg-neutral-950 p-3 text-[11px] leading-relaxed text-neutral-100">
            {JSON.stringify(query, null, 2)}
          </pre>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void navigator.clipboard.writeText(JSON.stringify(query, null, 2))}
              className="flex-1 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
            >
              Copy query
            </button>
            <button
              type="button"
              onClick={downloadBrief}
              disabled={!title.trim()}
              className="flex-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Save brief
            </button>
          </div>

          <button
            type="button"
            onClick={() => void checkCount()}
            disabled={counting || !title.trim()}
            className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 disabled:opacity-40"
          >
            {counting ? "Counting" : "How many people match?"}
          </button>
          {count && (
            <div
              className={`mt-2 rounded-lg px-3 py-2 ${
                countStale ? "bg-neutral-50 text-neutral-400" : "bg-neutral-100"
              }`}
            >
              {count.total === null ? (
                <p className="text-xs text-neutral-600">
                  Crustdata did not return a total for this query, which it
                  does when the pool is too broad to count exactly. Narrow it
                  and try again.
                </p>
              ) : count.total === 0 ? (
                <>
                  <p className="text-sm font-semibold text-neutral-900">
                    Nobody matches
                  </p>
                  {count.remarks.map((r, i) => (
                    <p key={i} className="mt-1 text-[11px] text-neutral-600">
                      {r.message}
                      {r.hint ? ` ${r.hint}` : ""}
                    </p>
                  ))}
                </>
              ) : (
                <p className="text-sm">
                  <span className="font-semibold">
                    {count.relation === "gte" ? "at least " : ""}
                    {count.total.toLocaleString()}
                  </span>{" "}
                  people match
                </p>
              )}
              {countStale && (
                <p className="mt-1 text-[11px]">
                  Measured before your last edit. Count again to refresh.
                </p>
              )}
              {count.creditsUsed !== null && (
                <p className="mt-1 text-[10px] text-neutral-500">
                  {count.creditsUsed} credits used
                </p>
              )}
            </div>
          )}

          {countError && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              {countError}
            </p>
          )}

          <div className="mt-4 border-t border-neutral-200 pt-3">
            <div className="flex items-end gap-2">
              <label className="text-[11px] text-neutral-500">
                Fetch
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={fetchLimit}
                  onChange={(e) => setFetchLimit(e.target.value)}
                  className="mt-1 block w-20 rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-neutral-900"
                />
              </label>
              <button
                type="button"
                onClick={() => void findCandidates()}
                disabled={searching || !title.trim()}
                className="flex-1 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {searching ? "Fetching" : "Find candidates"}
              </button>
            </div>
            <p className="mt-1 text-[10px] text-neutral-500">
              {plannedFetch > 0 ? (
                <>
                  {plannedFetch.toLocaleString()} profiles at 0.03 credits ={" "}
                  <span className={plannedFetch > 200 ? "font-semibold" : ""}>
                    {(plannedFetch * 0.03).toFixed(2)} credits
                  </span>
                  {count?.total !== null &&
                    count?.total !== undefined &&
                    !countStale &&
                    plannedFetch > count.total && (
                      <> · only {count.total.toLocaleString()} match, so you pay for those</>
                    )}
                  . Saved to disk so scoring can be rerun without paying again.
                </>
              ) : (
                <>Enter how many profiles to buy. Maximum 1000 per fetch.</>
              )}
            </p>
          </div>

          {searchError && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              {searchError}
            </p>
          )}

          {gateCount === 0 && criteria.length > 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              No must-have can be used as a search filter, so the query is only
              scoped by title, location and experience. That will return a wide
              pool and push all of the work onto scoring.
            </p>
          )}
        </div>
      </aside>
      </div>

      {searchResult && <CandidateList result={searchResult} />}
    </div>
  );
}

function Section({
  title,
  step,
  children,
}: {
  title: string;
  step: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-900">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-medium text-white">
          {step}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg px-3 py-1.5 text-sm ${
        active
          ? "bg-neutral-900 text-white"
          : "border border-neutral-300 text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {children}
    </button>
  );
}

function chipClass(active: boolean) {
  return `rounded-full px-3 py-1 text-sm transition ${
    active
      ? "bg-neutral-900 text-white"
      : "border border-neutral-300 text-neutral-500 hover:border-neutral-400"
  }`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-neutral-100 px-2 py-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</dt>
      <dd className="text-sm font-semibold text-neutral-900">{value}</dd>
    </div>
  );
}

function CriterionList({
  items,
  emptyLabel,
  onUpdate,
  onRemove,
  counts,
  countsStale = false,
  gateMode = "any",
  total,
}: {
  items: Criterion[];
  emptyLabel: string;
  onUpdate: (id: string, patch: Partial<Criterion>) => void;
  onRemove: (id: string) => void;
  counts?: Map<string, { reach: number | null; withoutTotal: number | null }>;
  countsStale?: boolean;
  gateMode?: GateMode;
  total?: number | null;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-neutral-400">{emptyLabel}</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <li
          key={c.id}
          className={`rounded-lg border px-3 py-2 ${
            c.selected ? "border-neutral-200 bg-white" : "border-neutral-100 bg-neutral-50"
          }`}
        >
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={c.selected}
              onChange={() => onUpdate(c.id, { selected: !c.selected })}
              className="mt-1 h-4 w-4 accent-neutral-900"
            />
            <div className="min-w-0 flex-1">
              <p
                className={`text-sm ${
                  c.selected ? "text-neutral-900" : "text-neutral-400 line-through"
                }`}
              >
                {c.label}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <Badge tone={c.source === "jd" ? "green" : "grey"}>
                  {c.source === "jd"
                    ? "from ad"
                    : c.source === "manual"
                      ? "yours"
                      : "inferred"}
                </Badge>
                {c.skills?.map((s) => (
                  <span
                    key={s.label}
                    title={
                      s.status === "confirmed"
                        ? s.indexed.join("\n")
                        : "not checked against the index"
                    }
                    className="cursor-help rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] text-neutral-600"
                  >
                    {s.label}
                    {s.indexed.length > 1 ? ` +${s.indexed.length - 1}` : ""}
                  </span>
                ))}
                {c.backgrounds && c.backgrounds.length > 0 && (
                  <span className="text-[10px] text-neutral-500">
                    any of: {c.backgrounds.join(", ")}
                  </span>
                )}
                {c.field && (
                  <span className="truncate font-mono text-[10px] text-neutral-400">
                    {c.field.split(".").slice(-2).join(".")} ~ {c.match}
                  </span>
                )}
              </div>
              {c.why && <p className="mt-1 text-[11px] text-neutral-500">{c.why}</p>}
              {counts?.has(c.id) && <CriterionCount
                reach={counts.get(c.id)?.reach ?? null}
                withoutTotal={counts.get(c.id)?.withoutTotal ?? null}
                total={total ?? null}
                gateMode={gateMode}
                stale={countsStale}
              />}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title="Weight"
                onClick={() => onUpdate(c.id, { weight: (c.weight % 3) + 1 })}
                className="rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100"
              >
                {"★".repeat(c.weight)}
              </button>
              <button
                type="button"
                title={c.kind === "must" ? "Move to nice-to-have" : "Move to must-have"}
                onClick={() => onUpdate(c.id, { kind: c.kind === "must" ? "nice" : "must" })}
                className="rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-600 hover:bg-neutral-100"
              >
                {c.kind === "must" ? "↓" : "↑"}
              </button>
              <button
                type="button"
                title="Remove"
                onClick={() => onRemove(c.id)}
                className="rounded border border-neutral-200 px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-100"
              >
                ✕
              </button>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * The two numbers that decide whether a criterion earns its place.
 *
 * "reaches" is the criterion alone, which exposes one that matches nobody
 * or nearly everybody.
 *
 * The second number depends on the gate. Under `any` it is what the
 * criterion adds beyond the others, which exposes one that overlaps
 * another entirely and takes up a slot for free. Under `all` it is what
 * the criterion costs, since every requirement only ever removes people,
 * and that is the number worth seeing before deciding it is truly
 * mandatory.
 */
function CriterionCount({
  reach,
  withoutTotal,
  total,
  gateMode,
  stale,
}: {
  reach: number | null;
  withoutTotal: number | null;
  total: number | null;
  gateMode: GateMode;
  stale: boolean;
}) {
  const delta =
    total !== null && withoutTotal !== null ? total - withoutTotal : null;

  const adds = gateMode === "any" && delta !== null ? Math.max(0, delta) : null;
  const costs = gateMode === "all" && delta !== null ? Math.max(0, -delta) : null;

  const dead = reach === 0 || (gateMode === "any" && adds === 0);
  const tone = stale
    ? "text-neutral-400"
    : dead
      ? "text-amber-700"
      : "text-neutral-600";

  return (
    <p className={`mt-1 text-[11px] ${tone}`}>
      reaches {reach === null ? "?" : reach.toLocaleString()}
      {gateMode === "any"
        ? `, adds ${adds === null ? "?" : adds.toLocaleString()}`
        : `, costs ${costs === null ? "?" : costs.toLocaleString()}`}
      {stale && " (before your last edit)"}
      {!stale && reach === 0 && " \u2014 matches nobody"}
      {!stale && reach !== 0 && gateMode === "any" && adds === 0 &&
        " \u2014 every one of these is already covered"}
    </p>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "green" | "blue" | "grey";
  children: ReactNode;
}) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700",
    blue: "bg-sky-50 text-sky-700",
    grey: "bg-neutral-100 text-neutral-500",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ${tones[tone]}`}>{children}</span>
  );
}

async function fetchSkillOptions(query: string) {
  const res = await fetch("/api/skill-resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const data = (await res.json()) as { values?: string[] };
  return {
    values: data.values ?? [],
    footer: "skills present in the Crustdata index",
  };
}

function AddCriterion({
  kind,
  onAdd,
  onAddSkill,
  judgedOnly = false,
}: {
  kind: CriterionKind;
  onAdd: (kind: CriterionKind, label: string, field: string, match: string) => void;
  onAddSkill: (kind: CriterionKind, label: string) => Promise<string | null>;
  /** Hide the filter paths: this section only holds judged criteria. */
  judgedOnly?: boolean;
}) {
  const [mode, setMode] = useState<"skill" | "other">(judgedOnly ? "other" : "skill");
  const [label, setLabel] = useState("");
  const [field, setField] = useState("");
  const [match, setMatch] = useState("");
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!label.trim() || busy) return;
    setProblem("");

    if (mode === "skill") {
      setBusy(true);
      const rejected = await onAddSkill(kind, label);
      setBusy(false);
      if (rejected) {
        setProblem(rejected);
        return;
      }
    } else {
      onAdd(kind, label, field, match);
    }

    setLabel("");
    setField("");
    setMatch("");
  };

  return (
    <div className="mt-3 space-y-2">
      {!judgedOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("skill")}
            className={chipClass(mode === "skill")}
          >
            skill
          </button>
          <button
            type="button"
            onClick={() => setMode("other")}
            className={chipClass(mode === "other")}
          >
            something else
          </button>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-wrap gap-2"
      >
        {mode === "skill" ? (
          <div className="min-w-[180px] flex-1">
            <Combobox
              value={label}
              onChange={setLabel}
              fetchOptions={fetchSkillOptions}
              placeholder="e.g. Rust, Kubernetes, distributed systems"
              className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
            />
          </div>
        ) : (
          <>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={
                judgedOnly
                  ? "Add something to judge on the profile"
                  : kind === "must"
                    ? "Add a must-have"
                    : "Add a nice-to-have"
              }
              className="min-w-[180px] flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
            />
            {!judgedOnly && (
              <select
                value={field}
                onChange={(e) => setField(e.target.value)}
                title="Make this a search filter instead of something judged on the profile"
                className="rounded-lg border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-600"
              >
                <option value="">judged on profile</option>
                {FIELD_OPTIONS.map(([path, spec]) => (
                  <option key={path} value={path}>
                    {path.split(".").slice(-2).join(".")} ({spec.note.slice(0, 32)})
                  </option>
                ))}
              </select>
            )}
            {!judgedOnly && field && (
              <input
                value={match}
                onChange={(e) => setMatch(e.target.value)}
                placeholder={
                  FIELD_CATALOG[field]?.numeric ? "number" : "value, | means or"
                }
                className="w-40 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-neutral-900"
              />
            )}
          </>
        )}
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 disabled:opacity-40"
        >
          {busy ? "Checking" : "Add"}
        </button>
      </form>

      {problem && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {problem}
        </p>
      )}
    </div>
  );
}
