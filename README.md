# Role to shortlist

A local recruiting tool. It turns a role brief into a searchable query, a set of
scored candidate cards with evidence links, and a personalised outreach draft.

Runs on one machine. No auth, no deployment, no database server.

## Status

- [x] Step 1: role intake. Title with autocomplete over real indexed titles,
      AI-suggested title variants, location or remote timezone window,
      employment type, must-haves and nice-to-haves. Produces the Crustdata
      query and a saveable brief.
- [x] Step 2: candidate search. Fetches a capped page from Crustdata,
      persists the raw profiles to `.data/searches`, and renders candidate
      cards showing which searched titles and backgrounds each person
      actually matched.
- [ ] Step 3: scoring with evidence
- [ ] Step 4: shortlist / hold / reject workflow
- [ ] Step 5: outreach drafts and CSV export

## Setup

```bash
npm install
cp .env.local.example .env.local   # then add your keys
npm run dev
```

Open http://localhost:3000.

### Getting an Anthropic API key

1. Go to https://console.anthropic.com and sign in with the same account you use
   for Claude, or create one.
2. Billing, then add a payment method and buy credits. $5 is plenty: the intake
   suggestions run on Haiku and cost a fraction of a cent per role.
3. Limits, then set a monthly spend limit. Do this before anything else.
4. API keys, then Create key. Copy it once; it is not shown again.
5. Paste it into `.env.local` as `ANTHROPIC_API_KEY=sk-ant-...` and restart
   `npm run dev`.

`.env.local` is gitignored, so the key never reaches GitHub. The key is only
read server-side in `lib/suggest.ts`, so it is never sent to the browser.

The tool degrades rather than breaking without a key: the form still works and
you can type criteria in by hand, you just lose the suggestions.

## How the intake step thinks

**The title input autocompletes against the index, not a dictionary.**
Suggestions come from Crustdata's Person Autocomplete endpoint, which returns
values that actually exist in their person index. It is free, consumes no
credits, and is rate limited at 45 requests per minute, so calls are debounced
to 200ms and memoised per query. Picking a suggestion means the search cannot
come back empty because the index spells the title differently to you. Without
a Crustdata key the input falls back to a short local list in `lib/titles.ts`,
which is a convenience only and is never used to validate anything.

**Titles are matched with the right operator, which is not the obvious one.**
Crustdata's tutorial pages describe `(.)` as a regex where `|` means or. The
reference page says otherwise, and the reference is correct: `(.)` is an
all-words match, every word must appear in any order, and a piped value is
split into words that must ALL match. A regex built for that operator returns
almost nobody. So each title is its own leaf in an `or` group under `(.)`,
which means "Full-Stack Engineer" also finds "Senior Full Stack Engineer" and
"Engineer, Full Stack". The same whole-value rule applies to `=`, `in` and
`not_in`, which quietly match nobody when used on titles.

There is an exact-phrase operator, `[.]`, and the tool deliberately does not
use it. It would fix one narrow problem (word matching on "Product Manager"
also hits "Product Marketing Manager") by making every other search narrower.
Over-matching is visible in the result count and can be filtered; a phrase
search loses people silently. If the over-match problem shows up in practice,
the answer is a targeted exclusion with `(!)`, not a global mode switch.

**Redundant titles are pruned.** Under all-words matching a longer title is a
narrower leaf, never a wider one, so "Full Stack Software Engineer" matches a
subset of "Full Stack Engineer" and adds nothing to an `or` group. The
builder drops any title whose word set is a strict superset of another, and
the UI marks the chip "already covered". Only variants that introduce a new
word (Engineer, Programmer) or a new token spelling (Fullstack, which is one
token and unreachable from "full stack") change the result.

**Synonyms are searched, adjacent titles are offered.** The suggestion model
returns two separate lists. Synonyms are the same job under different wording
("Full Stack Developer" for "Full-Stack Engineer") and go into the query
selected, because making someone tick off spellings one by one is busywork
that only invites a missed variant. Adjacent titles overlap the role without
being it ("Software Engineer", "Backend Engineer") and arrive switched off,
each with a short note on how it differs. Widening a search changes who you
end up contacting, so that stays a deliberate click.

**Empty results explain themselves.** Every query carries `explain: true`. If
a search returns nothing, Crustdata drops one top-level condition at a time
and reports which one removed every result, plus how many profiles match
without it. That turns "no candidates found" into "your seniority filter is
the problem", which is the difference between a tool someone trusts and one
they stop using.

**Fetching is capped, and what it buys is kept.** A search pulls 25
profiles by default. Every result costs 0.03 credits, and more to the
point, every profile fetched is one the scoring model will later read, so
the fetch size is the main cost lever in the tool. The raw response is
written to `.data/searches` before anything is done with it, so the scoring
step can be rewritten as many times as it takes without re-buying the pool.

