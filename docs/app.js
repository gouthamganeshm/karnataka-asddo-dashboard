/* Karnataka ASDDO dashboard — client.
 *
 * Everything here runs on a static host. There is no API: a lookup hashes the
 * EPIC, derives a bucket path from the hash prefix and fetches that one file.
 * The number the visitor types never crosses the network, which is the main
 * reason this design is worth the extra build machinery.
 */

const CATEGORIES = ['absent', 'shifted', 'death', 'duplicate', 'others'];
const EPIC_RE = /^[A-Z]{3}[0-9]{7}$/;

// --------------------------------------------------------------------- i18n

const STRINGS = {
  en: {
    skip: 'Skip to the EPIC check',
    title: 'Karnataka ASDDO Dashboard',
    tagline: 'Names removed from the voter roll — check your own, and see the scale',
    lookupHeading: 'Check a voter ID',
    intro: 'The ASDDO list records names removed from the electoral roll under five categories: Absent, Shifted, Death, Duplicate and Others. Enter an EPIC number to check whether it appears there.',
    catAbsent: 'Absent', catShifted: 'Shifted', catDeath: 'Death',
    catDuplicate: 'Duplicate', catOthers: 'Others',
    privacyNote: 'The number you type never leaves this device. The check runs in your browser against data files served by GitHub.',
    epicLabel: 'EPIC number',
    epicHelp: 'Printed on the front of your voter ID card. Exactly 3 letters followed by 7 digits.',
    checkBtn: 'Check this EPIC',
    checking: 'Checking',

    deletedHeading: 'This EPIC is on the ASDDO list',
    deletedLede: 'This voter ID appears among the names removed from the roll. Act on this now.',
    multipleNote: 'More than one record matched this EPIC number. All matches are shown below.',
    fieldName: 'Elector name', fieldRelative: 'Relative', fieldAge: 'Age',
    fieldDistrict: 'District', fieldAc: 'Constituency', fieldPart: 'Polling booth',
    fieldSerial: 'Serial number in the roll', fieldReason: 'Reason listed',
    fieldDup: 'Retained voter ID',
    fieldGender: 'Gender',
    sourcePdf: 'Open the official PDF this record came from',
    rollEntryHeading: 'Your entry on the electoral roll',
    clearNoDetails: 'This build indexes only whether the number exists, not the roll entry itself.',

    actionHeading: 'What to do now',
    actionSteps: [
      'Contact the Booth Level Officer (BLO) for your constituency and ask to see the deletion record.',
      'If the deletion is wrong, file Form 6 for re-inclusion with proof of identity and address.',
      'Call the voter helpline on 1950, or use voters.eci.gov.in to find your BLO and check your roll status.',
      'Do this before the claims and objections window closes — after the final roll is published it is much harder to correct.'
    ],
    copyBtn: 'Copy these details', copiedBtn: 'Copied', printBtn: 'Print / save as PDF',

    clearHeading: 'Not on the deleted list',
    clearLede: 'EPIC {epic} is in the electoral roll and is not marked for deletion.',
    clearNote: 'This covers ASDDO deletions only. If anything still looks wrong, confirm at voters.eci.gov.in or with your BLO.',

    notListedHeading: 'Not on the deleted list',
    notListedLede: 'EPIC {epic} does not appear in the ASDDO deletion data loaded here.',
    notListedNote: 'This build has no electoral-roll index, so it cannot confirm that the number exists at all — a typo would look exactly like this result. Check the number on your card, and confirm your roll status at voters.eci.gov.in.',
    notListedPartialNote: 'The roll index loaded here covers only about {coverage}% of electors — most entries in the published roll carry no standard EPIC number — so not finding this number says nothing about whether you are registered. It also cannot rule out a typo. Confirm your roll status at voters.eci.gov.in or with your BLO.',

    unknownHeading: 'This EPIC number was not found',
    unknownLede: 'EPIC {epic} matches no record in the electoral roll or the ASDDO list.',
    unknownNote: 'The most likely reason is a typing mistake — check the number printed on your card and enter it again exactly. If the number is definitely correct, a number missing from both lists needs looking into: contact your BLO or check voters.eci.gov.in.',

    outOfScopeHeading: 'Outside the data loaded here',
    outOfScopeLede: 'This build only covers {districts}. EPIC {epic} was not found, but a voter from another district would look the same.',

    errHeading: 'Could not complete the check',
    errInvalid: 'That is not a valid EPIC number. It must be 3 letters followed by 7 digits, for example ABC1234567.',
    errEmpty: 'Enter an EPIC number to check.',
    errNetwork: 'Could not load the data files. Check your connection and try again.',
    errCrypto: 'This browser cannot run the lookup (Web Crypto is unavailable). Open the site over https.',

    dashHeading: 'What is in this dataset',
    tileRecords: 'Names removed', tileDistricts: 'Districts', tileAcs: 'Constituencies', tileBooths: 'Polling booths',
    chartCategoryTitle: 'Deletions by reason',
    chartCategorySub: 'Every removed name, grouped into the five ASDDO buckets.',
    chartAgeTitle: 'Age of removed electors',
    chartAgeSub: 'Age as printed in the source list, at the time it was generated.',
    chartAcTitle: 'Constituencies with the most deletions',
    chartAcSub: 'Absolute counts. A large constituency will naturally sit higher — read this alongside the district table.',
    districtTitle: 'District breakdown', districtSub: 'Click a column heading to sort.',
    tableView: 'View as table',
    colDistrict: 'District', colTotal: 'Total', colShare: 'Share', colCategory: 'Category',
    colCount: 'Count', colBand: 'Age band', colConstituency: 'Constituency', colBooths: 'Booths',
    ageUnknown: 'Not stated',
    scopeNote: 'Covering {districts} · {booths} polling booths · generated {dates}',
    footerImported: 'Data imported {date} from documents generated {dates}.',
    footerSource: 'Source: the ASDDO lists published by the Chief Electoral Officer, Karnataka. This site is an independent, unofficial reformatting of those documents. Always confirm with your BLO or voters.eci.gov.in before acting.',
    footerLink: 'Original documents on ceo.karnataka.gov.in'
  },

  kn: {
    skip: 'EPIC ಪರಿಶೀಲನೆಗೆ ಹೋಗಿ',
    title: 'ಕರ್ನಾಟಕ ASDDO ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    tagline: 'ಮತದಾರರ ಪಟ್ಟಿಯಿಂದ ತೆಗೆದುಹಾಕಿದ ಹೆಸರುಗಳು — ನಿಮ್ಮದನ್ನು ಪರಿಶೀಲಿಸಿ',
    lookupHeading: 'ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ ಪರಿಶೀಲಿಸಿ',
    intro: 'ಮತದಾರರ ಪಟ್ಟಿಯಿಂದ ತೆಗೆದುಹಾಕಿದ ಹೆಸರುಗಳನ್ನು ASDDO ಪಟ್ಟಿ ಐದು ವರ್ಗಗಳಲ್ಲಿ ದಾಖಲಿಸುತ್ತದೆ: ಗೈರುಹಾಜರು, ಸ್ಥಳಾಂತರ, ಮರಣ, ನಕಲು ಮತ್ತು ಇತರೆ. ಅದರಲ್ಲಿ ಇದೆಯೇ ಎಂದು ಪರಿಶೀಲಿಸಲು EPIC ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.',
    catAbsent: 'ಗೈರುಹಾಜರು', catShifted: 'ಸ್ಥಳಾಂತರ', catDeath: 'ಮರಣ',
    catDuplicate: 'ನಕಲು', catOthers: 'ಇತರೆ',
    privacyNote: 'ನೀವು ನಮೂದಿಸುವ ಸಂಖ್ಯೆ ಈ ಸಾಧನದಿಂದ ಹೊರಗೆ ಹೋಗುವುದಿಲ್ಲ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿಯೇ ನಡೆಯುತ್ತದೆ.',
    epicLabel: 'EPIC ಸಂಖ್ಯೆ',
    epicHelp: 'ನಿಮ್ಮ ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿಯ ಮುಂಭಾಗದಲ್ಲಿ ಮುದ್ರಿತವಾಗಿರುತ್ತದೆ. ನಿಖರವಾಗಿ 3 ಅಕ್ಷರಗಳು ನಂತರ 7 ಅಂಕಿಗಳು.',
    checkBtn: 'ಪರಿಶೀಲಿಸಿ',
    checking: 'ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ',

    deletedHeading: 'ಈ EPIC ASDDO ಪಟ್ಟಿಯಲ್ಲಿ ಇದೆ',
    deletedLede: 'ಈ ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ ತೆಗೆದುಹಾಕಿದ ಹೆಸರುಗಳಲ್ಲಿ ಕಂಡುಬಂದಿದೆ. ಈಗಲೇ ಕ್ರಮ ತೆಗೆದುಕೊಳ್ಳಿ.',
    multipleNote: 'ಈ EPIC ಸಂಖ್ಯೆಗೆ ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ದಾಖಲೆಗಳು ಹೊಂದಿಕೆಯಾಗಿವೆ. ಎಲ್ಲವನ್ನೂ ಕೆಳಗೆ ತೋರಿಸಲಾಗಿದೆ.',
    fieldName: 'ಮತದಾರರ ಹೆಸರು', fieldRelative: 'ಸಂಬಂಧಿ', fieldAge: 'ವಯಸ್ಸು',
    fieldDistrict: 'ಜಿಲ್ಲೆ', fieldAc: 'ಕ್ಷೇತ್ರ', fieldPart: 'ಮತಗಟ್ಟೆ',
    fieldSerial: 'ಪಟ್ಟಿಯಲ್ಲಿ ಕ್ರಮ ಸಂಖ್ಯೆ', fieldReason: 'ನಮೂದಿಸಿದ ಕಾರಣ',
    fieldDup: 'ಉಳಿಸಿಕೊಂಡ ಗುರುತಿನ ಚೀಟಿ',
    fieldGender: 'ಲಿಂಗ',
    sourcePdf: 'ಈ ದಾಖಲೆ ಬಂದ ಅಧಿಕೃತ PDF ತೆರೆಯಿರಿ',
    rollEntryHeading: 'ಮತದಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ನಿಮ್ಮ ದಾಖಲೆ',
    clearNoDetails: 'ಈ ಆವೃತ್ತಿಯಲ್ಲಿ ಸಂಖ್ಯೆ ಇದೆಯೇ ಎಂಬುದನ್ನು ಮಾತ್ರ ಸೂಚಿಸಲಾಗಿದೆ, ಪಟ್ಟಿಯ ದಾಖಲೆಯ ವಿವರಗಳಲ್ಲ.',

    actionHeading: 'ಈಗ ಏನು ಮಾಡಬೇಕು',
    actionSteps: [
      'ನಿಮ್ಮ ಕ್ಷೇತ್ರದ ಬೂತ್ ಮಟ್ಟದ ಅಧಿಕಾರಿಯನ್ನು (BLO) ಸಂಪರ್ಕಿಸಿ ಮತ್ತು ಅಳಿಸುವಿಕೆ ದಾಖಲೆಯನ್ನು ತೋರಿಸಲು ಕೇಳಿ.',
      'ಅಳಿಸುವಿಕೆ ತಪ್ಪಾಗಿದ್ದರೆ, ಗುರುತು ಮತ್ತು ವಿಳಾಸದ ದಾಖಲೆಗಳೊಂದಿಗೆ ಮರುಸೇರ್ಪಡೆಗಾಗಿ ನಮೂನೆ 6 ಸಲ್ಲಿಸಿ.',
      'ಮತದಾರರ ಸಹಾಯವಾಣಿ 1950 ಗೆ ಕರೆ ಮಾಡಿ, ಅಥವಾ voters.eci.gov.in ನಲ್ಲಿ ನಿಮ್ಮ BLO ವಿವರ ಪರಿಶೀಲಿಸಿ.',
      'ಆಕ್ಷೇಪಣೆ ಸಲ್ಲಿಸುವ ಅವಧಿ ಮುಗಿಯುವ ಮೊದಲು ಇದನ್ನು ಮಾಡಿ — ಅಂತಿಮ ಪಟ್ಟಿ ಪ್ರಕಟವಾದ ನಂತರ ಸರಿಪಡಿಸುವುದು ಕಷ್ಟ.'
    ],
    copyBtn: 'ವಿವರಗಳನ್ನು ನಕಲಿಸಿ', copiedBtn: 'ನಕಲಾಗಿದೆ', printBtn: 'ಮುದ್ರಿಸಿ / PDF ಆಗಿ ಉಳಿಸಿ',

    clearHeading: 'ತೆಗೆದುಹಾಕಿದ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ',
    clearLede: 'EPIC {epic} ಮತದಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ಇದೆ ಮತ್ತು ತೆಗೆದುಹಾಕಲು ಗುರುತಿಸಿಲ್ಲ.',
    clearNote: 'ಇದು ASDDO ತೆಗೆದುಹಾಕುವಿಕೆಗಳನ್ನು ಮಾತ್ರ ಒಳಗೊಂಡಿದೆ. ಏನಾದರೂ ತಪ್ಪಾಗಿ ಕಂಡರೆ voters.eci.gov.in ನೋಡಿ ಅಥವಾ BLO ಸಂಪರ್ಕಿಸಿ.',

    notListedHeading: 'ತೆಗೆದುಹಾಕಿದ ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ',
    notListedLede: 'ಇಲ್ಲಿ ಲೋಡ್ ಆಗಿರುವ ASDDO ದತ್ತಾಂಶದಲ್ಲಿ EPIC {epic} ಕಂಡುಬಂದಿಲ್ಲ.',
    notListedNote: 'ಈ ಆವೃತ್ತಿಯಲ್ಲಿ ಮತದಾರರ ಪಟ್ಟಿಯ ಸೂಚಿಕೆ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಸಂಖ್ಯೆ ಅಸ್ತಿತ್ವದಲ್ಲಿದೆಯೇ ಎಂದು ಖಚಿತಪಡಿಸಲಾಗದು — ಟೈಪಿಂಗ್ ತಪ್ಪೂ ಹೀಗೆಯೇ ಕಾಣುತ್ತದೆ. ನಿಮ್ಮ ಚೀಟಿಯ ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ ಮತ್ತು voters.eci.gov.in ನೋಡಿ.',
    notListedPartialNote: 'ಇಲ್ಲಿ ಲೋಡ್ ಆದ ಪಟ್ಟಿಯ ಸೂಚಿಕೆ ಸುಮಾರು {coverage}% ಮತದಾರರನ್ನು ಮಾತ್ರ ಒಳಗೊಂಡಿದೆ — ಪ್ರಕಟಿತ ಪಟ್ಟಿಯ ಹೆಚ್ಚಿನ ದಾಖಲೆಗಳಲ್ಲಿ ಪ್ರಮಾಣಿತ EPIC ಸಂಖ್ಯೆ ಇಲ್ಲ — ಆದ್ದರಿಂದ ಈ ಸಂಖ್ಯೆ ಸಿಗದಿರುವುದು ನೀವು ನೋಂದಾಯಿತರಲ್ಲ ಎಂದು ಅರ್ಥವಲ್ಲ. voters.eci.gov.in ನಲ್ಲಿ ಅಥವಾ BLO ಬಳಿ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.',

    unknownHeading: 'ಈ EPIC ಸಂಖ್ಯೆ ಕಂಡುಬಂದಿಲ್ಲ',
    unknownLede: 'EPIC {epic} ಮತದಾರರ ಪಟ್ಟಿಯಲ್ಲಾಗಲಿ ASDDO ಪಟ್ಟಿಯಲ್ಲಾಗಲಿ ಕಂಡುಬಂದಿಲ್ಲ.',
    unknownNote: 'ಹೆಚ್ಚಾಗಿ ಟೈಪಿಂಗ್ ತಪ್ಪಾಗಿರಬಹುದು — ಚೀಟಿಯಲ್ಲಿ ಮುದ್ರಿತವಾದ ಸಂಖ್ಯೆಯನ್ನು ಮತ್ತೆ ನಿಖರವಾಗಿ ನಮೂದಿಸಿ. ಸಂಖ್ಯೆ ಸರಿಯಾಗಿದ್ದರೆ, ಎರಡೂ ಪಟ್ಟಿಗಳಲ್ಲಿ ಇಲ್ಲದಿರುವುದು ಗಂಭೀರ ವಿಷಯ: BLO ಸಂಪರ್ಕಿಸಿ ಅಥವಾ voters.eci.gov.in ನೋಡಿ.',

    outOfScopeHeading: 'ಇಲ್ಲಿ ಲೋಡ್ ಆದ ದತ್ತಾಂಶದ ಹೊರಗೆ',
    outOfScopeLede: 'ಈ ಆವೃತ್ತಿ {districts} ಮಾತ್ರ ಒಳಗೊಂಡಿದೆ. EPIC {epic} ಕಂಡುಬಂದಿಲ್ಲ, ಆದರೆ ಬೇರೆ ಜಿಲ್ಲೆಯ ಮತದಾರರೂ ಹೀಗೆಯೇ ಕಾಣುತ್ತಾರೆ.',

    errHeading: 'ಪರಿಶೀಲನೆ ಪೂರ್ಣಗೊಳಿಸಲಾಗಲಿಲ್ಲ',
    errInvalid: 'ಇದು ಸರಿಯಾದ EPIC ಸಂಖ್ಯೆ ಅಲ್ಲ. 3 ಅಕ್ಷರಗಳು ನಂತರ 7 ಅಂಕಿಗಳು ಇರಬೇಕು, ಉದಾಹರಣೆಗೆ ABC1234567.',
    errEmpty: 'ಪರಿಶೀಲಿಸಲು EPIC ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.',
    errNetwork: 'ದತ್ತಾಂಶ ಕಡತಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗಲಿಲ್ಲ. ಸಂಪರ್ಕ ಪರಿಶೀಲಿಸಿ ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.',
    errCrypto: 'ಈ ಬ್ರೌಸರ್‌ನಲ್ಲಿ ಪರಿಶೀಲನೆ ಸಾಧ್ಯವಿಲ್ಲ (Web Crypto ಲಭ್ಯವಿಲ್ಲ). https ಮೂಲಕ ತೆರೆಯಿರಿ.',

    dashHeading: 'ಈ ದತ್ತಾಂಶದಲ್ಲಿ ಏನಿದೆ',
    tileRecords: 'ತೆಗೆದುಹಾಕಿದ ಹೆಸರುಗಳು', tileDistricts: 'ಜಿಲ್ಲೆಗಳು', tileAcs: 'ಕ್ಷೇತ್ರಗಳು', tileBooths: 'ಮತಗಟ್ಟೆಗಳು',
    chartCategoryTitle: 'ಕಾರಣವಾರು ತೆಗೆದುಹಾಕುವಿಕೆ',
    chartCategorySub: 'ತೆಗೆದುಹಾಕಿದ ಪ್ರತಿ ಹೆಸರನ್ನು ಐದು ASDDO ವರ್ಗಗಳಲ್ಲಿ ಜೋಡಿಸಲಾಗಿದೆ.',
    chartAgeTitle: 'ತೆಗೆದುಹಾಕಿದ ಮತದಾರರ ವಯಸ್ಸು',
    chartAgeSub: 'ಮೂಲ ಪಟ್ಟಿಯಲ್ಲಿ ಮುದ್ರಿತವಾದ ವಯಸ್ಸು.',
    chartAcTitle: 'ಅತಿ ಹೆಚ್ಚು ತೆಗೆದುಹಾಕುವಿಕೆ ಇರುವ ಕ್ಷೇತ್ರಗಳು',
    chartAcSub: 'ಒಟ್ಟು ಸಂಖ್ಯೆ. ದೊಡ್ಡ ಕ್ಷೇತ್ರ ಸಹಜವಾಗಿ ಮೇಲಿರುತ್ತದೆ — ಜಿಲ್ಲಾ ಕೋಷ್ಟಕದೊಂದಿಗೆ ಓದಿ.',
    districtTitle: 'ಜಿಲ್ಲಾವಾರು ವಿವರ', districtSub: 'ವಿಂಗಡಿಸಲು ಶೀರ್ಷಿಕೆ ಕ್ಲಿಕ್ ಮಾಡಿ.',
    tableView: 'ಕೋಷ್ಟಕವಾಗಿ ನೋಡಿ',
    colDistrict: 'ಜಿಲ್ಲೆ', colTotal: 'ಒಟ್ಟು', colShare: 'ಪಾಲು', colCategory: 'ವರ್ಗ',
    colCount: 'ಸಂಖ್ಯೆ', colBand: 'ವಯಸ್ಸಿನ ಗುಂಪು', colConstituency: 'ಕ್ಷೇತ್ರ', colBooths: 'ಮತಗಟ್ಟೆಗಳು',
    ageUnknown: 'ನಮೂದಿಸಿಲ್ಲ',
    scopeNote: '{districts} · {booths} ಮತಗಟ್ಟೆಗಳು · ದಾಖಲೆ ದಿನಾಂಕ {dates}',
    footerImported: '{date} ರಂದು ಆಮದು ಮಾಡಲಾಗಿದೆ; ಮೂಲ ದಾಖಲೆಗಳ ದಿನಾಂಕ {dates}.',
    footerSource: 'ಮೂಲ: ಕರ್ನಾಟಕ ಮುಖ್ಯ ಚುನಾವಣಾ ಅಧಿಕಾರಿ ಪ್ರಕಟಿಸಿದ ASDDO ಪಟ್ಟಿಗಳು. ಇದು ಸ್ವತಂತ್ರ, ಅನಧಿಕೃತ ಮರುರೂಪಣೆ. ಕ್ರಮ ತೆಗೆದುಕೊಳ್ಳುವ ಮೊದಲು BLO ಅಥವಾ voters.eci.gov.in ನಲ್ಲಿ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.',
    footerLink: 'ceo.karnataka.gov.in ನಲ್ಲಿ ಮೂಲ ದಾಖಲೆಗಳು'
  }
};

