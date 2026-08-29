# Karnataka ASDDO Dashboard

A static site — no server, no database, hostable on GitHub Pages — that lets a
voter check whether their EPIC number appears on the Karnataka **ASDDO** list
(names removed from the electoral roll as **A**bsent, **S**hifted, **D**eath,
**D**uplicate or **O**thers), and shows the scale of those deletions on a
dashboard.

Source: the per-booth PDFs published by the Chief Electoral Officer, Karnataka
at <https://ceo.karnataka.gov.in/asddo.html>. This project reformats them; it
is not official.

**Coverage: all 34 districts on the source page, 224 constituencies, 58,479
booth PDFs.** Where a district publishes nothing readable, the import fails
rather than quietly narrowing — see *The coverage guard*.

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

Drop `--district` to do the whole state: **34 districts, 224 constituencies,
58,479 booth PDFs**, roughly 16 hours at ~60 booths/min — or ~1 hour on Actions,
where districts run as a matrix. Nothing is written to disk except the extracted
rows, and every stage is resumable: an interrupted run skips the booths already
in `<district>.done`. Raise `--concurrency` above the default 6 to go faster, at
the cost of more Drive throttling.

Kudligi's booths arrive as a `.rar`, which needs an external extractor on PATH
(`7z`, `7zz`, `unar` or `unrar`). Without one, those 250 booths are *reported*
as unreadable rather than silently dropped — see *Archives*.

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

Supporting scripts, each of which exists because something went wrong without it:

| Script | Does |
|---|---|
| `plan-matrix.mjs` | Builds the CI district matrix **and refuses to plan an import that has lost a district**. See *The coverage guard*. |
| `verify-build.mjs` | After stage 3, checks every extracted row is present and correct in the built buckets. Zero network, 100% of records, non-zero exit blocks publishing. |
| `build-ac-names.mjs` | Reads official constituency names out of the PDFs themselves into `seed/ac-names.json`, applied client-side so a rename needs no re-import. |
| `test-coverage-guard.mjs` | Unit tests for the guard, the archive readers and booth-name parsing. Part of `npm test`. |
| `qa-live.mjs` | Samples booths straight from the source and checks the live site returns the same name, reason and source link. |

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

2. **The EPIC column is not always an EPIC, and it fails per constituency
   rather than per row.** A constituency either publishes real EPIC numbers in
   that column or publishes an internal serial for every row. Sampled by hand:

   ```
   A001 Bidar/Aurad          LWX2795011   real EPIC
   A209 Belgaum/Athani       LXV1350016   real EPIC
   A178 Dharwad/Kalghatgi    000294       internal serial — unusable
   A120 Chamarajanagar       49           internal serial — unusable
   ```

   Where a constituency publishes serials, **nobody** can do an EPIC lookup
   from that file — not this project, not any tool. The statewide share is
   unmeasured; do not trust a percentage until you have counted it yourself
   (note these CSVs have **no header row**, which is easy to get wrong).

   So a miss in the roll index says nothing about whether a person is
   registered. Below 95% coverage the client never shows the alarming "not
   found in either list" verdict — it reports that the index is partial
   instead. `rollCoverage` in the manifest drives this and `smoke-test.mjs`
   asserts it. If you raise that threshold, you are choosing to tell registered
   voters they are missing from the roll.

Publishing with details re-hosts the whole roll — name, relative, age and
gender for every elector who has an EPIC. It is already downloadable from the
CEO site, but a copy on GitHub is mirrorable and permanent in a way the
original is not, and at full state it will approach the 1 GB GitHub Pages cap.
`--existence-only` publishes 4 bytes per EPIC and nothing reversible. Choose
deliberately.

## What gets committed

`docs/` is committed, including `docs/data/**` — that *is* the deployment.
`cache/` is git-ignored: it holds the raw PDFs and is large.

Bucket depth adapts to the dataset (target ≈ 40 records per bucket).

**Size is now the binding constraint.** Currently published: **1,03,67,368
records across 32 districts → 65,536 buckets → 808 MB**, against GitHub Pages'
**1 GB** cap. Adding Vijayanagara and Bangalore Rural brings it to roughly
1.06 crore records and ~830 MB. That leaves little headroom, and it is why the
electoral-roll index cannot simply be published alongside it. `npm run build`
prints the size and the workflow warns past 900 MB — check both before
committing, and prune fields in `3-build-site-data.mjs` if it gets tight.

---

## Testing