**The first page is ordered by trust, not by fit.** Crustdata has no
relevance ranking on a filter search, so without a sort the first 25 are
whichever rows the index happens to return. `assessment.authenticity.tier`
runs 0 (most trusted) to 9 and is the only sortable field that says anything
about whether a profile is real, so the fetch sorts on it ascending. That is
an honest second best: it puts verifiable people first rather than relevant
ones. Sorting also makes cursor pagination stable, which Crustdata requires.
The assessment fields are gated on some accounts, so a rejected sort is
retried once without it rather than failing the search.

**A card only claims what search can prove.** Titles and backgrounds are
re-checked locally against the returned job history, using the same
all-words rule the query used, so "title: ML Engineer" on a card means their
current title really does carry those words. Skills cannot be shown at all:
they are filterable but never returned, so a skill match is something the
API asserted and the card says so rather than implying evidence it does not
have. Proving a skill needs Person Enrich, which costs around 1 credit a
profile and therefore belongs on the shortlist, not the pool.

**A requirement can have alternatives.** Job ads routinely state one
requirement with several acceptable answers: "prior AI/ML engineering, data
engineering, applied AI, or product engineering experience". A criterion can
hold all of them, and any one satisfies it. Splitting that into four criteria
would gate the search identically but tell a product engineer they miss
three requirements the ad says they meet, which is a false negative in the
score rather than in the search.

**Skills and backgrounds are different things.** A skill is a technology
someone lists: TypeScript, PostgreSQL. A background is work someone has
done, evidenced by the job titles they have held: data engineering, applied
AI. Someone who spent five years as a Data Engineer may never list "Data
Engineering" among their skills, because their job title already said it. So
backgrounds match `experience.employment_details.title` across every role
held, not just the current one, while skills match the skills array and the
GitHub rollups.

**The ad fills the role setup.** Location, remote or on-site, employment
type and the experience range are read out of the ad when it states them,
and left null when it does not, never guessed. They fill only fields still
empty or untouched, and a line under the ad box names what was filled, so
nothing changes under the operator silently.

**Skills are a taxonomy, not free text.** Crustdata carries skill evidence
in two very different places. Self-declared:
`skills.professional_network_skills`, headline, summary, role descriptions,
certifications. Evidence: the GitHub block, `dev_platform_profiles.*`, which
holds the languages and topics across someone's public repositories. (A trap
worth knowing: `basic_profile.languages` is *spoken* languages.)

A skill here is a named technology or technical specialism that reads as a
noun on a CV: C++, Kubernetes, distributed systems. A trait is not a skill,
and "Communication" is filtered out no matter how hard the job ad pushes it,
because a filter that matches everyone discriminates nobody. So are terms too
broad to narrow anything: "programming", "software development", "Agile".
That rule is enforced twice, in the prompt and again in `lib/skills.ts`,
because the index is no help here: "Communication" is one of the most common
values in it, so validating against Crustdata proves a skill exists, not that
it is worth filtering on.

The suggestion model must label each skill as a language, framework, tool,
platform or domain, and a skill it cannot place in one of those five is
dropped. The label itself is then discarded. It is a gate, not data:
Crustdata has no equivalent split to aim at, so classifying a skill would be
a decision that changes no outcome, and neither the model nor the operator
should be asked to make it.

Every skill is then resolved against the index, and this is the part that
matters most. Autocomplete returns the values the index actually holds for
that skill, ranked by how many people carry each. A model then decides which
of them mean the same skill, using one test: include a value if anyone who
lists it necessarily has the skill. The index proposes, the model disposes,
and the result is intersected back against the candidate list so nothing
invented can ever reach a filter.

That design replaced string matching, which got this wrong in both
directions. An earlier version compared normalized strings and dropped
"Python (Programming Language)" because the punctuation differed. That is
LinkedIn's canonical entity for Python, and it carries roughly a third of
the people who have the skill: a measured search went from 400 matches to
619 once it was included. No stricter or looser string rule fixes this,
because the real distinctions are semantic. "Golang" is Go. "JavaScript" is
not Java. Only a reader can tell the difference.

Exact matches are kept regardless of what the model says, so a failed or
missing Anthropic key degrades to plain matching rather than to nothing.
Resolutions are cached on disk against the candidate list. The card shows
how many spellings a skill resolved to, and hovering lists them.

When the index has never heard of a skill, the criterion becomes a judged
one instead of a filter guaranteed to match nobody.

Each skill then searches three fields at once, OR-ed: the declared skills
array, the GitHub language rollup, and GitHub repository topics. A skill on
a profile is a claim; the same language across someone's repositories is
evidence, and it reaches people who never listed it. Leaves that do not
apply match nobody and cost nothing inside an OR, which is why every skill
gets all three regardless of what kind of thing it is. Headline, summary and
role descriptions are deliberately **not** searched: under all-words
matching, "Go", "R" and "C" are ordinary words and would wreck precision.
Those fields are for the scoring model to read.

