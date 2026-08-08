# Karnataka ASDDO Dashboard

A static site — no server, no database, hostable on GitHub Pages — that lets a
voter check whether their EPIC number appears on the Karnataka **ASDDO** list
(names removed from the electoral roll as **A**bsent, **S**hifted, **D**eath,
**D**uplicate or **O**thers), and shows the scale of those deletions on a
dashboard.

Source: the per-booth PDFs published by the Chief Electoral Officer, Karnataka
at <https://ceo.karnataka.gov.in/asddo.html>. This project reformats them; it
is not official.

---

## How a lookup works without a server

A static host cannot run a query, so the data is pre-bucketed by hash:

```
user types ABC1234567
   → SHA-256 in the browser
   → first N hex chars pick a bucket:  data/asddo/ab/cd.json   (one small file)
   → the next 8 hex chars are matched against records inside it
   → if no match and a roll index exists: data/roll/ab/cd.json (or .bin)
```

Two consequences, both deliberate:

- **The EPIC never leaves the device.** No request contains it — only a request
  for a bucket shared by thousands of numbers. This is strictly better for the
  person checking than a server-backed lookup, which necessarily sees both the
  EPIC and the IP.
- **The buckets contain no EPIC numbers.** Only the hash is stored; the browser
  already knows the number the user typed, so it can render it. This is
  obscurity rather than secrecy — the EPIC keyspace is small enough to brute
  force — but it stops the published data being trivially scraped into an
  EPIC-to-name table.

### The three verdicts

| Verdict | Condition | Why it matters |
|---|---|---|
| **On the ASDDO list** | hash found in a deletion bucket | Shows the record, the reason, and a link to the source PDF |
| **Not on the deleted list** | not in deletions, **found** in the roll index | A genuine all-clear, and shows the elector their own roll entry |
| **Not found at all** | not in deletions, **not** in the roll index, and roll coverage ≥ 95% | Almost always a typo — never shown as an all-clear. Suppressed on a partial index; see *Electoral roll*. |

Without the roll index (see below) the site collapses to two verdicts and
**says so on screen**, rather than letting a mistyped number read as safe.
That is the single most important behaviour in the project; `npm test` asserts it.

---

## Quick start

```bash
npm run discover -- --district KODAGU    # crawl the source page + Drive folders
npm run extract  -- --district KODAGU    # stream PDFs from Drive -> rows (nothing stored)
npm run build                            # rows -> docs/data/**
npm run roll     -- --ac 208,209         # optional: electoral-roll index
npm run serve                            # preview docs/ on :8080
```

Drop `--district` to do the whole state: 24 districts, 147 constituencies,
32,113 booth PDFs, roughly 9 hours at ~60 booths/min. Nothing is written to
disk except the extracted rows, and every stage is resumable — an interrupted
run skips the booths already in `<district>.done`. Raise `--concurrency` above
the default 6 to go faster, at the cost of more Drive throttling.

Deploy: push, then point GitHub Pages at the `docs/` folder on your default
branch (Settings → Pages → Source: *Deploy from a branch* → `/docs`). There is
no build step.

---

## Pipeline

| Stage | Script | Does |
|---|---|---|
| 1 | `1-discover.mjs` | Parses `asddo.html` for district → Drive folder links, then walks Drive for constituencies and booth PDFs. Writes `cache/manifest.json`. |
| 2 | `2-extract.mjs` | Fetches each booth PDF from Drive, parses it **in memory** and keeps only the rows. PDF bytes are never written to disk. Resumable via a per-district `.done` ledger. |
| 3 | `3-build-site-data.mjs` | Buckets records by hash into `docs/data/`, builds `stats.json` for the dashboard. |
| 4 | `4-build-roll.mjs` | *Optional.* Builds the electoral-roll index, with elector details or existence-only. |

Two Drive tricks worth knowing, both in `scripts/lib/common.mjs`:
`https://drive.google.com/embeddedfolderview?id=<ID>#list` returns plain HTML for
a public folder (the normal folder page is JS-rendered and useless to a scraper),
and `https://drive.google.com/uc?export=download&id=<ID>` fetches a file without
an API key.