let lang = 'en';
const t = (key) => STRINGS[lang][key] ?? STRINGS.en[key];
const fill = (tpl, values) => tpl.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');
const nf = () => new Intl.NumberFormat(lang === 'kn' ? 'kn-IN' : 'en-IN');

// ---------------------------------------------------------------- utilities

const $ = (sel) => document.querySelector(sel);
const el = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
};

let manifest = null;
let stats = null;
let lastResult = null;
const partsCache = new Map();

async function loadJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  return res.json();
}

async function sha256hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `abcd` -> `ab/cd.json`, matching scripts/3-build-site-data.mjs. */
const bucketPath = (prefix, ext) =>
  prefix.length > 2
    ? `${prefix.slice(0, 2)}/${prefix.slice(2)}.${ext}`
    : `${prefix}.${ext}`;

// ------------------------------------------------------------------- lookup

async function lookup(epic) {
  const hash = await sha256hex(epic);
  const prefix = hash.slice(0, manifest.shardDepth);
  const suffix = hash.slice(manifest.shardDepth, manifest.shardDepth + manifest.suffixLength);

  let bucket = [];
  try {
    bucket = await loadJson(`data/asddo/${bucketPath(prefix, 'json')}?v=${manifest.dataVersion}`);
  } catch (err) {
    // An absent bucket means "no deletions hash into this prefix" — not an error.
    if (err.status !== 404) throw err;
  }

  const matches = bucket.filter((record) => record[0] === suffix);
  if (matches.length) {
    const records = await Promise.all(matches.map(decodeRecord));
    return { kind: 'deleted', epic, records };
  }

  if (!manifest.hasRoll) return { kind: 'notListed', epic };

  const entry = await rollLookup(hash);
  if (!entry) {
    // Only a near-complete roll index earns the alarming "not found anywhere"
    // verdict. Most rows in the published roll CSVs carry no standard-format
    // EPIC at all, so on a partial index a miss says nothing about the voter —
    // and telling a validly registered person they are missing from the roll
    // is a worse failure than saying nothing.
    const coverage = manifest.rollCoverage ?? 100;
    return coverage < 95
      ? { kind: 'notListed', epic, partialRoll: true }
      : { kind: 'unknown', epic };
  }
  // `entry.details` is null when the roll was published existence-only.
  return { kind: 'clear', epic, record: entry.details };
}

