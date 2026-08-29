# Handoff

Written 2026-08-29, when the laptop this was developed on was wiped. Nothing was
lost with it: every stage runs on GitHub's runners, and this file is what the
repo alone does not tell you.

Read `README.md` first for how the thing works. This file is only about
**operating it from here on** — what state it was left in, what is paused, what
decisions are sitting live in a public repo, and what to do first.

---

## The one-minute version

- Everything runs from the **Actions** tab. No laptop, no local checkout, and
  **no credentials to transfer** — see *What you need to take over*.
- **Both schedules are paused** since 2026-08-13. Nothing is importing itself.
- The last import was **17-Aug-2026**. By this project's own standard in
  *Accuracy and freshness*, that is stale enough to matter.
- **First thing to do:** run *Import ASDDO data*, then read its reconciliation
  step against the CEO's official totals.
- One live decision worth re-making on purpose: the electoral-roll index is
  published **with names** for two constituencies. See *Live decisions*.

## What you need to take over

A GitHub account with write access to this repo. That is the whole list.

There are **no secrets, no API keys, no cloud accounts**. The workflows use the
default `GITHUB_TOKEN` with `permissions: contents: write`, and the only hosts
they touch — `ceo.karnataka.gov.in` and Google Drive — are public and
unauthenticated. (This is the one place the [sibling project](#sibling-project)
differs sharply: it needs Cloudflare R2 credentials. This one needs nothing.)

Deployment is GitHub Pages serving `docs/` from `main`: **Settings → Pages →
Source: Deploy from a branch → `main` / `/docs`**. There is no build step — a
push is a deploy. Confirm that setting is still what you expect; it was not
verifiable from the CLI when this file was written.

## The three workflows

All three are `workflow_dispatch` — run them from the Actions tab.

| Workflow | What it does | When to run it |
|---|---|---|
| **Import ASDDO data** (`import.yml`) | The whole statewide import. Districts fan out as a matrix, so wall-clock is one district (~20–50 min) rather than the ~9 hours a sequential pass takes. Streams ~5.7 GB of PDFs on the runner and commits only `docs/data`. | The main job. Run it when the data is stale, or after a parser change (with `full_refresh`). |
| **Refresh source links** (`refresh-links.yml`) | Re-crawls the source page and Drive folders and commits `seed/manifest.json.gz`. Touches no PDFs and never `docs/data`. | Cheap and safe. Run it before a big import so the import has a fresh baseline to fall back to. |
| **Build electoral-roll index** (`roll.yml`) | Rebuilds the elector index. `mode` decides whether names are published at all. | Manual on purpose. Not a routine job — read *Live decisions* before running it. |

Import inputs worth knowing: `districts` (force-pull a comma-separated list even
if unchanged, or `all` for pure incremental), `full_refresh` (ignore the cache
entirely — use after a parser change), `concurrency_per_job` (default 6; higher
means more Drive throttling), and `allow_partial` (**do not** — see *When a run
goes red*).

## Both schedules are paused

The crons were commented out on **2026-08-13** while the self-healing force-pull
mechanism and the Drive-throttle retry were being validated. That validation
never got a written verdict, so treat them as **unproven rather than broken**.

To resume, un-comment the `schedule:` blocks in `import.yml` (weekly,
`20 2 * * 0`) and `refresh-links.yml` (six-hourly, `0 */6 * * *`).

Do one manual run of each first and read the coverage report before handing
either a schedule. An unattended import that quietly narrows coverage is the
exact failure this repo has already had once — see *The coverage guard*.

## The weak point: `discover` and the CEO site

`1-discover.mjs` is the only stage that talks to `ceo.karnataka.gov.in`.
Everything else talks to Google Drive, which is reliable from a runner. The CEO
host answers datacentre IPs **inconsistently** — it is not a permanent block,
which makes it worse: a run can succeed one day and fail the next.

So a failed crawl is not fatal. The workflow falls back to
`seed/manifest.json.gz`, a committed snapshot of a previous crawl, and says so
in its log. **That fallback is only as good as its `discoveredAt`.**

This is not hypothetical. The 17-Aug import fell back to the seed and imported
the 57,496 booths the then-current 15-Aug crawl knew about, not the 58,479 the
source actually had by then.

When the seed goes stale, refresh it from a connection the source *will* answer
(an ordinary Indian residential connection, not a runner and not a VPN endpoint
abroad):

```bash
node scripts/1-discover.mjs
gzip -9c cache/manifest.json > seed/manifest.json.gz
```

Commit the result. A seed that predates a fix which recovered a district will
fail the coverage guard on fallback — correctly, but only after burning the
crawl.

## Live decisions

Three things are true of the deployed site right now that someone should decide
on deliberately rather than inherit by accident.

**1. The electoral-roll index is published with names.** ACs 208 and 209 only,
in `details` mode — **29,647 rows carrying name, relative, age and gender**,
live under `docs/data/roll/`. That was a two-constituency trial, not a decision
about the state. Re-running *Build electoral-roll index* at `all` in `details`
mode would re-host the entire Karnataka roll — read the end of *Electoral roll*
in the README before doing that, and note it would blow past the Pages size cap
besides. `existence-only` publishes 4 bytes per EPIC and nothing reversible.

**2. Size is the binding constraint.** GitHub Pages caps a published site at
**1 GB** and the ASDDO data alone is most of the way there. `npm run build`
prints the size and the workflow warns past 900 MB. Check both before adding
anything to `docs/data`.

**3. The privacy posture is deliberate, not incidental.** One EPIC in, one
record out; no name search, no browse-by-district, no bulk endpoint;
`robots.txt` disallows everything; no analytics, fonts or CDN. On a static host
there is no rate limiter to fall back on, so those conventions and the hashed
buckets are the only controls that exist. See *Deliberate omissions*.

## State at handoff

| | |
|---|---|
| Published records | **1,08,46,382** across **34 districts**, **224 constituencies** |
| `dataVersion` | `msxhw7du` |
| Source PDFs stamped | 24/07/2026 – 17/08/2026 |
| Last import | commit `39b1213`, 17-Aug-2026 17:19 UTC (fell back to the 15-Aug seed) |
| Seed manifest | 2026-08-17 crawl — 34/34 districts, 58,479 booth PDFs |
| Official figures | `seed/official-asddo.json`, CEO press release of 17-Aug-2026 6:00 PM |
| Roll index | ACs 208 & 209, `details` mode, 29,647 rows |
| Schedules | both paused since 2026-08-13 |
| Live site | <https://gouthamganeshm.github.io/karnataka-asddo-dashboard/> — verified 2026-08-29 serving `msxhw7du`, i.e. current with the repo |

The live numbers always come from `docs/data/stats.json`; this table will drift
the moment someone runs an import, and that is fine — it is a snapshot of what
was true at handoff, not a thing to keep updated.

## Re-creating a local checkout

`git clone` and nothing else.

- **No dependencies.** `package.json` has none; `npm install` is a no-op. Node
  20+ is the only requirement.
- **`cache/` is git-ignored scratch** — a manifest and the per-district
  extraction ledgers. `discover` and `extract` rebuild it.
- **`extract` is resumable.** An interrupted run skips the booths already in
  `<district>.done`, so a rebuild resumes rather than restarts.
- A full local pass is ~16 hours at ~60 booths/min. Use `--district` to work on
  one, or just use Actions.

Two files that existed locally were **never committed, on purpose**, and are not
worth recovering: `roll-csv-urls.txt` and `roll-csv-index.txt`, hand-made lists
of the CEO's per-constituency roll CSVs. They are `A001`–`A224` at
`https://ceo.karnataka.gov.in/csv_upload/english/<code>.csv`, and the names are
already in `seed/ac-names.json` — a loop, not an asset. They stay git-ignored
because a tidy public index of where to download every elector roll in the state
is exactly the convenience *Deliberate omissions* exists to withhold.
`qa-results.json` is git-ignored for the same reason: it contains real elector
names.

## When a run goes red

The guards are the point of this repo, not an obstacle. In order of what usually
fires:

| Guard | What it means |
|---|---|
| `plan-matrix.mjs` fails | A district on the source page yielded no booths. Something in discovery broke, or the source moved a folder. Fix the cause. |
| Coverage guard fails | A district's record count collapsed versus the last build (below 70%), or the state did (below 90%). This is what Drive throttling looks like. Re-run. |
| `verify-build.mjs` fails | A row that was extracted is missing or wrong in the built buckets. A build bug, not a network one. Blocks publishing. |
| `smoke-test.mjs` fails | The lookup itself is broken for a known EPIC. |
| Reconciliation warns | The build disagrees with the CEO's own published totals in `seed/official-asddo.json`. Usually means the official figures need updating, not the data. |

**A green import does not mean the site updated.** Publishing is two independent
steps: the workflow commits `docs/data`, and then GitHub's own
`pages-build-deployment` job deploys it. The second can fail on its own. On
17-Aug it hit a Pages **503** — a transient outage on GitHub's side, nothing to
do with this repo — and nothing retried it, so the site served the *previous*
build for twelve days while the import, the commit and every guard in the table
above reported success. It only recovered because an unrelated push in late
August triggered a fresh deploy.

Nothing here watches for that, so after an import: open the
`pages-build-deployment` run in the Actions tab, or just compare `dataVersion`
in the committed `docs/data/stats.json` against what the live site serves at
`/data/stats.json`. If they differ, re-run the failed deployment — that is the
whole fix.

**Do not set `allow_partial=true` to make a red run go green.** It exists for the
case where a district genuinely publishes nothing yet, and it makes the site
narrower than it claims to be while still saying "34 of 34". Two districts were
once missing from the live site for weeks with nothing anywhere going red; that
is the failure the guards were written for.

## Sibling project

**[Karnataka_Draft_Roll_2026](https://github.com/gouthamganeshm/Karnataka_Draft_Roll_2026)**
— EPIC search over the Karnataka **draft electoral roll** (SIR 2026).

The two answer opposite questions about the same voter: *this* repo says whether
an EPIC is on the **deletion** list; the sibling says whether it is on the
**roll**. They are deliberately separate repos with separate data lifecycles,
and they are built differently in ways worth knowing before you assume anything
transfers:

| | This repo (ASDDO) | Sibling (Draft Roll) |
|---|---|---|
| Source | CEO Karnataka's ASDDO PDFs, via Google Drive | ECI's CDN, unauthenticated part PDFs |
| Extraction | Text-layer PDF parsing | OCR — the roll PDFs are stacks of JPEGs with no text layer |
| Scale | ~1.08 crore deletion records | ~5.5 crore elector records |
| Data hosting | GitHub Pages (`docs/data`), against the 1 GB cap | Cloudflare R2 (~4 GB); Pages serves only the interface |
| Credentials | none | R2 keys |

What they share is the design: client-side hashing so the EPIC never leaves the
device, static buckets, no server, and the same reason for existing — the
official publication format makes it impossible for a voter to answer a simple
question about themselves. Cross-check the two before concluding anything about
a person: a miss in the roll index says nothing on its own, for the reasons in
*Electoral roll*.