### PDF parsing

The booth PDFs are machine-generated: no scans, base-14 fonts, and every table
cell is its own positioned `BT … x y Td (text) Tj ET` block. `lib/pdf.mjs`
therefore reads them directly, with no PDF library.

Cells are matched to columns **by x-coordinate**, not by counting tokens. This
matters more than it sounds: counting works on a clean sample and then silently
corrupts every row with a blank or wrapped cell, sliding a relative's name into
the reason column. Two related traps this parser handles, both of which produced
wrong output before they were fixed:

- The generator emits trailing-dot numbers (`25.`, `0.`), which a naive
  `-?\d*\.?\d+` pattern rejects — silently yielding zero rows.
- Header labels are not reliably one text object: some booths draw `Serial No.`
  as `Serial` + `No.`. Matching header text exactly dropped **331 of 551** files
  in the Kodagu pilot without any error. `findHeader()` accumulates cells until
  they complete the next expected label.

If you re-point this at another state's PDFs, verify the row count per booth
against a couple of documents by hand before trusting the totals.

### Reason → category

The PDFs print prose, never the letters A/S/D/D/O:

| Printed reason | Bucket |
|---|---|
| `Untraceable/Absent` | Absent |
| `Permanently Shifted` | Shifted |
| `Death` | Death |
| `Already enrolled (<EPIC>)` | Duplicate |
| `EF Refused`, anything unrecognised | Others |

Unmapped strings are reported by stage 3 rather than being dropped, so new
wording gets noticed. Check that report on every import.

`Already enrolled (ABC1234567)` carries the surviving EPIC. It is stored
**masked** (`ABC****567`) — enough for a person to recognise their own other
number, not enough to publish a second EPIC list.

---

## Electoral roll (optional)

The ASDDO PDFs contain only deletions. Telling "not deleted" apart from "this
number does not exist" — and showing a voter their own roll entry — needs the
roll itself. The CEO publishes it as plain CSV, one file per constituency:

```
https://ceo.karnataka.gov.in/csv_upload/english/A###.csv
DISTRICT,ACCODE,ACNAME,PART,SLNO,EPIC,FIRST,LAST,RELFIRST,RELLAST,RELATION,AGE,GENDER
```

with booth names in `ac_names.csv` (CSV-quoted; they contain commas).

```bash
npm run roll                      # all constituencies, with elector details
npm run roll -- --ac 208,209      # just these
npm run roll -- --existence-only  # 4 bytes per EPIC, no names at all
```

**Two things this data will bite you with.**

1. **`A###` is not an ECI constituency number.** It is the CEO's internal file
   index: `A001` is Aurad in Bidar, `A209` is Athani in Belgaum — not Virajpet,
   which is AC 209 in the ASDDO PDFs. The roll index is self-contained and
   never joins on this number, and the UI does not display it as a
   constituency number. Do not "fix" that by joining the two namespaces.

2. **Only ~9–14% of roll rows carry a standard-format EPIC.** Many hold legacy
   values like `000132`, or nothing. So a miss in the roll index says nothing
   about whether a person is registered. Below 95% coverage the client
   therefore never shows the alarming "not found in either list" verdict — it
   reports that the index is partial instead. `rollCoverage` in the manifest
   drives this, and `smoke-test.mjs` asserts it. If you raise that threshold,
   you are choosing to tell registered voters they are missing from the roll.

Publishing with details re-hosts the whole roll — name, relative, age and
gender for every elector who has an EPIC. It is already downloadable from the
CEO site, but a copy on GitHub is mirrorable and permanent in a way the
original is not, and at full state it will approach the 1 GB GitHub Pages cap.
`--existence-only` publishes 4 bytes per EPIC and nothing reversible. Choose
deliberately.

## What gets committed

`docs/` is committed, including `docs/data/**` — that *is* the deployment.
`cache/` is git-ignored: it holds the raw PDFs and is large.