/**
 * Look the EPIC up in the roll index. Returns null when absent, otherwise
 * `{ details }` — the elector's own roll entry when the index carries details,
 * or null details when it was built with --existence-only.
 */
async function rollLookup(hash) {
  const depth = manifest.rollShardDepth;
  const prefix = hash.slice(0, depth);

  if (!manifest.rollHasDetails) {
    return (await inRollBinary(hash, depth, prefix)) ? { details: null } : null;
  }

  const suffix = hash.slice(depth, depth + (manifest.rollSuffixLength ?? 8));
  let bucket;
  try {
    bucket = await loadJson(`data/roll/${bucketPath(prefix, 'json')}?v=${manifest.dataVersion}`);
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
  const row = bucket.find((r) => r[0] === suffix);
  return row ? { details: await decodeRollRecord(row) } : null;
}

/** Binary search of the sorted 4-byte hash suffixes in one existence-only bucket. */
async function inRollBinary(hash, depth, prefix) {
  let view;
  try {
    const res = await fetch(`data/roll/${bucketPath(prefix, 'bin')}?v=${manifest.dataVersion}`, { cache: 'no-cache' });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    view = new DataView(await res.arrayBuffer());
  } catch {
    return false;
  }

  const needle = parseInt(hash.slice(depth, depth + 8), 16) >>> 0;
  let lo = 0;
  let hi = view.byteLength / 4 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const value = view.getUint32(mid * 4, false);
    if (value === needle) return true;
    if (value < needle) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

let rollMeta = null;
const rollPartsCache = new Map();

async function decodeRollRecord(row) {
  const [, name, relative, relIdx, age, genderIdx, acNo, partNo, serial] = row;

  if (!rollMeta) {
    rollMeta = loadJson(`data/roll-meta.json?v=${manifest.dataVersion}`).catch(() => ({
      relations: [], genders: [], acs: {}
    }));
  }
  const meta = await rollMeta;

  if (!rollPartsCache.has(acNo)) {
    rollPartsCache.set(
      acNo,
      loadJson(`data/roll-parts/${acNo}.json?v=${manifest.dataVersion}`).catch(() => ({}))
    );
  }
  const parts = await rollPartsCache.get(acNo);
  const [acName, district] = meta.acs?.[acNo] ?? ['', ''];

  return {
    name,
    relative,
    relation: relIdx >= 0 ? meta.relations[relIdx] : '',
    age: age || null,
    gender: genderIdx >= 0 ? meta.genders[genderIdx] : '',
    district,
    acNo,
    acName,
    partNo,
    partName: parts?.[partNo] ?? '',
    serial
  };
}

async function decodeRecord(row) {
  const [, name, relative, relIdx, age, serial, reasonIdx, acIdx, partNo, dup] = row;
  const [acNo, acName, districtIdx] = manifest.dicts.acs[acIdx];

  let part = null;
  if (!partsCache.has(acIdx)) {
    partsCache.set(
      acIdx,
      loadJson(`data/parts/${acIdx}.json?v=${manifest.dataVersion}`).catch(() => ({}))
    );
  }
  const parts = await partsCache.get(acIdx);
  if (parts && parts[partNo]) part = parts[partNo];

  return {
    name,
    relative,
    relation: relIdx >= 0 ? manifest.dicts.relations[relIdx] : '',
    age: age || null,
    serial,
    reason: manifest.dicts.reasons[reasonIdx],
    district: manifest.dicts.districts[districtIdx],
    acNo,
    acName,
    partNo,
    partName: part ? part[0] : '',
    fileId: part ? part[1] : '',
    generatedOn: part ? part[2] : '',
    dup
  };
}

// ------------------------------------------------------------------- result

const resultEl = () => $('#result');

function renderResult(data) {
  lastResult = data;
  const host = resultEl();
  host.innerHTML = '';
  host.hidden = false;

  if (data.kind === 'deleted') renderDeleted(host, data);
  else if (data.kind === 'clear') renderClear(host, data);
  else if (data.kind === 'notListed') {
    renderVerdict(host, data, 'is-caution', '–', 'notListedHeading', 'notListedLede',
      data.partialRoll ? 'notListedPartialNote' : 'notListedNote');
  }
  else if (data.kind === 'unknown') renderVerdict(host, data, 'is-problem', '?', 'unknownHeading', 'unknownLede', 'unknownNote');
  else {
    const card = el('div', 'result-card is-problem');
    card.appendChild(el('h2', null, t('errHeading')));
    card.appendChild(el('p', 'lede', data.message));
    host.appendChild(card);
  }

  host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function ledeWithEpic(template, epic) {
  const p = el('p', 'lede');
  const parts = template.split('{epic}');
  p.appendChild(document.createTextNode(parts[0]));
  p.appendChild(el('span', 'searched-epic', epic));
  if (parts[1]) p.appendChild(document.createTextNode(parts[1]));
  return p;
}

function renderVerdict(host, data, variant, mark, heading, lede, note) {
  const card = el('div', `result-card ${variant}`);
  card.appendChild(el('h2', null, `${mark}  ${t(heading)}`));
  card.appendChild(ledeWithEpic(t(lede), data.epic));
  card.appendChild(el('p', 'next-steps',
    fill(t(note), { coverage: manifest?.rollCoverage ?? '' })));
  host.appendChild(card);
}

/**
 * Not deleted. When the roll index carries details, show the elector their own
 * entry — an all-clear is far more convincing when the person can see that the
 * name, booth and serial number are actually theirs.
 */
function renderClear(host, data) {
  const card = el('div', 'result-card is-clear');
  card.appendChild(el('h2', null, `✓  ${t('clearHeading')}`));
  card.appendChild(ledeWithEpic(t('clearLede'), data.epic));

  const r = data.record;
  if (r) {
    const box = el('div', 'record');
    box.appendChild(el('h3', 'record-heading', t('rollEntryHeading')));
    const dl = document.createElement('dl');
    const rows = [
      [t('fieldName'), r.name],
      ['EPIC', data.epic],
      [t('fieldRelative'), r.relative ? `${r.relative}${r.relation ? ` (${r.relation})` : ''}` : ''],
      [t('fieldAge'), r.age ? nf().format(r.age) : ''],
      [t('fieldGender'), r.gender],
      [t('fieldDistrict'), r.district ? titleCase(r.district) : ''],
      // Deliberately no number: the roll CSVs are keyed by the CEO's internal
      // file index (A209 is Athani, not AC 209), which would read as an
      // official constituency number and be wrong.
      [t('fieldAc'), titleCase(r.acName)],
      [t('fieldPart'), r.partNo ? `${r.partNo}${r.partName ? ` — ${r.partName}` : ''}` : ''],
      [t('fieldSerial'), r.serial ? nf().format(r.serial) : '']
    ];
    for (const [term, value] of rows) {
      if (!value) continue;
      dl.appendChild(el('dt', null, term));
      dl.appendChild(el('dd', term === 'EPIC' ? 'epic-value' : null, value));
    }
    box.appendChild(dl);
    card.appendChild(box);
  } else if (manifest.hasRoll) {
    card.appendChild(el('p', 'next-steps', t('clearNoDetails')));
  }

  card.appendChild(el('p', 'next-steps', t('clearNote')));
  host.appendChild(card);
}

function renderDeleted(host, data) {
  const card = el('div', 'result-card is-deleted');
  card.appendChild(el('h2', null, `⚠️  ${t('deletedHeading')}`));
  card.appendChild(el('p', 'lede', t('deletedLede')));
  if (data.records.length > 1) card.appendChild(el('p', 'next-steps', t('multipleNote')));

  for (const record of data.records) {
    const box = el('div', 'record');
    const dl = document.createElement('dl');
    const rows = [
      [t('fieldName'), record.name],
      ['EPIC', data.epic],
      [t('fieldRelative'), record.relative ? `${record.relative}${record.relation ? ` (${record.relation})` : ''}` : ''],
      [t('fieldAge'), record.age ? nf().format(record.age) : ''],
      [t('fieldDistrict'), record.district],
      [t('fieldAc'), record.acNo ? `${record.acNo} — ${record.acName}` : record.acName],
      [t('fieldPart'), record.partNo ? `${record.partNo}${record.partName ? ` — ${record.partName}` : ''}` : ''],
      [t('fieldSerial'), record.serial ? nf().format(record.serial) : ''],
      [t('fieldDup'), record.dup]
    ];
    for (const [term, value] of rows) {
      if (!value) continue;
      dl.appendChild(el('dt', null, term));
      dl.appendChild(el('dd', term === 'EPIC' ? 'epic-value' : null, value));
    }
    dl.appendChild(el('dt', null, t('fieldReason')));
    const dd = el('dd', 'reason');
    dd.appendChild(el('span', 'dot', ''));
    dd.lastChild.dataset.cat = categoryOf(record.reason);
    dd.appendChild(document.createTextNode(record.reason));
    dl.appendChild(dd);
    box.appendChild(dl);

    // Linking the source document is the difference between "a website says
    // so" and evidence you can take to a BLO.
    if (record.fileId) {
      const link = el('a', 'source-link', `${t('sourcePdf')} ↗`);
      link.href = `https://drive.google.com/file/d/${record.fileId}/view`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      box.appendChild(link);
    }
    card.appendChild(box);
  }

  const action = el('div', 'action-block');
  action.appendChild(el('h3', null, t('actionHeading')));
  const ol = document.createElement('ol');
  for (const step of t('actionSteps')) ol.appendChild(el('li', null, step));
  action.appendChild(ol);

  const buttons = el('div', 'result-actions');
  const copyBtn = el('button', 'ghost-btn', t('copyBtn'));
  copyBtn.type = 'button';
  copyBtn.addEventListener('click', async () => {
    await navigator.clipboard.writeText(asPlainText(data));
    copyBtn.textContent = t('copiedBtn');
    setTimeout(() => { copyBtn.textContent = t('copyBtn'); }, 2000);
  });
  const printBtn = el('button', 'ghost-btn', t('printBtn'));
  printBtn.type = 'button';
  printBtn.addEventListener('click', () => window.print());
  buttons.append(copyBtn, printBtn);
  action.appendChild(buttons);

  card.appendChild(action);
  host.appendChild(card);
}

function asPlainText(data) {
  const lines = [`${t('deletedHeading')} — EPIC ${data.epic}`, ''];
  for (const r of data.records) {
    lines.push(
      `${t('fieldName')}: ${r.name}`,
      `${t('fieldRelative')}: ${r.relative}${r.relation ? ` (${r.relation})` : ''}`,
      `${t('fieldAge')}: ${r.age ?? '-'}`,
      `${t('fieldDistrict')}: ${r.district}`,
      `${t('fieldAc')}: ${r.acNo} — ${r.acName}`,
      `${t('fieldPart')}: ${r.partNo} — ${r.partName}`,
      `${t('fieldSerial')}: ${r.serial}`,
      `${t('fieldReason')}: ${r.reason}`,
      r.fileId ? `Source: https://drive.google.com/file/d/${r.fileId}/view` : '',
      ''
    );
  }
  return lines.filter((l) => l !== undefined).join('\n');
}

/** Reverse of scripts/lib/pdf.mjs categorise(), for the colour dot only. */
function categoryOf(reason) {
  const r = (reason || '').toLowerCase();
  if (/already enrolled|duplicate|repeat/.test(r)) return 'duplicate';
  if (/death|dead|expired|deceased/.test(r)) return 'death';
  if (/shift|migrat|moved|permanent/.test(r)) return 'shifted';
  if (/absent|untrace|not found/.test(r)) return 'absent';
  return 'others';
}

// ---------------------------------------------------------------- dashboard

function renderDashboard() {
  const total = stats.total;
  const counts = manifest.counts;

  const tiles = [
    ['tileRecords', counts.records],
    ['tileDistricts', counts.districts],
    ['tileAcs', counts.constituencies],
    ['tileBooths', counts.booths]
  ];
  const tileHost = $('#tiles');
  tileHost.innerHTML = '';
  for (const [key, value] of tiles) {
    const tile = el('div', 'tile');
    tile.appendChild(el('div', 'tile-value', nf().format(value)));
    tile.appendChild(el('div', 'tile-label', t(key)));
    tileHost.appendChild(tile);
  }

  $('#dash-scope').textContent = fill(t('scopeNote'), {
    districts: stats.districts.map((d) => titleCase(d.name)).join(', '),
    booths: nf().format(counts.booths),
    dates: stats.generatedOn.join(', ') || '—'
  });

  // --- by category
  const catData = CATEGORIES.map((c) => ({
    key: c,
    label: t(`cat${c[0].toUpperCase()}${c.slice(1)}`),
    value: stats.byCategory[c],
    color: `var(--cat-${c})`
  })).sort((a, b) => b.value - a.value);
  barChart($('#chart-category'), catData, total);
  simpleTable($('#table-category'), [t('colCategory'), t('colCount'), t('colShare')],
    catData.map((d) => [d.label, nf().format(d.value), pct(d.value, total)]));

  // --- by age band
  const bandLabel = (k) => (k === 'unknown' ? t('ageUnknown') : k);
  const ageData = Object.entries(stats.ageBands)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ key: k, label: bandLabel(k), value: v, color: 'var(--series-seq)' }));
  barChart($('#chart-age'), ageData, total);
  simpleTable($('#table-age'), [t('colBand'), t('colCount'), t('colShare')],
    ageData.map((d) => [d.label, nf().format(d.value), pct(d.value, total)]));

  // --- top constituencies
  const acData = stats.topConstituencies.slice(0, 12).map((a) => ({
    key: `${a.no}`,
    label: `${a.no} ${a.name}`,
    sub: titleCase(a.district),
    value: a.total,
    color: 'var(--series-seq)'
  }));
  barChart($('#chart-ac'), acData, total, Math.max(...acData.map((a) => a.value)));
  simpleTable($('#table-ac'), [t('colConstituency'), t('colDistrict'), t('colCount')],
    stats.topConstituencies.map((a) => [`${a.no} ${a.name}`, titleCase(a.district), nf().format(a.total)]));

  renderDistrictLegend();
  renderDistrictTable();
}

