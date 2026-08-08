/* Booth file naming. Split out from 1-discover so it can be tested directly:
   every unrecognised variant costs a constituency label on someone's result
   card, so the cases below are worth asserting rather than eyeballing. */

/**
 * Read a booth's identity out of its file name.
 *
 * Districts do not agree on a naming scheme, and each variant that goes
 * unrecognised costs a constituency label on the citizen's result card. The
 * canonical form is
 *
 *     S10_209_100_Govt Higher primary School, Halugunda_01_08_2026_16_23_25.pdf
 *
 * but Hassan publishes `AC 194_PS 1.pdf`, some files carry no timestamp at all,
 * and re-downloaded copies pick up a ` (1)` suffix. Each is tried in turn, and
 * the last resort still salvages the AC number, because a card that says
 * "Constituency 196" is far more use than one that says "AC ?".
 */
export function parseBoothName(fileName) {
  const bare = fileName.replace(/\.pdf$/i, '')
    // "... (1)" — a duplicate copy, not part of the booth's identity.
    .replace(/\s*\(\d+\)\s*$/, '');

  // Canonical, with generation timestamp.
  let m = /^([A-Z]\d+)_(\d+)_(\d+)_(.*)_(\d{2}_\d{2}_\d{4})_(\d{2}_\d{2}_\d{2})$/i.exec(bare);
  if (m) {
    const [dd, mm, yyyy] = m[5].split('_');
    const [hh, mi, ss] = m[6].split('_');
    return {
      stateCode: m[1],
      acNo: +m[2],
      partNo: +m[3],
      partName: m[4].replace(/\s+/g, ' ').trim(),
      generatedOn: m[5].replace(/_/g, '/'),
      // Sortable instant, so the freshest copy of a booth wins.
      stamp: Date.parse(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}Z`) || 0
    };
  }

  // Same shape, no timestamp.
  m = /^([A-Z]\d+)_(\d+)_(\d+)_(.+)$/i.exec(bare);
  if (m) {
    return {
      stateCode: m[1],
      acNo: +m[2],
      partNo: +m[3],
      partName: m[4].replace(/\s+/g, ' ').trim(),
      stamp: 0
    };
  }

  // Hassan: "AC 194_PS 1", "AC 194 PS 1", "AC194_1".
  m = /^AC[\s_-]*(\d{1,3})[\s_-]*(?:PS|PART|P)?[\s_.-]*(\d{1,4})$/i.exec(bare);
  if (m) {
    return { acNo: +m[1], partNo: +m[2], partName: '', stamp: 0 };
  }

  // Last resort: salvage the AC number from a `S10_196_...` prefix.
  m = /^[A-Z]\d+_(\d{1,3})_/i.exec(bare);
  if (m) {
    return { acNo: +m[1], partNo: null, partName: bare.replace(/\s+/g, ' ').trim(), stamp: 0 };
  }

  return { acNo: null, partNo: null, partName: bare.replace(/\s+/g, ' ').trim(), stamp: 0 };
}

// Documents published alongside the booth lists that are not booth lists.
// Parsing a guidance booklet as a deletion table yields nothing useful and
// pollutes the counts.
export const NOT_A_BOOTH_LIST = /booklet|guideline|instruction|manual|circular|notice|format|annexure/i;