Bucket depth adapts to the dataset (target ≈ 40 records per bucket). The Kodagu
pilot: 64,437 records → 4,096 buckets → 3.7 MB. Extrapolating to the full state,
expect a few hundred MB — within GitHub Pages' 1 GB soft limit, but check
`npm run build` output before committing, and prune fields in
`3-build-site-data.mjs` if it gets tight.

---

## Testing

```bash
node scripts/smoke-test.mjs TXF3829793   # an EPIC you know is on the list
```

Reimplements the client's lookup in Node against `docs/data/` and asserts the
verdicts, including that a malformed EPIC is rejected and an unknown one is
never reported as clear.

---

## Deliberate omissions

- **No search by name, no browse-by-district, no bulk endpoint.** One EPIC in,
  one record out. The dashboard shows aggregates only.
- **`robots.txt` disallows everything**, plus `noindex` and `no-referrer`.
- **No analytics, no fonts, no CDN, no third-party requests of any kind.**

On a static host there is no rate limiter to fall back on, so these
conventions and the hashed buckets are the only controls that exist. The data
is about real people who did not choose to be in it — keep that in mind before
adding a feature that makes the whole set easier to enumerate.

## Accuracy and freshness

The source PDFs state they are regenerated daily. The footer shows both the
import date and the generation dates stamped on the documents. During a claims
and objections window, stale data is actively harmful — re-import often, and
never present this as a substitute for `voters.eci.gov.in` or your BLO.

## Running the import on GitHub Actions

`.github/workflows/import.yml` runs the whole statewide import on GitHub's
runners — the point being that a full pass streams ~5.7 GB of PDFs and produces
~2.5 GB of intermediate rows, none of which needs to touch a laptop. Districts
fan out as a matrix, so wall-clock is one district rather than ~9 hours.

**`ceo.karnataka.gov.in` may refuse GitHub runners.** It is reachable from an
ordinary Indian connection but government hosts commonly reject datacenter and
foreign IP ranges, and a runner is both. Only the `discover` stage needs that
host — `extract` talks solely to Google Drive. So the workflow falls back to
`seed/manifest.json.gz`, a committed snapshot of the crawl, and warns that it
did. Refresh the seed from a machine that *can* reach the source:

```bash
node scripts/1-discover.mjs
gzip -9c cache/manifest.json > seed/manifest.json.gz
```

The preflight step prints the runner's egress IP and the status of all three
sources before any real work, so a failed run says which host refused it.

### District sources are not uniform

The source page lists **34 districts** and publishes them three different ways.
`1-discover.mjs` assumes nothing about shape, because every assumption made
here has already been wrong once:

- 24 districts link straight to a Google Drive folder; 10 link to their own
  `*.nic.in` site, which links on to Drive folders (and sometimes to PDFs
  hosted on the NIC S3 CDN). An earlier version required a Drive link and
  silently dropped those 10.
- The Drive trees are different shapes: `district → AC → PDFs`,
  `district → AC → date → PDFs`, and district folders wrapped in a redundant
  folder of the same name. Assuming a fixed depth returned **zero files, with
  no error**, for five districts.
- Several districts keep a folder per day, so the same booth appears many
  times. Bijapur holds 20,126 files for 2,096 booths. Booth identity and the
  generation timestamp both come from the file name
  (`S10_<ac>_<part>_<booth>_<dd_mm_yyyy>_<hh_mm_ss>.pdf`), and the newest copy
  of each `(ac, part)` wins. Without that dedupe the import is a ~10× overcount.

**Known gaps** (`discover` lists them at the end of every run):

| District | Why |
|---|---|
| VIJAYANAGARA | Publishes `.zip` archives per AC, not loose PDFs. Needs a zip reader. |
| BANGALORE RURAL | `bangalorerural.nic.in` returns 504. Retry later. |
| CHIKKABALLAPUR | Only 14 consolidated PDFs on the S3 CDN, not per-booth files, so AC/part cannot be read from the file name. |