const pct = (n, total) => `${((n / total) * 100).toFixed(1)}%`;
const titleCase = (s) =>
  s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/**
 * Horizontal bars in plain HTML. Horizontal because the labels are long words,
 * not dates — rotated axis text is a readability tax nobody should pay. Values
 * are direct-labelled on every bar, which is also the relief the palette needs:
 * three of the five category hues sit under 3:1 on the light surface, so colour
 * is never the only thing carrying the number.
 */
function barChart(host, data, shareOf, barMax = null) {
  host.innerHTML = '';
  // Bar length and the printed percentage are separate scales on purpose: a
  // "top 12" chart is drawn against its own largest bar, but the percentage
  // beside it must still read against the whole dataset, or 100% would mean
  // "biggest of these twelve" while looking like "all deletions".
  const max = (barMax ?? Math.max(shareOf, ...data.map((d) => d.value))) || 1;
  const chart = el('div', 'bars');

  for (const d of data) {
    const row = el('div', 'bar-row');
    row.tabIndex = 0;
    row.setAttribute('role', 'listitem');
    row.setAttribute('aria-label', `${d.label}: ${nf().format(d.value)} (${pct(d.value, shareOf)})`);

    const label = el('div', 'bar-label');
    label.appendChild(el('span', 'bar-label-main', d.label));
    if (d.sub) label.appendChild(el('span', 'bar-label-sub', d.sub));

    const track = el('div', 'bar-track');
    const fillEl = el('div', 'bar-fill');
    fillEl.style.width = `${Math.max((d.value / max) * 100, 0.5)}%`;
    fillEl.style.background = d.color;
    track.appendChild(fillEl);

    const value = el('div', 'bar-value');
    value.appendChild(el('span', 'bar-value-main', nf().format(d.value)));
    value.appendChild(el('span', 'bar-value-sub', pct(d.value, shareOf)));

    row.append(label, track, value);
    attachTip(row, `${d.label}${d.sub ? ` · ${d.sub}` : ''}\n${nf().format(d.value)} · ${pct(d.value, shareOf)}`);
    chart.appendChild(row);
  }
  chart.setAttribute('role', 'list');
  host.appendChild(chart);
}

