# Role to shortlist

A local recruiting tool. Paste a job ad, get a pool of candidates, enrich the
ones worth paying for, judge them against the brief, and write to them.

Runs on one machine. No login, no deployment, no database: everything is
JSON files under `.data/`, which is gitignored.

---

## Setup

Needs Node 20 or later.

```bash
npm install
cp .env.local.example .env.local   # then fill in the keys, see below
npm run dev
```

Open http://localhost:3000.

### API keys

All three go in `.env.local` in the project root. That file is gitignored, so
keys never leave your machine. Restart the dev server after editing it.

| Key | What it is for | Cost |
|---|---|---|
| `ANTHROPIC_API_KEY` | Reading the job ad into criteria, judging candidates against them, writing outreach drafts | A few cents per hire |
| `CRUSTDATA_API_KEY` | Candidate search and profile enrichment | 0.03 credits per search result, 1 to 2 per enriched profile |
| `GITHUB_TOKEN` | Reading public contribution history | Free |

**Anthropic** — https://console.anthropic.com. Uses Sonnet for intake,
judging and outreach; Haiku for autocomplete.

**Crustdata** — the only paid dependency. Search is cheap, enrichment is not,
which is why the tool counts before it buys and reuses anyone it has seen
before.

**GitHub** — a classic personal access token with **no scopes ticked**.
Everything read is public. https://github.com/settings/tokens

Without the GitHub token the GitHub step is skipped rather than degraded: the
GraphQL API cannot be called unauthenticated at all. Without the Crustdata key
nothing works.

---

## Using it

Four steps, shown as a path at the top of every page. They are sequential in
cost, not just in order.

### 1. Search · `/hire/new`

Paste the job ad. The model reads out the title, synonyms worth searching,
adjacent titles worth considering, and the requirements split into must-haves
and nice-to-haves. Everything is editable.

Then, on the right:

1. **Check how many matches** — free, tells you whether the query is any good
2. **Find candidates** — costs 0.03 credits per profile

Each must-have shows `reaches N, adds N` after a count. A criterion showing
`adds 0` is already covered by another one and can be unticked.

### 2. Shortlist

The search pool, ranked. Nothing has been paid for beyond the search itself.
Move the weights and watch the order change: rescoring is free.

Tick the people worth enriching and press **Enrich and Create new Shortlist**.
This is the expensive step, roughly 1.7 credits a head. People already in the
store are reused for free, and the button says how many of each.

Enrichment then runs GitHub and a profile-photo check, both free.

### 3. Matching

Edit the requirements, then **Judge**. One model call per candidate. Every
`met` verdict carries a quote from the person's own profile, verified in code
to actually exist in that text.

Marks on each row: **●** met with evidence, **○** listed as a skill but not
described, **·** nothing, **?** nothing written to read.

Tick people to put them on the outreach list.

### 4. Outreach

One person at a time. Write a line about why they fit, press generate, read
the draft before sending it. Mark them as written to, or reject.

---

## Things worth knowing

**Rejections and contacts are remembered across hires.** Someone written to
for one role shows as such the moment they appear in another search, before
you spend anything on them.

**Absence is never treated as failure.** No GitHub handle means unknown, not
"no public work". Someone with nothing written about them is reported as
unjudgeable rather than as failing every requirement.

**Nothing is bought twice.** Enriched profiles are stored by person, not by
hire, and reused for 30 days.

**Verdicts are cached** on the requirement's wording, the candidate's text,
the prompt version and the model. Rerunning is free; editing one requirement
re-judges only that requirement.

---

## Where things are

```
.data/          everything the tool has bought or decided (gitignored)
  searches/     search results
  people/       one file per person, shared across hires
  shortlists/   versioned per hire
  matching/     requirements and verdicts
  outreach/     drafts, the outreach list, your name
  decisions.json  rejected and written-to, across every hire

lib/            all the logic, one file per concern
app/            pages and API routes
components/     UI
```

Each `lib/` file opens with a comment explaining what it does and why it
works the way it does.
