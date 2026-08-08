# QA run — live site verification

**Site:** https://gouthamganeshm.github.io/karnataka-asddo-dashboard/
**Published data under test:** 10,367,368 records · 32 districts · 207 constituencies · 50,607 booths
**Method:** `node scripts/qa-live.mjs` (exhaustive) + Chrome spot-checks (rendering)

The two ends are independent by design. Booth PDFs are pulled straight from Google
Drive and parsed as the source of truth; the live site is the thing under test.
A pass means the name, the reason and the source link the site returns match the
document the record was parsed from.

---

## 1. Real voter IDs — one booth per constituency

| Measure | Result |
|---|---|
| Booths sampled (1 per constituency) | 210 |
| Booth PDFs that failed to fetch | 0 |
| Booths with no deletions (expected) | 6 |
| EPICs checked (first + middle record per booth) | **407** |
| Found on the live site | **407 / 407** |
| Elector name matches the PDF | **407 / 407** |
| Reason matches the PDF | **407 / 407** |
| Source link resolves to the exact booth PDF | **404 / 407** |

The 3 exceptions are not defects. In Belgaum AC 3 and AC 4 the link opens the
district's **AC-wide consolidated list** rather than the booth file. Verified by
downloading the linked PDF and confirming each EPIC is present in it:

```
ZCI2527067  found in linked PDF  (AC: 4-Kagwad, 10,910 rows)
ZCI3623063  found in linked PDF  (AC: 4-Kagwad, 10,910 rows)
UEI4526935  found in linked PDF  (AC: 3-Athani,  9,463 rows)
```

Correct, but less useful — the citizen then has to find their row in a
ten-thousand-row document instead of a booth list. See finding **F1**.

## 2. Wrong and malformed voter IDs

| Input class | Cases | Passed |
|---|---|---|
| Well-formed but nonexistent (`ZZZ0000000`, `QQQ9999999`, plus 5 random digits on real prefixes `TXF/NMD/LXV/UTZ/JKX`) | 10 | **10** |
| Malformed (`HELLO`, `ABC12345`, `ABC123456789`, `1234567ABC`, `AB1234567`, `ABCD123456`, empty, `ABC 1234567`, `abc1234567`) | 9 | **9** |

No false positive: nothing that should be absent was reported as listed, and no
malformed input reached a lookup.

## 3. Chrome — end-to-end rendering

| Case | Input | Result |
|---|---|---|
| On the list | `ICP3864311` | Full card: name, relative, age, district, `164 — Gandhinagar`, booth `1 — Government Urdu Primary School…`, serial 3, reason `Permanently Shifted`, **working source PDF link** with booth name and generation date |
| Not on the list | `ZZQ4242424` | `– Not on the deleted list`, with the partial-coverage caveat |
| Malformed | `HELLO` | `Could not complete the check` → *"That is not a valid EPIC number. It must be 3 letters followed by 7 digits…"* |

Also confirmed live: SIR-corrected copy, brand palette, and the district →
constituency filter populated with all 32 districts.

---

## Findings

**F1 — Duplicate records where a district publishes both a consolidated and a
per-booth list.** `ZCI2527067` appears **twice** in its bucket: once from
Belgaum AC 4's 10,910-row consolidated list (labelled part 1) and once from its
booth file. Consequences: inflated counts for those districts, and the card
saying "more than one record matched" for a single deletion.
*Fixed* in stage 3 — one record per EPIC per constituency, preferring the more
specific file so the source link still opens the booth list. Statistics are now
tallied from the deduped buckets rather than during the read pass, because
counting there inflated every headline number for those districts.

**F2 — Bellary's 1,80,421 records are entirely unattributed (`AC ?`).** The
district publishes *only* consolidated lists (75 files), and those filenames
carry no AC or part number. It also shows up as a bogus `null AC ?` row in "top
constituencies". *Not yet fixed.* Note this is why a row-count threshold at
extract time is the wrong fix — it would delete the district outright.

**F3 — A court judgement was being parsed as a deletion table.**
`Copy of SIR JUDGEMENT 27 MAY 2026.pdf` (Chitradurga) was fetched and parsed as
if it were a booth list. *Fixed* — judgements, orders, affidavits, press notes
and booklets are now excluded from the crawl.

**F4 — Phantom constituency.** `AC 31` does not exist; the date folder
`31-07-2026` was read as "constituency 31, named 07-2026", filing 300 of
Muddebihal's booths under it. *Fixed in code*; the phantom persists in published
data until the next import.

**F5 — Constituency names.** 79 of 207 read `AC 167` because Drive folder names
are not AC-shaped. *Fixed* — names are read from the ECI's own line inside each
PDF (`AC: 209-Virajpet`), 201 of 224 identified, applied client-side so no
re-import is needed.

## Not covered by this run

- Vijayanagara and Bangalore Rural (no data published in a readable form)
- Roll-based "clear" verdict with elector details — no roll index is published
- 23 constituencies still without an official name; 3 of those carry data and
  fall back to readable folder names (`BGM Rural`, `Manvi`)