function simpleTable(host, headers, rows) {
  host.innerHTML = '';
  const table = el('table', 'data-table');
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of headers) hr.appendChild(el('th', null, h));
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const tr = document.createElement('tr');
    row.forEach((cell, i) => tr.appendChild(el('td', i ? 'num' : null, cell)));
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  host.appendChild(table);
}

function renderDistrictLegend() {
  const host = $('#district-legend');
  host.innerHTML = '';
  for (const c of CATEGORIES) {
    const item = el('span', 'legend-item');
    const dot = el('span', 'dot');
    dot.dataset.cat = c;
    item.append(dot, el('span', null, t(`cat${c[0].toUpperCase()}${c.slice(1)}`)));
    host.appendChild(item);
  }
}

let districtSort = { key: 'total', dir: -1 };

function renderDistrictTable() {
  const table = $('#district-table');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const columns = [
    { key: 'name', label: t('colDistrict') },
    { key: 'total', label: t('colTotal'), num: true },
    ...CATEGORIES.map((c) => ({ key: c, label: t(`cat${c[0].toUpperCase()}${c.slice(1)}`), num: true })),
    { key: 'mix', label: t('colShare') }
  ];

  const hr = document.createElement('tr');
  for (const col of columns) {
    const th = el('th', col.num ? 'num' : null, col.label);
    if (col.key !== 'mix') {
      th.tabIndex = 0;
      th.classList.add('sortable');
      if (districtSort.key === col.key) th.dataset.sort = districtSort.dir === 1 ? 'asc' : 'desc';
      const sort = () => {
        districtSort = {
          key: col.key,
          dir: districtSort.key === col.key ? -districtSort.dir : -1
        };
        renderDistrictTable();
      };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    }
    hr.appendChild(th);
  }
  thead.appendChild(hr);

  const rows = [...stats.districts].sort((a, b) => {
    const [x, y] = [a[districtSort.key], b[districtSort.key]];
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * districtSort.dir;
  });

  for (const d of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, titleCase(d.name)));
    tr.appendChild(el('td', 'num strong', nf().format(d.total)));
    for (const c of CATEGORIES) tr.appendChild(el('td', 'num', nf().format(d[c])));

    // A 100% stacked strip: proportions at a glance without a second chart.
    const mix = el('td', 'mix-cell');
    const strip = el('div', 'mix');
    for (const c of CATEGORIES) {
      if (!d[c]) continue;
      const seg = el('div', 'mix-seg');
      seg.style.width = `${(d[c] / d.total) * 100}%`;
      seg.style.background = `var(--cat-${c})`;
      attachTip(seg, `${titleCase(d.name)} · ${t(`cat${c[0].toUpperCase()}${c.slice(1)}`)}\n${nf().format(d[c])} · ${pct(d[c], d.total)}`);
      strip.appendChild(seg);
    }
    mix.appendChild(strip);
    tr.appendChild(mix);
    tbody.appendChild(tr);
  }
}