**Every must-have is measured on its own.** The count button reports the
whole query and then each gating must-have separately, against the same
title, location and experience filters. This exists because a dud criterion
is otherwise invisible: inside an `or`, one that reaches nobody looks
exactly like one carrying the search, and `explain` will not find it either,
since it probes the top-level `and` one condition at a time and never opens
a nested group. The failure only surfaces when the dud is the last must-have
standing and the search returns nothing.

A real case: a job ad asking for "experience building AI/ML systems"
produced a skill called "AI/ML systems", which resolved to six real indexed
values and reported "6 spellings in the index". It matched zero people.
Nobody writes that phrase on a profile; they write Machine Learning, PyTorch
or TensorFlow. The breakdown shows it as 0 in amber next to the skills that
are working.

**Must-haves gate, they do not eliminate.** A candidate needs to satisfy at
least one must-have to be returned at all, so the filterable must-haves go into
a single `or` group in the query. Every must-have they miss is counted against
their score and shown on their card. This is deliberate: a hard `and` across
four must-haves returns almost nobody, and the people it drops are exactly the
strong-but-unusual candidates worth looking at.

**Nice-to-haves never filter.** They only move the score.

**Every criterion is either a filter or a judgement.** A criterion is marked
`filter` only if it maps to a field in `FIELD_CATALOG` in `lib/crustdata.ts`,
which is a short whitelist read off the Crustdata docs. Those cost nothing and
are exact. Everything else is marked `judged on profile` and is handed to the
scoring model with a requirement to cite evidence. A criterion the suggestion
model invents a field name for is downgraded to a judgement instead of being
sent to the API, so a hallucination costs precision but never breaks a request.

**Suggestions are labelled by origin.** Paste the job ad and criteria taken
straight from it are tagged `from ad`. Anything the model added on its own is
tagged `inferred`. The operator can tell the two apart before committing.

**Cities autocomplete from the index, in one step.** On-site searches use
`geo_distance`, so every way someone writes their location falls inside the
radius. The field type-aheads against `basic_profile.location.full_location`,
whose values already carry their country ("Paris, Ile-de-France, France"),
ranked by how many people are in each. So picking the first option is the
whole interaction: no second question about which country, and no chance of
"London" quietly resolving to London, Ontario. Free, no credits.

The value sent to the API is not that string verbatim. An autocomplete value
is an indexed field value; `geo_distance`'s `location` is a geocoder input,
and every documented example of it is city level ("London", "San Francisco,
CA"). So the middle region segment is dropped and the query sends "Paris,
France". A geocoder that fails to parse a string does not error, it centres
the radius somewhere wrong, so this stays inside the documented shape. The
query preview shows what actually goes out.

**Timezones are honest about what they are.** Crustdata has no timezone field,
so the UTC overlap window is converted to a continent filter for the query and
re-checked against the candidate's stated location during scoring.

## Costs

- Intake suggestions: Sonnet, roughly 2,500 input and 1,000 output tokens
  per role, so a couple of cents.
- Skill resolution: Haiku, one call per distinct technology. Fractions of a
  cent.

Disk caching of both is currently **off**, via `CACHE_ENABLED` in
`lib/anthropic.ts`. A cached answer is keyed by its inputs, not by the
prompt that produced it, so while the prompts are still moving every edit
would need a matching cache version bump and a stale answer would survive
the one you forgot. Turn it back on before a demo: it makes a repeated role
instant and free, and it means a dead network cannot break a run.
- Autocomplete (titles, locations, skills): free, no credits, memoised.
- "How many people match?": 0.03 credits for the whole query, plus 0.03 for
  each gating must-have measured on its own. Person search bills per result
  returned and its schema sets a minimum `limit` of 1, so unlike job search
  and social-post search there is no free `limit: 0` count query. One profile
  comes back and is discarded; `total_count` is the point. A query matching
  nobody is free. The exact charge comes from the `X-Credits-Used` header and
  is shown under the number, so the cost is never an estimate.
- Crustdata person search: 0.03 credits per result.

## Layout

```
app/
  page.tsx                          intake screen
  api/suggest/route.ts              title variants and criteria suggestions
  api/title-autocomplete/route.ts   proxy to Crustdata autocomplete
  api/city-resolve/route.ts         city name to "City, Country"
  api/skill-resolve/route.ts        skill type-ahead and verification
  api/count/route.ts                match count for the current brief
lib/
  types.ts                          Criterion, RoleBrief
  anthropic.ts                      model strings and the one API call
  crustdata.ts                      field whitelist, query builder, timezones
  crustdata-autocomplete.ts         shared autocomplete proxy and cache
  suggest.ts                        prompt, disk cache, validation
  skills.ts                         skill taxonomy, trait guard, index check
  city.ts                           location lookups
  titles.ts                         offline fallback title list
components/
  RoleIntakeForm.tsx                the form and the live query preview
  Combobox.tsx                      debounced type-ahead input
  TitleCombobox.tsx                 Combobox wired to job titles
```