```bash
npm test                                 # coverage guard + archive readers + smoke test
node scripts/smoke-test.mjs TXF3829793   # an EPIC you know is on the list
```

`smoke-test.mjs` reimplements the client's lookup in Node against `docs/data/`
and asserts the verdicts, including that a malformed EPIC is rejected and an
unknown one is never reported as clear.

`test-coverage-guard.mjs` covers the guard's decisions — including the exact
two-empty-districts shape that shipped — plus the zip reader, against an archive
built in-process so it needs no network, and booth-name parsing.

`verify-build.mjs` is the real end-to-end check and runs **inside the import**,
after stage 3, where both halves already sit on the runner's disk:

```
source rows                            356,425
present in built buckets               356,425
MISSING                                      0
unique (EPIC, constituency) in source  346,444
records in built data                  346,444   ← reconciles
same EPIC twice in one constituency          0
```

Verifying by fetching the live site instead would need ~65,000 bucket requests
plus ~52,000 PDFs, which GitHub Pages rate-limits — and it would test the CDN
rather than the pipeline. An early attempt to do it that way reported 12,130
missing buckets that did not exist; throttled responses were being counted as
absent.

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

**Refresh it whenever discover changes.** A stale seed is no longer merely
out of date: if it predates a fix that recovered a district, the coverage guard
will fail the run on falling back to it — correctly, but after burning the
crawl. Check `discoveredAt` and the booth count before trusting one.

The preflight step prints the runner's egress IP and the status of all three
sources before any real work, so a failed run says which host refused it.

### District sources are not uniform

The source page lists **34 districts** and every one of them now yields data —
but getting there took four separate fixes, because each district publishes
differently and nothing about the shape can be assumed. `1-discover.mjs`
assumes nothing, since every assumption made here has already been wrong once:

- 24 districts link straight to a Google Drive folder; 10 link to their own
  `*.nic.in` site, which links on to Drive folders (and sometimes to PDFs on
  the NIC S3 CDN). An earlier version required a Drive link and silently
  dropped those 10.
- The Drive trees are different shapes: `district → AC → PDFs`,
  `district → AC → date → PDFs`, and district folders wrapped in a redundant
  folder of the same name. Assuming a fixed depth returned **zero files, with
  no error**, for five districts.
- Bangalore Rural's links were pasted out of webmail, so each is wrapped in
  `mail.mgovcloud.in/zm/reUrlCheck.do?url=<percent-encoded>`. The literal
  string `drive.google.com/drive/folders/` never appears in the markup. Links
  are unwrapped and percent-decoded before any pattern is applied.
- Its newest snapshot is linked as bare `drive.google.com/file/d/<id>/view`
  URLs, which carry no extension and match neither `.pdf` nor `.zip`. Those are
  fetched and identified from their bytes, with the name taken from
  `Content-Disposition` — the only place it exists for such a link.
- Several districts keep a folder per day, so the same booth appears many
  times. Bijapur holds 20,126 files for 2,096 booths. The newest copy of each
  `(constituency, part)` wins, judged by the timestamp in the file name. Across
  53,405 keyed booths there are **zero surviving duplicates**. Note that mixed
  dates within one district are correct, not a bug: Bangalore Rural keeps 1,139
  booths generated 03/08 and one generated 23/07, because that booth appears in
  no later snapshot. Per-folder "newest date only" would have dropped it.

### Archives

2,373 booths — Vijayanagara and Bangalore Rural — are published as archives
rather than loose PDFs, in three shapes:

| Shape | Where | Read by |
|---|---|---|
| `.zip` of booth PDFs | most of both districts | `lib/zip.mjs`, dependency-free |
| `.zip` linked as a bare Drive file id | Bangalore Rural's newest snapshot | sniffed from the bytes |
| `.zip` containing a `.rar` of booth PDFs | Kudligi | `lib/rar.mjs` |

`lib/archive.mjs` is the single entry point and descends into nesting **only
when the outer archive holds no PDFs of its own** — that check is what makes a
wrapper distinguishable from an empty district, which is precisely the
confusion that hid Kudligi's 250 booths.

RAR5 uses a proprietary compression, so `lib/rar.mjs` shells out to whichever
extractor the machine has (`7zz`, `7z`, `unar`, `unrar`, or 7-Zip's usual
Windows path), extracts to a temp directory, reads into memory and **deletes the
directory before returning** — no source document is left on disk. It throws
when nothing is installed rather than returning empty, so the district is
reported, not lost. CI installs `unar`.