// ------------------------------------------------------------------ tooltip

let tip = null;
function attachTip(node, text) {
  node.addEventListener('pointerenter', (e) => {
    if (!tip) {
      tip = el('div', 'tip');
      document.body.appendChild(tip);
    }
    tip.textContent = text;
    tip.hidden = false;
    moveTip(e);
  });
  node.addEventListener('pointermove', moveTip);
  node.addEventListener('pointerleave', () => { if (tip) tip.hidden = true; });
}
function moveTip(e) {
  if (!tip) return;
  const pad = 14;
  const x = Math.min(e.clientX + pad, window.innerWidth - tip.offsetWidth - 8);
  const y = Math.max(e.clientY - tip.offsetHeight - pad, 8);
  tip.style.transform = `translate(${x}px, ${y}px)`;
}

// -------------------------------------------------------------- language/theme

function applyLanguage() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-i18n]')) {
    const value = STRINGS[lang][node.getAttribute('data-i18n')];
    if (typeof value === 'string') node.textContent = value;
  }
  for (const btn of document.querySelectorAll('.switch-btn')) {
    btn.classList.toggle('is-active', btn.dataset.lang === lang);
  }
  if (stats) {
    renderDashboard();
    renderFooterMeta();
  }
  if (lastResult) renderResult(lastResult); // keep the answer on screen
}

