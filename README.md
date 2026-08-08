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
   → if no match and a roll index exists: data/roll/ab/cd.bin, binary search
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
| **Not on the deleted list** | not in deletions, **found** in the roll index | A genuine all-clear |
| **Not found at all** | not in deletions, **not** in the roll index | Almost always a typo — never shown as an all-clear |

Without the roll index (see below) the site collapses to two verdicts and
**says so on screen**, rather than letting a mistyped number read as safe.
That is the single most important behaviour in the project; `npm test` asserts it.

---

## Quick start

```bash
npm run discover -- --district KODAGU    # crawl the source page + Drive folders
npm run download -- --district KODAGU    # fetch the booth PDFs (resumable)
npm run extract  -- --district KODAGU    # PDFs -> rows
npm run build                            # rows -> docs/data/**
npm run serve                            # preview docs/ on :8080
```

Drop `--district` to do the whole state. Start with one district: Kodagu is the
smallest at 551 PDFs / ~98 MB and takes a few minutes; the full state is tens of
thousands of PDFs and several hours. Every stage is resumable and re-runnable.

Deploy: push, then point GitHub Pages at the `docs/` folder on your default
branch (Settings → Pages → Source: *Deploy from a branch* → `/docs`). There is
no build step.

---

## Pipeline

| Stage | Script | Does |
|---|---|---|
| 1 | `1-discover.mjs` | Parses `asddo.html` for district → Drive folder links, then walks Drive for constituencies and booth PDFs. Writes `cache/manifest.json`. |
| 2 | `2-download.mjs` | Downloads PDFs to `cache/pdfs/`. Skips anything cached; re-run after failures. |
| 3 | `3-extract.mjs` | PDFs → `cache/extracted/<district>.ndjson`, plus a report of reason strings that did not map to a category. |
| 4 | `4-build-site-data.mjs` | Buckets records by hash into `docs/data/`, builds `stats.json` for the dashboard. |
| 5 | `5-build-roll.mjs` | *Optional.* Builds the electoral-roll existence index. |

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

## Electoral roll (optional, and the hard part)

The ASDDO PDFs contain only deletions. Telling "not deleted" apart from "this
number does not exist" needs a list of every valid EPIC, which the CEO does not
publish in bulk — `voter_list.html` is a per-constituency search behind a
CAPTCHA.

When you have assembled such a list (one EPIC per line, or any CSV with an
EPIC-shaped token per line):

```bash
node scripts/5-build-roll.mjs --input path/to/epics.txt
```

Only 4 bytes of each hash are published — no names, no addresses, nothing
reversible to a person. Until then the site runs honestly in two-verdict mode.

---

## What gets committed

`docs/` is committed, including `docs/data/**` — that *is* the deployment.
`cache/` is git-ignored: it holds the raw PDFs and is large.

Bucket depth adapts to the dataset (target ≈ 40 records per bucket). The Kodagu
pilot: 64,437 records → 4,096 buckets → 3.7 MB. Extrapolating to the full state,
expect a few hundred MB — within GitHub Pages' 1 GB soft limit, but check
`npm run build` output before committing, and prune fields in
`4-build-site-data.mjs` if it gets tight.

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