### When the file name says nothing

Booth identity normally comes from the file name:

```
S10_209_100_Govt Higher primary School, Halugunda_01_08_2026_16_23_25.pdf
```

**1,221 files across 11 districts carry no such name.** Bellary's are
`17858435222676.pdf`; Chikkaballapur's are the same. For those, the ECI's own
generator prints the answer inside the document, at the head of every section:

```
AC: 94-Bellary City; Part: 131-Sharada Vidya Peeta English Medium High School
```

`lib/pdf.mjs` reads that per section and carries it across continuation pages —
the header prints when a booth's section begins and not again, so scoping it to
a single page left 61,879 of 71,385 rows in one Bellary file unattributed.
Stage 2 uses it only where the file name gave nothing, so the 53,405
already-identified booths are untouched.

The effect on Bellary:

```
before   1 constituency "AC ?",  1 booth,   no generation dates
after    4 constituencies,     841 booths,  generated 01/08 and 03/08/2026
         91-Kampli · 93-Bellary · 94-Bellary City · 95-Sandur
```

Chikkaballapur (1,16,367 records under one pseudo-booth) resolves the same way
on the next import.

### The coverage guard

Two districts were missing from the live site for weeks and **nothing anywhere
went red**. The cause was structural rather than a one-off: the plan step
filtered out districts that had yielded no booth PDFs, and every later check
compared against that filtered number. "34 of 34 districts imported" was true
of a set that had already lost them. The guard meant to catch narrowed coverage
was counting the survivors.

It is now checked at four points:

| Where | Behaviour |
|---|---|
| `1-discover.mjs` | Records `coverage` in the manifest — districts in source, which yielded nothing, which archives could not be opened. |
| `plan-matrix.mjs` | **Fails the run** when any district on the source page yielded no booths, naming them. `allow_partial=true` overrides, with a warning. |
| `build` job | Reports districts published against districts on the source page, not against the filtered plan. |
| The site | A "not on the deleted list" verdict **names the districts that are not loaded**, so absence is never read as an all-clear by someone whose district was never imported. |

The guard used to be inline YAML, which is why nothing could test it. It is a
file now, with tests: `node scripts/test-coverage-guard.mjs`.

**Do not set `allow_partial=true` to make a red run go green.** It exists for
the case where a district genuinely publishes nothing yet, and it makes the site
narrower than it claims to be.

### Known gaps

Every district on the source page now yields data. What remains:

| Gap | Detail |
|---|---|
| Scanned PDFs | Some documents are images with no text layer — 41 of Bellary's 75 files, and at least some of Chikkaballapur's 14. `looksScanned()` detects and skips them; reading them would need OCR. |
| A stray `.mp4` | A video linked on a district page. Correctly skipped, reported at the end of every crawl. |
| Stale duplicate archives | Bijapur publishes an `ASDDO Voters.zip` of `.crdownload` files (someone zipped a folder of interrupted downloads) and five `31-Nagathan` zips that return HTML. Both constituencies are complete from loose, newer PDFs — parts 1–231 and 1–299 with no gaps — so these are warnings, not gaps. |
| Dedupe blind spot | The newest-copy rule keys on `(constituency, part)` from the file name. Those 1,221 files without one are deduped by identical file name only, so a reposted list under a new name would survive twice. Stage 3's per-constituency EPIC dedupe catches it downstream. |

`discover` lists all of these at the end of every run — check that report.

---
## Handing this over

The laptop this was developed on was wiped on 2026-08-29. Nothing was lost with
it — every stage runs on GitHub's runners — but what the repo alone does not
tell you is in **[HANDOFF.md](HANDOFF.md)**: the state everything was left in,
that both schedules are paused, which decisions are sitting live in a public
repo, and what to do first. Read it before running a workflow.

## Related work

**[Karnataka_Draft_Roll_2026](https://github.com/gouthamganeshm/Karnataka_Draft_Roll_2026)**
— EPIC search over the Karnataka **draft electoral roll** (SIR 2026). The two
projects answer opposite questions about the same voter: this one says whether
an EPIC is on the **deletion** list, that one whether it is on the **roll**.
Same design — client-side hashing, static buckets, no server — but a different
source, OCR instead of text extraction, and roughly five times the data, which
is why its buckets live on R2 rather than Pages. Separate repos and separate
data lifecycles, on purpose. A comparison table is in *Sibling project* in
HANDOFF.md.