function renderFooterMeta() {
  const d = new Date(manifest.importedAt);
  $('#footer-meta').textContent = fill(t('footerImported'), {
    date: d.toLocaleDateString(lang === 'kn' ? 'kn-IN' : 'en-IN', { year: 'numeric', month: 'long', day: 'numeric' }),
    dates: stats.generatedOn.join(', ') || '—'
  });
}

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  $('#theme-icon').textContent = theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐';
  try { localStorage.setItem('asddo-theme', theme); } catch { /* private mode */ }
}

// --------------------------------------------------------------------- boot

let busy = false;

function setBusy(state) {
  busy = state;
  const btn = $('#submit-btn');
  btn.disabled = state;
  btn.innerHTML = '';
  if (state) {
    btn.appendChild(el('span', 'spinner'));
    btn.appendChild(document.createTextNode(`${t('checking')}…`));
  } else {
    const span = el('span', null, t('checkBtn'));
    span.setAttribute('data-i18n', 'checkBtn');
    btn.appendChild(span);
  }
}

$('#lookup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (busy) return;

  const input = $('#epic');
  const epic = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!epic) {
    renderResult({ kind: 'problem', message: t('errEmpty') });
    input.focus();
    return;
  }
  // Refusing malformed input is what stops a typed name returning "not on the
  // deleted list", which reads as an all-clear to someone who may be deleted.
  if (!EPIC_RE.test(epic)) {
    renderResult({ kind: 'problem', message: t('errInvalid') });
    input.focus();
    return;
  }
  if (!globalThis.crypto?.subtle) {
    renderResult({ kind: 'problem', message: t('errCrypto') });
    return;
  }

  setBusy(true);
  try {
    renderResult(await lookup(epic));
  } catch {
    renderResult({ kind: 'problem', message: t('errNetwork') });
  } finally {
    setBusy(false);
  }
});

$('#epic').addEventListener('input', function () {
  const start = this.selectionStart;
  const upper = this.value.toUpperCase();
  if (upper !== this.value) {
    this.value = upper;
    this.setSelectionRange(start, start);
  }
});

for (const btn of document.querySelectorAll('.switch-btn')) {
  btn.addEventListener('click', () => {
    lang = btn.dataset.lang;
    try { localStorage.setItem('asddo-lang', lang); } catch { /* private mode */ }
    applyLanguage();
  });
}

$('#theme-btn').addEventListener('click', () => {
  const order = ['system', 'light', 'dark'];
  const current = localStorage.getItem('asddo-theme') ?? 'system';
  applyTheme(order[(order.indexOf(current) + 1) % order.length]);
});

try {
  const savedLang = localStorage.getItem('asddo-lang');
  if (savedLang && STRINGS[savedLang]) lang = savedLang;
  applyTheme(localStorage.getItem('asddo-theme') ?? 'system');
} catch { /* private mode */ }

applyLanguage();

try {
  [manifest, stats] = await Promise.all([
    loadJson('data/manifest.json'),
    loadJson('data/stats.json')
  ]);
  renderDashboard();
  renderFooterMeta();
} catch {
  $('#dash-scope').textContent = t('errNetwork');
}
