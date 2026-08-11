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
    tagline: 'The ASDDO list published under the ECI\u2019s Special Intensive Revision — check your voter ID',
    lookupHeading: 'Check a voter ID',
    intro: 'As part of the Election Commission\u2019s Special Intensive Revision (SIR) in Karnataka, an ASDDO list has been published \u2014 electors marked Absent, Shifted, Dead, Duplicate or Others. Being on this list does not by itself mean your name has been deleted: it means your entry has been flagged for verification. Enter an EPIC number to check.',
    catAbsent: 'Absent', catShifted: 'Shifted', catDeath: 'Dead',
    catDuplicate: 'Duplicate', catOthers: 'Others',
    privacyNote: 'The number you type never leaves this device. The check runs in your browser against data files served by GitHub.',
    epicLabel: 'EPIC number',
    epicHelp: 'Printed on the front of your voter ID card. Exactly 3 letters followed by 7 digits.',
    checkBtn: 'Check this EPIC',
    searchBtn: 'Search the ASDDO list',
    checking: 'Checking',

    modeEpic: 'By EPIC number', modeSerial: 'By serial number', modeName: 'By name',
    selDistrictLabel: 'District', selAcLabel: 'Constituency', selBoothLabel: 'Polling booth',
    selDistrictPlaceholder: 'Select a district…', selAcPlaceholder: 'Select a constituency…', selBoothPlaceholder: 'Select a booth…',
    serialLabel: 'Serial number in the roll',
    serialHelp: 'The serial number printed against the name in that booth’s list.',
    nameLabel: 'Name',
    nameHelp: 'Type part of the name as printed on the roll. The voter ID is never shown.',
    searchNote: 'Searching by name or serial reads the public ASDDO list. It never reveals a voter ID number.',
    errPickDistrict: 'Choose a district first.',
    errPickAc: 'Choose a constituency.',
    errPickBooth: 'Choose a polling booth.',
    errSerialEmpty: 'Enter the serial number to look up.',
    errNameShort: 'Enter at least two letters of the name.',
    searchResultsHeading: '{n} on the ASDDO list match “{q}”',
    searchResultsHeadingOne: '1 on the ASDDO list matches “{q}”',
    searchResultsCapped: 'Showing the first {shown}. Narrow the name to see fewer.',
    searchResultsIn: 'in {ac}',
    resultOpen: 'View full record',
    backToResults: '‹ Back to results',
    searchNoMatchNameHeading: 'No match on the ASDDO list',
    searchNoMatchName: 'No name containing “{q}” is on the ASDDO list for {ac}. That is the expected result if the voter is not flagged.',
    searchNoMatchSerialHeading: 'Not on the ASDDO list',
    searchNoMatchSerial: 'Serial {serial} in {booth} is not on the ASDDO list. That is the expected result if the voter is not flagged.',

    deletedHeading: 'This EPIC is on the ASDDO list',
    deletedLede: 'This voter ID has been flagged for verification under SIR. That does not by itself mean your name has been deleted \u2014 but it does need acting on now.',
    multipleNote: 'More than one record matched this EPIC number. All matches are shown below.',
    fieldName: 'Elector name', fieldRelative: 'Relative', fieldAge: 'Age',
    fieldDistrict: 'District', fieldAc: 'Constituency', fieldPart: 'Polling booth',
    fieldSerial: 'Serial number in the roll', fieldReason: 'Reason listed',
    fieldBlo: 'Your Booth Level Officer (BLO)',
    bloNote: 'BLO postings change during the revision — if this looks wrong or out of date, confirm at',
    fieldDup: 'Retained voter ID',
    fieldGender: 'Gender',
    sourcePdf: 'Open the official PDF this record came from',
    sourceGenerated: 'generated',
    sourceMissing: 'The source document for this record could not be identified. Ask your BLO for the ASDDO list for your booth.',
    rollEntryHeading: 'Your entry on the electoral roll',
    clearNoDetails: 'This build indexes only whether the number exists, not the roll entry itself.',

    actionHeading: 'What to do now',
    actionSteps: [
      'Contact your Booth Level Officer (BLO) and give them documents proving your identity and address, so the entry can be verified.',
      'Check your entry on the CEO Karnataka portal at ceo.karnataka.gov.in, or at voters.eci.gov.in.',
      'The revised draft electoral roll is due on 17 August. Act before then \u2014 corrections are much harder once the final roll is published.',
      'If your name is wrongly dropped, file Form 6 for re-inclusion, or call the voter helpline on 1950.'
    ],
    copyBtn: 'Copy these details', copiedBtn: 'Copied', printBtn: 'Print / save as PDF',

    clearHeading: 'Not found in the ASDDO list',
    clearLede: 'EPIC {epic} is on the electoral roll and is not on the ASDDO list.',
    clearNote: 'This covers the ASDDO list only. If anything still looks wrong, confirm at ceo.karnataka.gov.in, voters.eci.gov.in, or with your BLO.',

    notListedHeading: 'Not found in the ASDDO list',
    notListedLede: 'EPIC {epic} does not appear in the ASDDO deletion data loaded here.',
    notListedNote: 'This build has no electoral-roll index, so it cannot confirm that the number exists at all — a typo would look exactly like this result. Check the number on your card, and confirm your roll status at voters.eci.gov.in.',
    notListedPartialNote: 'The roll index loaded here covers only about {coverage}% of electors — most entries in the published roll carry no standard EPIC number — so not finding this number says nothing about whether you are registered. It also cannot rule out a typo. Confirm your roll status at voters.eci.gov.in or with your BLO.',
    coverageGapNote: 'Scope: {loaded} of {total} districts are loaded here. Not loaded: {missing}. If yours is on that list, this result tells you nothing — check the source page at ceo.karnataka.gov.in/asddo.html directly.',
    listSeparator: ', ',

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
    tileRecords: 'Names on the list', tileDistricts: 'Districts', tileAcs: 'Constituencies', tileBooths: 'Polling booths',
    chartCategoryTitle: 'Listings by reason',
    chartCategorySub: 'Every listed name, grouped into the five ASDDO categories.',
    chartAgeTitle: 'Age of listed electors',
    chartAgeSub: 'Age as printed in the source list, at the time it was generated.',
    chartAcTitle: 'Constituencies with the most listings',
    chartAcSub: 'Absolute counts. A large constituency will naturally sit higher — read this alongside the district table.',
    districtTitle: 'District breakdown', districtSub: 'Click a column heading to sort.',
    tableView: 'View as table',
    colDistrict: 'District', colTotal: 'Total', colShare: 'Share', colCategory: 'Category',
    filterDistrict: 'District', filterConstituency: 'Constituency',
    filterAll: 'All', filterReset: 'Reset', filterNoRows: 'Nothing matches this filter.',
    districtSubFiltered: 'Showing constituencies in {district}. Click a column heading to sort.',
    colCount: 'Count', colBand: 'Age band', colConstituency: 'Constituency', colBooths: 'Booths',
    ageUnknown: 'Not stated',
    scopeNote: 'Covering {districts} · {booths} polling booths · generated {dates}',
    footerImported: 'Data imported {date} from documents generated {dates}.',
    footerSource: 'Source: the ASDDO lists published by the Chief Electoral Officer, Karnataka, under the Special Intensive Revision. This site is an independent, unofficial reformatting of those documents. Always confirm with your BLO, ceo.karnataka.gov.in or voters.eci.gov.in before acting.',
    footerLink: 'Original documents on ceo.karnataka.gov.in',
    footerPressRelease: 'Latest CEO Karnataka press release ({date})',
    provenancePulled: 'Data pulled {datetime} from the CEO Karnataka ASDDO lists ({source}).',
    officialCompare: 'CEO Karnataka reports {official} electors marked ASDDO as on {asOf}. This site has processed {captured} of them ({pct}%) — the rest are in booth lists not yet published or not machine-readable. See the {link}.',
    pressReleaseWord: 'latest press release'
  },

  kn: {
    skip: 'EPIC ಪರಿಶೀಲನೆಗೆ ಹೋಗಿ',
    title: 'ಕರ್ನಾಟಕ ASDDO ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    tagline: 'SIR ಪ್ರಕ್ರಿಯೆಯಲ್ಲಿ ಬಿಡುಗಡೆಯಾದ ASDDO ಪಟ್ಟಿ — ನಿಮ್ಮ ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ ಪರಿಶೀಲಿಸಿ',
    lookupHeading: 'ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ ಪರಿಶೀಲಿಸಿ',
    intro: 'ಕರ್ನಾಟಕದಲ್ಲಿ ಚುನಾವಣಾ ಆಯೋಗವು ನಡೆಸುತ್ತಿರುವ SIR (ವಿಶೇಷ ತೀವ್ರ ಮತದಾರರ ಪಟ್ಟಿ ಪರಿಷ್ಕರಣೆ) ಪ್ರಕ್ರಿಯೆಯಲ್ಲಿ ASDDO (ಗೈರುಹಾಜರಾದ, ಸ್ಥಳಾಂತರಗೊಂಡ, ಮೃತ, ನಕಲಿ ಮತ್ತು ಇತರೆ) ಪಟ್ಟಿಯನ್ನು ಬಿಡುಗಡೆ ಮಾಡಲಾಗಿದೆ. ಈ ಪಟ್ಟಿಯಲ್ಲಿ ಹೆಸರಿದ್ದರೆ ನಿಮ್ಮ ಹೆಸರು ಡಿಲೀಟ್ ಆಗುತ್ತದೆ ಎಂದಲ್ಲ — ಪರಿಶೀಲನೆಗೆ ಗುರಿಯಾಗಿದೆ ಎಂದರ್ಥ. ಪರಿಶೀಲಿಸಲು EPIC ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.',
    catAbsent: 'ಗೈರುಹಾಜರು', catShifted: 'ಸ್ಥಳಾಂತರ', catDeath: 'ಮರಣ',
    catDuplicate: 'ನಕಲು', catOthers: 'ಇತರೆ',
    privacyNote: 'ನೀವು ನಮೂದಿಸುವ ಸಂಖ್ಯೆ ಈ ಸಾಧನದಿಂದ ಹೊರಗೆ ಹೋಗುವುದಿಲ್ಲ. ಪರಿಶೀಲನೆ ನಿಮ್ಮ ಬ್ರೌಸರ್‌ನಲ್ಲಿಯೇ ನಡೆಯುತ್ತದೆ.',
    epicLabel: 'EPIC ಸಂಖ್ಯೆ',
    epicHelp: 'ನಿಮ್ಮ ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿಯ ಮುಂಭಾಗದಲ್ಲಿ ಮುದ್ರಿತವಾಗಿರುತ್ತದೆ. ನಿಖರವಾಗಿ 3 ಅಕ್ಷರಗಳು ನಂತರ 7 ಅಂಕಿಗಳು.',
    checkBtn: 'ಪರಿಶೀಲಿಸಿ',
    searchBtn: 'ASDDO ಪಟ್ಟಿ ಹುಡುಕಿ',
    checking: 'ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ',

    modeEpic: 'EPIC ಸಂಖ್ಯೆಯಿಂದ', modeSerial: 'ಕ್ರಮ ಸಂಖ್ಯೆಯಿಂದ', modeName: 'ಹೆಸರಿನಿಂದ',
    selDistrictLabel: 'ಜಿಲ್ಲೆ', selAcLabel: 'ಕ್ಷೇತ್ರ', selBoothLabel: 'ಮತಗಟ್ಟೆ',
    selDistrictPlaceholder: 'ಜಿಲ್ಲೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ…', selAcPlaceholder: 'ಕ್ಷೇತ್ರವನ್ನು ಆಯ್ಕೆಮಾಡಿ…', selBoothPlaceholder: 'ಮತಗಟ್ಟೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ…',
    serialLabel: 'ಪಟ್ಟಿಯಲ್ಲಿ ಕ್ರಮ ಸಂಖ್ಯೆ',
    serialHelp: 'ಆ ಮತಗಟ್ಟೆಯ ಪಟ್ಟಿಯಲ್ಲಿ ಹೆಸರಿನ ಎದುರು ಮುದ್ರಿತವಾದ ಕ್ರಮ ಸಂಖ್ಯೆ.',
    nameLabel: 'ಹೆಸರು',
    nameHelp: 'ಪಟ್ಟಿಯಲ್ಲಿ ಮುದ್ರಿತವಾದಂತೆ ಹೆಸರಿನ ಭಾಗವನ್ನು ನಮೂದಿಸಿ. ಮತದಾರರ ಗುರುತಿನ ಚೀಟಿ ಸಂಖ್ಯೆ ತೋರಿಸುವುದಿಲ್ಲ.',
    searchNote: 'ಹೆಸರು ಅಥವಾ ಕ್ರಮ ಸಂಖ್ಯೆಯಿಂದ ಹುಡುಕುವುದು ಸಾರ್ವಜನಿಕ ASDDO ಪಟ್ಟಿಯನ್ನು ಓದುತ್ತದೆ. ಇದು ಎಂದಿಗೂ ಮತದಾರರ ಗುರುತಿನ ಸಂಖ್ಯೆಯನ್ನು ತೋರಿಸುವುದಿಲ್ಲ.',
    errPickDistrict: 'ಮೊದಲು ಜಿಲ್ಲೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    errPickAc: 'ಕ್ಷೇತ್ರವನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    errPickBooth: 'ಮತಗಟ್ಟೆಯನ್ನು ಆಯ್ಕೆಮಾಡಿ.',
    errSerialEmpty: 'ಹುಡುಕಲು ಕ್ರಮ ಸಂಖ್ಯೆಯನ್ನು ನಮೂದಿಸಿ.',
    errNameShort: 'ಹೆಸರಿನ ಕನಿಷ್ಠ ಎರಡು ಅಕ್ಷರಗಳನ್ನು ನಮೂದಿಸಿ.',
    searchResultsHeading: '“{q}” ಗೆ ಹೊಂದುವ {n} ಹೆಸರುಗಳು ASDDO ಪಟ್ಟಿಯಲ್ಲಿವೆ',
    searchResultsHeadingOne: '“{q}” ಗೆ ಹೊಂದುವ 1 ಹೆಸರು ASDDO ಪಟ್ಟಿಯಲ್ಲಿದೆ',
    searchResultsCapped: 'ಮೊದಲ {shown} ತೋರಿಸಲಾಗಿದೆ. ಕಡಿಮೆ ನೋಡಲು ಹೆಸರನ್ನು ಸಂಕುಚಿತಗೊಳಿಸಿ.',
    searchResultsIn: '{ac} ನಲ್ಲಿ',
    resultOpen: 'ಪೂರ್ಣ ದಾಖಲೆ ನೋಡಿ',
    backToResults: '‹ ಫಲಿತಾಂಶಗಳಿಗೆ ಹಿಂತಿರುಗಿ',
    searchNoMatchNameHeading: 'ASDDO ಪಟ್ಟಿಯಲ್ಲಿ ಹೊಂದಿಕೆಯಿಲ್ಲ',
    searchNoMatchName: '{ac} ನ ASDDO ಪಟ್ಟಿಯಲ್ಲಿ “{q}” ಹೊಂದಿರುವ ಯಾವ ಹೆಸರೂ ಇಲ್ಲ. ಮತದಾರರು ಗುರುತಿಸಲ್ಪಡದಿದ್ದರೆ ಇದು ನಿರೀಕ್ಷಿತ ಫಲಿತಾಂಶ.',
    searchNoMatchSerialHeading: 'ASDDO ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ',
    searchNoMatchSerial: '{booth} ನಲ್ಲಿ ಕ್ರಮ ಸಂಖ್ಯೆ {serial} ASDDO ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ. ಮತದಾರರು ಗುರುತಿಸಲ್ಪಡದಿದ್ದರೆ ಇದು ನಿರೀಕ್ಷಿತ ಫಲಿತಾಂಶ.',

    deletedHeading: 'ಈ EPIC ASDDO ಪಟ್ಟಿಯಲ್ಲಿ ಇದೆ',
    deletedLede: 'ಈ ಗುರುತಿನ ಚೀಟಿ SIR ಅಡಿಯಲ್ಲಿ ಪರಿಶೀಲನೆಗೆ ಗುರುತಿಸಲ್ಪಟ್ಟಿದೆ. ಇದರರ್ಥ ನಿಮ್ಮ ಹೆಸರು ಡಿಲೀಟ್ ಆಗಿದೆ ಎಂದಲ್ಲ — ಆದರೆ ಈಗಲೇ ಕ್ರಮ ತೆಗೆದುಕೊಳ್ಳುವುದು ಅಗತ್ಯ.',
    multipleNote: 'ಈ EPIC ಸಂಖ್ಯೆಗೆ ಒಂದಕ್ಕಿಂತ ಹೆಚ್ಚು ದಾಖಲೆಗಳು ಹೊಂದಿಕೆಯಾಗಿವೆ. ಎಲ್ಲವನ್ನೂ ಕೆಳಗೆ ತೋರಿಸಲಾಗಿದೆ.',
    fieldName: 'ಮತದಾರರ ಹೆಸರು', fieldRelative: 'ಸಂಬಂಧಿ', fieldAge: 'ವಯಸ್ಸು',
    fieldDistrict: 'ಜಿಲ್ಲೆ', fieldAc: 'ಕ್ಷೇತ್ರ', fieldPart: 'ಮತಗಟ್ಟೆ',
    fieldSerial: 'ಪಟ್ಟಿಯಲ್ಲಿ ಕ್ರಮ ಸಂಖ್ಯೆ', fieldReason: 'ನಮೂದಿಸಿದ ಕಾರಣ',
    fieldBlo: 'ನಿಮ್ಮ ಮತಗಟ್ಟೆ ಮಟ್ಟದ ಅಧಿಕಾರಿ (BLO)',
    bloNote: 'ಪರಿಷ್ಕರಣೆ ಸಮಯದಲ್ಲಿ BLO ನೇಮಕಾತಿ ಬದಲಾಗಬಹುದು — ಇದು ತಪ್ಪಾಗಿ ಅಥವಾ ಹಳೆಯದಾಗಿ ಕಂಡರೆ ಇಲ್ಲಿ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ',
    fieldDup: 'ಉಳಿಸಿಕೊಂಡ ಗುರುತಿನ ಚೀಟಿ',
    fieldGender: 'ಲಿಂಗ',
    sourcePdf: 'ಈ ದಾಖಲೆ ಬಂದ ಅಧಿಕೃತ PDF ತೆರೆಯಿರಿ',
    sourceGenerated: 'ದಾಖಲೆ ದಿನಾಂಕ',
    sourceMissing: 'ಈ ದಾಖಲೆಯ ಮೂಲ ಕಡತವನ್ನು ಗುರುತಿಸಲಾಗಲಿಲ್ಲ. ನಿಮ್ಮ ಮತಗಟ್ಟೆಯ ASDDO ಪಟ್ಟಿಯನ್ನು BLO ಅವರಿಂದ ಕೇಳಿ.',
    rollEntryHeading: 'ಮತದಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ನಿಮ್ಮ ದಾಖಲೆ',
    clearNoDetails: 'ಈ ಆವೃತ್ತಿಯಲ್ಲಿ ಸಂಖ್ಯೆ ಇದೆಯೇ ಎಂಬುದನ್ನು ಮಾತ್ರ ಸೂಚಿಸಲಾಗಿದೆ, ಪಟ್ಟಿಯ ದಾಖಲೆಯ ವಿವರಗಳಲ್ಲ.',

    actionHeading: 'ಈಗ ಏನು ಮಾಡಬೇಕು',
    actionSteps: [
      'ನಿಮ್ಮ BLO (ಮತಗಟ್ಟೆ ಮಟ್ಟದ ಅಧಿಕಾರಿ) ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ, ಗುರುತು ಮತ್ತು ವಿಳಾಸದ ದಾಖಲೆಗಳನ್ನು ಒದಗಿಸಿ ಪರಿಶೀಲನೆ ಪೂರ್ಣಗೊಳಿಸಿ.',
      'CEO ಕರ್ನಾಟಕ ಅಧಿಕೃತ ಪೋರ್ಟಲ್ ceo.karnataka.gov.in ಅಥವಾ voters.eci.gov.in ನಲ್ಲಿ ನಿಮ್ಮ ವಿವರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.',
      'ಪರಿಷ್ಕೃತ ಕರಡು ಮತದಾರರ ಪಟ್ಟಿ ಆಗಸ್ಟ್ 17 ರಂದು ಪ್ರಕಟವಾಗಲಿದೆ. ಅದಕ್ಕೂ ಮೊದಲು ಕ್ರಮ ತೆಗೆದುಕೊಳ್ಳಿ — ಅಂತಿಮ ಪಟ್ಟಿ ಪ್ರಕಟವಾದ ನಂತರ ಸರಿಪಡಿಸುವುದು ಕಷ್ಟ.',
      'ಹೆಸರು ತಪ್ಪಾಗಿ ತೆಗೆದುಹಾಕಿದ್ದರೆ ಮರುಸೇರ್ಪಡೆಗಾಗಿ ನಮೂನೆ 6 ಸಲ್ಲಿಸಿ, ಅಥವಾ ಮತದಾರರ ಸಹಾಯವಾಣಿ 1950 ಗೆ ಕರೆ ಮಾಡಿ.'
    ],
    copyBtn: 'ವಿವರಗಳನ್ನು ನಕಲಿಸಿ', copiedBtn: 'ನಕಲಾಗಿದೆ', printBtn: 'ಮುದ್ರಿಸಿ / PDF ಆಗಿ ಉಳಿಸಿ',

    clearHeading: 'ASDDO ಪಟ್ಟಿಯಲ್ಲಿ ಕಂಡುಬಂದಿಲ್ಲ',
    clearLede: 'EPIC {epic} ಮತದಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ಇದೆ ಮತ್ತು ASDDO ಪಟ್ಟಿಯಲ್ಲಿ ಇಲ್ಲ.',
    clearNote: 'ಇದು ASDDO ಪಟ್ಟಿಯನ್ನು ಮಾತ್ರ ಒಳಗೊಂಡಿದೆ. ಏನಾದರೂ ತಪ್ಪಾಗಿ ಕಂಡರೆ ceo.karnataka.gov.in ಅಥವಾ voters.eci.gov.in ನೋಡಿ, ಅಥವಾ ನಿಮ್ಮ BLO ಅವರನ್ನು ಸಂಪರ್ಕಿಸಿ.',

    notListedHeading: 'ASDDO ಪಟ್ಟಿಯಲ್ಲಿ ಕಂಡುಬಂದಿಲ್ಲ',
    notListedLede: 'ಇಲ್ಲಿ ಲೋಡ್ ಆಗಿರುವ ASDDO ದತ್ತಾಂಶದಲ್ಲಿ EPIC {epic} ಕಂಡುಬಂದಿಲ್ಲ.',
    notListedNote: 'ಈ ಆವೃತ್ತಿಯಲ್ಲಿ ಮತದಾರರ ಪಟ್ಟಿಯ ಸೂಚಿಕೆ ಇಲ್ಲ, ಆದ್ದರಿಂದ ಸಂಖ್ಯೆ ಅಸ್ತಿತ್ವದಲ್ಲಿದೆಯೇ ಎಂದು ಖಚಿತಪಡಿಸಲಾಗದು — ಟೈಪಿಂಗ್ ತಪ್ಪೂ ಹೀಗೆಯೇ ಕಾಣುತ್ತದೆ. ನಿಮ್ಮ ಚೀಟಿಯ ಸಂಖ್ಯೆ ಪರಿಶೀಲಿಸಿ ಮತ್ತು voters.eci.gov.in ನೋಡಿ.',
    notListedPartialNote: 'ಇಲ್ಲಿ ಲೋಡ್ ಆದ ಪಟ್ಟಿಯ ಸೂಚಿಕೆ ಸುಮಾರು {coverage}% ಮತದಾರರನ್ನು ಮಾತ್ರ ಒಳಗೊಂಡಿದೆ — ಪ್ರಕಟಿತ ಪಟ್ಟಿಯ ಹೆಚ್ಚಿನ ದಾಖಲೆಗಳಲ್ಲಿ ಪ್ರಮಾಣಿತ EPIC ಸಂಖ್ಯೆ ಇಲ್ಲ — ಆದ್ದರಿಂದ ಈ ಸಂಖ್ಯೆ ಸಿಗದಿರುವುದು ನೀವು ನೋಂದಾಯಿತರಲ್ಲ ಎಂದು ಅರ್ಥವಲ್ಲ. voters.eci.gov.in ನಲ್ಲಿ ಅಥವಾ BLO ಬಳಿ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.',
    coverageGapNote: 'ವ್ಯಾಪ್ತಿ: {total} ಜಿಲ್ಲೆಗಳಲ್ಲಿ {loaded} ಜಿಲ್ಲೆಗಳ ದತ್ತಾಂಶ ಮಾತ್ರ ಇಲ್ಲಿ ಲೋಡ್ ಆಗಿದೆ. ಲೋಡ್ ಆಗಿಲ್ಲದವು: {missing}. ನಿಮ್ಮ ಜಿಲ್ಲೆ ಈ ಪಟ್ಟಿಯಲ್ಲಿದ್ದರೆ ಈ ಫಲಿತಾಂಶಕ್ಕೆ ಯಾವ ಅರ್ಥವೂ ಇಲ್ಲ — ceo.karnataka.gov.in/asddo.html ಮೂಲ ಪುಟವನ್ನೇ ನೇರವಾಗಿ ಪರಿಶೀಲಿಸಿ.',
    listSeparator: ', ',

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
    tileRecords: 'ಪಟ್ಟಿಯಲ್ಲಿರುವ ಹೆಸರುಗಳು', tileDistricts: 'ಜಿಲ್ಲೆಗಳು', tileAcs: 'ಕ್ಷೇತ್ರಗಳು', tileBooths: 'ಮತಗಟ್ಟೆಗಳು',
    chartCategoryTitle: 'ಕಾರಣವಾರು ಪಟ್ಟಿ',
    chartCategorySub: 'ಪಟ್ಟಿಯಲ್ಲಿರುವ ಪ್ರತಿ ಹೆಸರನ್ನು ಐದು ASDDO ವರ್ಗಗಳಲ್ಲಿ ಜೋಡಿಸಲಾಗಿದೆ.',
    chartAgeTitle: 'ಪಟ್ಟಿಯಲ್ಲಿರುವ ಮತದಾರರ ವಯಸ್ಸು',
    chartAgeSub: 'ಮೂಲ ಪಟ್ಟಿಯಲ್ಲಿ ಮುದ್ರಿತವಾದ ವಯಸ್ಸು.',
    chartAcTitle: 'ಅತಿ ಹೆಚ್ಚು ಪಟ್ಟಿ ನಮೂದುಗಳಿರುವ ಕ್ಷೇತ್ರಗಳು',
    chartAcSub: 'ಒಟ್ಟು ಸಂಖ್ಯೆ. ದೊಡ್ಡ ಕ್ಷೇತ್ರ ಸಹಜವಾಗಿ ಮೇಲಿರುತ್ತದೆ — ಜಿಲ್ಲಾ ಕೋಷ್ಟಕದೊಂದಿಗೆ ಓದಿ.',
    districtTitle: 'ಜಿಲ್ಲಾವಾರು ವಿವರ', districtSub: 'ವಿಂಗಡಿಸಲು ಶೀರ್ಷಿಕೆ ಕ್ಲಿಕ್ ಮಾಡಿ.',
    tableView: 'ಕೋಷ್ಟಕವಾಗಿ ನೋಡಿ',
    colDistrict: 'ಜಿಲ್ಲೆ', colTotal: 'ಒಟ್ಟು', colShare: 'ಪಾಲು', colCategory: 'ವರ್ಗ',
    filterDistrict: 'ಜಿಲ್ಲೆ', filterConstituency: 'ಕ್ಷೇತ್ರ',
    filterAll: 'ಎಲ್ಲಾ', filterReset: 'ಮರುಹೊಂದಿಸಿ', filterNoRows: 'ಈ ಶೋಧನೆಗೆ ಏನೂ ಹೊಂದಿಕೆಯಾಗಿಲ್ಲ.',
    districtSubFiltered: '{district} ಜಿಲ್ಲೆಯ ಕ್ಷೇತ್ರಗಳು. ವಿಂಗಡಿಸಲು ಶೀರ್ಷಿಕೆ ಕ್ಲಿಕ್ ಮಾಡಿ.',
    colCount: 'ಸಂಖ್ಯೆ', colBand: 'ವಯಸ್ಸಿನ ಗುಂಪು', colConstituency: 'ಕ್ಷೇತ್ರ', colBooths: 'ಮತಗಟ್ಟೆಗಳು',
    ageUnknown: 'ನಮೂದಿಸಿಲ್ಲ',
    scopeNote: '{districts} · {booths} ಮತಗಟ್ಟೆಗಳು · ದಾಖಲೆ ದಿನಾಂಕ {dates}',
    footerImported: '{date} ರಂದು ಆಮದು ಮಾಡಲಾಗಿದೆ; ಮೂಲ ದಾಖಲೆಗಳ ದಿನಾಂಕ {dates}.',
    footerSource: 'ಮೂಲ: ಕರ್ನಾಟಕ ಮುಖ್ಯ ಚುನಾವಣಾ ಅಧಿಕಾರಿ ಪ್ರಕಟಿಸಿದ ASDDO ಪಟ್ಟಿಗಳು. ಇದು ಸ್ವತಂತ್ರ, ಅನಧಿಕೃತ ಮರುರೂಪಣೆ. ಕ್ರಮ ತೆಗೆದುಕೊಳ್ಳುವ ಮೊದಲು BLO ಅಥವಾ voters.eci.gov.in ನಲ್ಲಿ ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.',
    footerLink: 'ceo.karnataka.gov.in ನಲ್ಲಿ ಮೂಲ ದಾಖಲೆಗಳು',
    footerPressRelease: 'ಇತ್ತೀಚಿನ ಕರ್ನಾಟಕ ಮುಖ್ಯ ಚುನಾವಣಾ ಅಧಿಕಾರಿ ಪತ್ರಿಕಾ ಪ್ರಕಟಣೆ ({date})',
    provenancePulled: '{datetime} ರಂದು ಕರ್ನಾಟಕ ಮುಖ್ಯ ಚುನಾವಣಾ ಅಧಿಕಾರಿಯ ASDDO ಪಟ್ಟಿಗಳಿಂದ ({source}) ಡೇಟಾ ಪಡೆಯಲಾಗಿದೆ.',
    officialCompare: 'ಕರ್ನಾಟಕ ಮುಖ್ಯ ಚುನಾವಣಾ ಅಧಿಕಾರಿಯ ಪ್ರಕಾರ {asOf} ರಂದು {official} ಮತದಾರರನ್ನು ASDDO ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ. ಈ ತಾಣವು ಅವುಗಳಲ್ಲಿ {captured} ({pct}%) ಪ್ರಕ್ರಿಯೆಗೊಳಿಸಿದೆ — ಉಳಿದವು ಇನ್ನೂ ಪ್ರಕಟವಾಗದ ಅಥವಾ ಯಂತ್ರ-ಓದಬಹುದಾದ ಅಲ್ಲದ ಪಟ್ಟಿಗಳಲ್ಲಿವೆ. {link} ನೋಡಿ.',
    pressReleaseWord: 'ಇತ್ತೀಚಿನ ಪತ್ರಿಕಾ ಪ್ರಕಟಣೆ'
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
let official = null;
let lastResult = null;
const partsCache = new Map();
const bloCache = new Map();

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

// Each record stores its constituency, reason, relation and district as indices
// into manifest.dicts, and every rebuild reassigns those indices from scratch.
// The manifest is loaded once at page-load and kept in memory, but the buckets
// are fetched live per lookup. So if a new build is published while this tab is
// open, a lookup reads fresh buckets yet decodes them against the OLD in-memory
// dicts — and acIdx/reasonIdx then point at the wrong constituency and reason
// (e.g. an Anekal record shown under Belagavi with the wrong reason). The record
// itself is never wrong or lost; only the decode drifts.
//
// Fix: re-fetch the manifest (17 KB) before each lookup. If the data version
// moved, adopt the new dicts and drop the acIdx-keyed caches, so every field is
// decoded against dicts that match the buckets being read.
async function refreshManifest() {
  try {
    const fresh = await loadJson('data/manifest.json');
    if (fresh?.dataVersion && fresh.dataVersion !== manifest.dataVersion) {
      manifest = fresh;
      partsCache.clear();
      bloCache.clear();
      searchCache.clear();
    }
  } catch { /* keep the manifest we have if the refresh fails */ }
}

async function lookup(epic) {
  await refreshManifest();
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

/**
 * `source` is either a Drive file id or, for districts that host PDFs on their
 * own site, an absolute URL.
 */
const sourceUrl = (source) =>
  !source ? '' : /^https?:\/\//i.test(source) ? source : `https://drive.google.com/file/d/${source}/view`;

// The base ASDDO reason, without the enrollment reference the source prints
// after it — "Already enrolled (AKB 3631645)" -> "Already enrolled". No reason
// legitimately contains a parenthesis, so strip from the first one. Mirrors the
// normalisation in scripts/3-build-site-data.mjs so data built before that fix
// (which left spaced/non-standard references in the label) still reads cleanly.
function cleanReason(reason) {
  return (reason || '').replace(/\s*\(.*$/s, '').trim() || 'Not stated';
}

// Some districts host booth PDFs under a purely numeric filename (Bellary's NIC
// files, e.g. 17858435222676.pdf), and when the station name wasn't parsed from
// the PDF body the filename stem leaked into partName. A real polling-station
// name is never a bare run of digits, so drop it and let the booth show as just
// its number rather than "20 — 17858435222676".
const cleanBoothName = (name) => (/^\d{6,}$/.test(String(name ?? '').trim()) ? '' : (name || ''));

async function decodeRecord(row) {
  const [, name, relative, relIdx, age, serial, reasonIdx, acIdx, fileIdx, dup] = row;
  const [acNo, acName, districtIdx] = manifest.dicts.acs[acIdx];

  if (!partsCache.has(acIdx)) {
    partsCache.set(
      acIdx,
      loadJson(`data/parts/${acIdx}.json?v=${manifest.dataVersion}`).catch(() => [])
    );
  }
  const sources = await partsCache.get(acIdx);
  // Older builds keyed this file by part number; current builds ship an array
  // indexed by the record's own file reference.
  const part = Array.isArray(sources) ? sources[fileIdx] : sources?.[fileIdx];
  const partNo = part ? part[1] : 0;

  // The BLO for this exact booth, fetched one small file per constituency —
  // present only when a blo/ shard was built. Never a list; the card only ever
  // shows the officer for the record being looked at.
  if (!bloCache.has(acIdx)) {
    bloCache.set(acIdx, loadJson(`data/blo/${acIdx}.json?v=${manifest.dataVersion}`).catch(() => null));
  }
  const blo = partNo ? (await bloCache.get(acIdx))?.[partNo] ?? null : null;

  return {
    name,
    relative,
    relation: relIdx >= 0 ? manifest.dicts.relations[relIdx] : '',
    age: age || null,
    serial,
    reason: cleanReason(manifest.dicts.reasons[reasonIdx]),
    district: manifest.dicts.districts[districtIdx],
    acNo,
    acName,
    partNo,
    partName: cleanBoothName(part ? part[2] : ''),
    sourceUrl: part ? sourceUrl(part[0]) : '',
    sourceName: part ? part[0] : '',
    generatedOn: part ? part[3] : '',
    blo,
    dup
  };
}

// ------------------------------------------------------- search (name/serial)

// A name or a booth+serial can't be hashed into a bucket path the way an EPIC
// can, so these lookups read a per-constituency index (data/search/<acIdx>.json)
// that is loaded only when the visitor picks that constituency. Each row is
// [fileIdx, serial, name, reasonIdx, hash12]; hash12 locates the record's bucket
// so the full card is decoded from the SAME files an EPIC lookup uses — nothing
// here is a second copy of the record, and the EPIC is still never published.
const NAME_RESULTS_CAP = 200;
const searchCache = new Map();
let lastNameResults = null;

function loadSearch(acIdx) {
  if (!searchCache.has(acIdx)) {
    searchCache.set(acIdx, loadJson(`data/search/${acIdx}.json?v=${manifest.dataVersion}`).catch(() => []));
  }
  return searchCache.get(acIdx);
}

// Parts file for a constituency: [source, partNo, partName, generatedOn] indexed
// by fileIdx. Shares partsCache with decodeRecord so a card lookup and a search
// never fetch it twice.
function loadParts(acIdx) {
  if (!partsCache.has(acIdx)) {
    partsCache.set(acIdx, loadJson(`data/parts/${acIdx}.json?v=${manifest.dataVersion}`).catch(() => []));
  }
  return partsCache.get(acIdx);
}

/** Fetch and decode one record by its stored hash12 (bucket prefix + suffix). */
async function fetchRecordByHash12(hash12, acIdx) {
  const prefix = hash12.slice(0, manifest.shardDepth);
  const suffix = hash12.slice(manifest.shardDepth);
  let bucket = [];
  try {
    bucket = await loadJson(`data/asddo/${bucketPath(prefix, 'json')}?v=${manifest.dataVersion}`);
  } catch (err) {
    if (err.status !== 404) throw err;
  }
  const rec = bucket.find((r) => r[0] === suffix && (acIdx == null || r[7] === acIdx));
  return rec ? decodeRecord(rec) : null;
}

const partField = (parts, fileIdx, i) => (Array.isArray(parts) ? parts[fileIdx] : null)?.[i];

function boothLabel(parts, partNo) {
  const entry = (Array.isArray(parts) ? parts : []).find((p) => p[1] === partNo);
  const name = cleanBoothName(entry ? entry[2] : '');
  return `${partNo}${name ? ` — ${name}` : ''}`;
}

// acIdx is reassigned every build, so the value picked in the dropdown can point
// at a DIFFERENT constituency once a new import lands while the page is open. The
// stable identity is (district, acNo) — resolve the current acIdx from that at
// search time, AFTER refreshManifest, so a rebuild never redirects a search to
// the wrong constituency. (The EPIC lookup is immune because it hashes the EPIC.)
function resolveAcIdx(sel) {
  const acs = manifest?.dicts?.acs ?? [];
  for (let i = 0; i < acs.length; i++) {
    const [acNo, acName, dIdx] = acs[i];
    if (manifest.dicts.districts[dIdx] !== sel.district) continue;
    if (sel.acNo != null ? acNo === sel.acNo : acName === sel.acName) return i;
  }
  return -1;
}

async function serialSearch(sel, partNo, serial) {
  await refreshManifest();
  const acIdx = resolveAcIdx(sel);
  if (acIdx < 0) return { kind: 'searchNone', mode: 'serial', serial, booth: String(partNo) };
  const [rows, parts] = await Promise.all([loadSearch(acIdx), loadParts(acIdx)]);
  const hits = rows.filter((r) => partField(parts, r[0], 1) === partNo && r[1] === serial);
  if (!hits.length) {
    return { kind: 'searchNone', mode: 'serial', serial, booth: boothLabel(parts, partNo) };
  }
  const records = (await Promise.all(hits.map((r) => fetchRecordByHash12(r[4], acIdx)))).filter(Boolean);
  return records.length ? { kind: 'deleted', epic: '', records } : { kind: 'searchNone', mode: 'serial', serial, booth: boothLabel(parts, partNo) };
}

const acLabel = (acIdx) => {
  const a = manifest.dicts.acs[acIdx];
  return a ? `${a[0] != null ? `${a[0]} ` : ''}${titleCase(a[1] || '')}`.trim() : '';
};

async function nameSearch(sel, query) {
  await refreshManifest();
  const acIdx = resolveAcIdx(sel);
  const q = query.trim().toUpperCase();
  if (acIdx < 0) return { kind: 'nameResults', acIdx, query: q, matches: [], parts: [], ac: '' };
  const [rows, parts] = await Promise.all([loadSearch(acIdx), loadParts(acIdx)]);
  const matches = rows.filter((r) => r[2].includes(q));
  return { kind: 'nameResults', acIdx, query: q, matches, parts, ac: acLabel(acIdx) };
}

// ------------------------------------------------------------------- result

const resultEl = () => $('#result');

function renderResult(data) {
  lastResult = data;
  const host = resultEl();
  host.innerHTML = '';
  host.hidden = false;

  if (data.kind === 'deleted') {
    if (data.from === 'name' && lastNameResults) {
      const back = el('button', 'ghost-btn back-btn', t('backToResults'));
      back.type = 'button';
      back.addEventListener('click', () => renderResult(lastNameResults));
      host.appendChild(back);
    }
    renderDeleted(host, data);
  }
  else if (data.kind === 'nameResults') { lastNameResults = data; renderNameResults(host, data); }
  else if (data.kind === 'searchNone') renderSearchNone(host, data);
  else if (data.kind === 'clear') renderClear(host, data);
  else if (data.kind === 'notListed') {
    // Not on the ASDDO list is GOOD news — the elector isn't flagged for deletion.
    // Show it in the same reassuring green as a serial/name "not found", not the
    // amber caution that reads as alarming (the typo caveat still rides along in
    // the note). Consistent across all three search modes.
    renderVerdict(host, data, 'is-clear', '✓', 'notListedHeading', 'notListedLede',
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
  const scope = missingDistrictsNote();
  if (scope && (data.kind === 'notListed' || data.kind === 'unknown')) {
    card.appendChild(el('p', 'next-steps', scope));
  }
  host.appendChild(card);
}

/**
 * "Not found" means nothing at all to someone whose district was never
 * imported, and until now the site had no way of saying so — the number was
 * computed at build time and then never shown. Only rendered on the two
 * verdicts where absence is the answer.
 */
function missingDistrictsNote() {
  const missing = manifest?.districtsMissing ?? [];
  if (!missing.length) return '';
  const total = manifest?.counts?.districtsInSource ?? 0;
  const loaded = manifest?.counts?.districts ?? 0;
  return fill(t('coverageGapNote'), {
    loaded,
    total,
    missing: missing.join(t('listSeparator'))
  });
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
      [t('fieldBlo'), record.blo && record.blo.name
        ? `${record.blo.name}${record.blo.mobile ? ` — ${record.blo.mobile}` : ''}` : ''],
      [t('fieldDup'), record.dup]
    ];
    for (const [term, value] of rows) {
      if (!value) continue;
      dl.appendChild(el('dt', null, term));
      // The BLO's number is the one field a person will act on immediately, so
      // make it dialable on a phone rather than a string to copy by hand.
      if (term === t('fieldBlo') && record.blo?.mobile) {
        const dd = el('dd');
        dd.appendChild(document.createTextNode(record.blo.name ? `${record.blo.name} — ` : ''));
        const tel = el('a', 'blo-tel', record.blo.mobile);
        tel.href = `tel:+91${record.blo.mobile}`;
        dd.appendChild(tel);
        // BLO assignments change during a revision, and this list is a snapshot.
        // Say so, and point at the ECI's own current source, so a wrong or stale
        // number is never the end of the road.
        const note = el('span', 'blo-note');
        note.appendChild(document.createTextNode(t('bloNote') + ' '));
        const eci = el('a', 'blo-eci', 'electoralsearch.eci.gov.in');
        eci.href = 'https://electoralsearch.eci.gov.in/';
        eci.target = '_blank';
        eci.rel = 'noopener noreferrer';
        note.appendChild(eci);
        dd.appendChild(note);
        dl.appendChild(dd);
        continue;
      }
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
    // so" and evidence you can take to a BLO, so it is shown prominently and
    // names the booth it came from rather than being a bare "source" link.
    if (record.sourceUrl) {
      const source = el('div', 'source-block');
      const link = el('a', 'source-link', `${t('sourcePdf')} ↗`);
      link.href = record.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      source.appendChild(link);

      const detail = [
        record.partNo ? `${t('fieldPart')} ${record.partNo}` : '',
        record.partName,
        record.generatedOn ? `${t('sourceGenerated')} ${record.generatedOn}` : ''
      ].filter(Boolean).join(' · ');
      if (detail) source.appendChild(el('p', 'source-detail', detail));
      box.appendChild(source);
    } else {
      box.appendChild(el('p', 'source-detail', t('sourceMissing')));
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

/**
 * Results of a name search: a scannable list, not a wall of full cards. Each row
 * shows only what identifies the right person (name, booth, serial, reason);
 * opening one fetches that record's bucket and renders the same full card an
 * EPIC lookup would, with a link back to the list.
 */
function renderNameResults(host, data) {
  const { matches, query, ac, parts, acIdx } = data;
  if (!matches.length) {
    renderSearchNone(host, { kind: 'searchNone', mode: 'name', query, ac });
    return;
  }

  const card = el('div', 'result-card is-caution');
  const headKey = matches.length === 1 ? 'searchResultsHeadingOne' : 'searchResultsHeading';
  card.appendChild(el('h2', null, fill(t(headKey), { n: nf().format(matches.length), q: query })));
  card.appendChild(el('p', 'lede', fill(t('searchResultsIn'), { ac })));
  if (matches.length > NAME_RESULTS_CAP) {
    card.appendChild(el('p', 'next-steps', fill(t('searchResultsCapped'), { shown: NAME_RESULTS_CAP })));
  }

  const list = el('div', 'search-results');
  for (const r of matches.slice(0, NAME_RESULTS_CAP)) {
    const [fileIdx, serial, name, reasonIdx, hash12] = r;
    const partNo = partField(parts, fileIdx, 1) ?? 0;
    const reason = cleanReason(manifest.dicts.reasons[reasonIdx]);

    const item = el('button', 'search-result');
    item.type = 'button';
    item.setAttribute('aria-label', `${name} — ${t('resultOpen')}`);
    item.appendChild(el('span', 'sr-name', name));

    const meta = el('span', 'sr-meta');
    if (partNo) meta.appendChild(el('span', 'sr-tag', `${t('fieldPart')} ${partNo}`));
    if (serial) meta.appendChild(el('span', 'sr-tag', `${t('fieldSerial')} ${nf().format(serial)}`));
    const rc = el('span', 'sr-tag sr-reason');
    const dot = el('span', 'dot');
    dot.dataset.cat = categoryOf(reason);
    rc.append(dot, document.createTextNode(reason));
    meta.appendChild(rc);
    item.appendChild(meta);

    item.addEventListener('click', async () => {
      if (busy) return;
      setBusy(true);
      try {
        const rec = await fetchRecordByHash12(hash12, acIdx);
        if (rec) renderResult({ kind: 'deleted', epic: '', records: [rec], from: 'name' });
      } catch {
        renderResult({ kind: 'problem', message: t('errNetwork') });
      } finally {
        setBusy(false);
      }
    });
    list.appendChild(item);
  }
  card.appendChild(list);
  host.appendChild(card);
}

/** A booth+serial or name search that matched nothing — a clean, reassuring miss. */
function renderSearchNone(host, data) {
  const card = el('div', 'result-card is-clear');
  if (data.mode === 'serial') {
    card.appendChild(el('h2', null, `✓  ${t('searchNoMatchSerialHeading')}`));
    card.appendChild(el('p', 'lede', fill(t('searchNoMatchSerial'), { serial: nf().format(data.serial), booth: data.booth })));
  } else {
    card.appendChild(el('h2', null, `✓  ${t('searchNoMatchNameHeading')}`));
    card.appendChild(el('p', 'lede', fill(t('searchNoMatchName'), { q: data.query, ac: data.ac })));
  }
  card.appendChild(el('p', 'next-steps', t('clearNote')));
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
      r.sourceUrl ? `Source PDF: ${r.sourceUrl}` : '',
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

/**
 * Constituency names, from the ECI's own line inside each booth PDF
 * ("AC: 209-Virajpet"). Drive folder names are the only thing discover can read
 * a name from, and for a third of constituencies they are not AC-shaped, which
 * left cards and filters saying "AC 167". These are authoritative, so they win
 * outright rather than only filling blanks — folder-derived names are also
 * inconsistently punctuated.
 *
 * Applied at load time so a name fix never requires re-importing 50,000 PDFs.
 */
function applyAcNames(overrides) {
  if (!overrides || !Object.keys(overrides).length) return;
  const named = (no, current) => (no != null && overrides[no]) || current;
  for (const ac of manifest.dicts?.acs ?? []) ac[1] = named(ac[0], ac[1]);
  for (const list of [stats.constituencies, stats.topConstituencies]) {
    for (const ac of list ?? []) ac.name = named(ac.no, ac.name);
  }
}

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

  // --- by age band
  const bandLabel = (k) => (k === 'unknown' ? t('ageUnknown') : k);
  const ageData = Object.entries(stats.ageBands)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ key: k, label: bandLabel(k), value: v, color: 'var(--series-seq)' }));
  barChart($('#chart-age'), ageData, total);

  // --- top constituencies
  const acData = stats.topConstituencies.slice(0, 12).map((a) => ({
    key: `${a.no}`,
    label: `${a.no} ${a.name}`,
    sub: titleCase(a.district),
    value: a.total,
    color: 'var(--series-seq)'
  }));
  barChart($('#chart-ac'), acData, total, Math.max(...acData.map((a) => a.value)));

  populateFilters();
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

/* The breakdown table is one table at two levels. With no district chosen it
   lists districts; choosing one swaps the rows for that district's
   constituencies, and choosing a constituency narrows to a single row. Both
   levels carry the same columns, so the comparison stays legible. */
const dFilter = { district: '', constituency: '' };
let districtSort = { key: 'total', dir: -1 };

const haveConstituencies = () =>
  Array.isArray(stats.constituencies) && stats.constituencies.length > 0;

function filteredRows() {
  const districts = stats.districts.map((d) => ({ ...d, label: titleCase(d.name) }));
  if (!dFilter.district) return districts;

  // Data built before constituency stats existed: fall back to the one district.
  if (!haveConstituencies()) return districts.filter((d) => d.name === dFilter.district);

  let rows = stats.constituencies
    .filter((c) => c.district === dFilter.district)
    .map((c) => ({ ...c, name: c.name, label: `${c.no ?? '-'} ${titleCase(c.name)}` }));
  if (dFilter.constituency) rows = rows.filter((c) => String(c.no) === dFilter.constituency);
  return rows;
}

function populateFilters() {
  const districtSel = $('#filter-district');
  const acSel = $('#filter-constituency');
  if (!districtSel || !acSel) return;

  const option = (label, value) => {
    const o = el('option', null, label);
    o.value = value;
    return o;
  };

  districtSel.innerHTML = '';
  districtSel.appendChild(option(t('filterAll'), ''));
  for (const d of [...stats.districts].sort((a, b) => a.name.localeCompare(b.name))) {
    districtSel.appendChild(option(titleCase(d.name), d.name));
  }
  districtSel.value = dFilter.district;

  const acs = haveConstituencies()
    ? stats.constituencies
        .filter((c) => c.district === dFilter.district)
        .sort((a, b) => (a.no ?? 0) - (b.no ?? 0))
    : [];
  acSel.innerHTML = '';
  acSel.appendChild(option(t('filterAll'), ''));
  for (const c of acs) acSel.appendChild(option(`${c.no ?? '-'} ${titleCase(c.name)}`, String(c.no)));
  // Picking a constituency is meaningless until a district narrows the list.
  acSel.disabled = !dFilter.district || !acs.length;
  acSel.value = dFilter.constituency;

  const sub = $('#district-sub');
  if (sub) {
    sub.textContent = dFilter.district
      ? fill(t('districtSubFiltered'), { district: titleCase(dFilter.district) })
      : t('districtSub');
  }
}

function renderDistrictTable() {
  const table = $('#district-table');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.innerHTML = '';
  tbody.innerHTML = '';

  const drilled = !!dFilter.district && haveConstituencies();
  const columns = [
    { key: 'label', label: drilled ? t('colConstituency') : t('colDistrict') },
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

  const rows = filteredRows().sort((a, b) => {
    const [x, y] = [a[districtSort.key], b[districtSort.key]];
    if (x == null || y == null) return 0;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * districtSort.dir;
  });

  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = el('td', 'empty-row', t('filterNoRows'));
    td.colSpan = columns.length;
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  for (const d of rows) {
    const tr = document.createElement('tr');
    tr.appendChild(el('td', null, d.label));
    tr.appendChild(el('td', 'num strong', nf().format(d.total)));
    for (const c of CATEGORIES) tr.appendChild(el('td', 'num', nf().format(d[c] ?? 0)));

    // A 100% stacked strip: proportions at a glance without a second chart.
    const mix = el('td', 'mix-cell');
    const strip = el('div', 'mix');
    for (const c of CATEGORIES) {
      if (!d[c]) continue;
      const seg = el('div', 'mix-seg');
      seg.style.width = `${(d[c] / d.total) * 100}%`;
      seg.style.background = `var(--cat-${c})`;
      attachTip(seg, `${d.label} \u00b7 ${t(`cat${c[0].toUpperCase()}${c.slice(1)}`)}\n${nf().format(d[c])} \u00b7 ${pct(d[c], d.total)}`);
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
  refreshSearchUI(); // re-localise the cascade placeholders, keeping choices
  if (lastResult) renderResult(lastResult); // keep the answer on screen
}

// Fill a localised template into `host`, where a placeholder value may be a DOM
// node (e.g. a link) rather than a string — so a sentence can carry a real
// hyperlink without ever injecting HTML.
function fillInto(host, tpl, values) {
  host.textContent = '';
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m;
  while ((m = re.exec(tpl))) {
    if (m.index > last) host.appendChild(document.createTextNode(tpl.slice(last, m.index)));
    const v = values[m[1]];
    host.appendChild(v instanceof Node ? v : document.createTextNode(v ?? ''));
    last = m.index + m[0].length;
  }
  if (last < tpl.length) host.appendChild(document.createTextNode(tpl.slice(last)));
}

const extLink = (href, text) => {
  const a = el('a', null, text);
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
};

function renderFooterMeta() {
  const locale = lang === 'kn' ? 'kn-IN' : 'en-IN';
  const d = new Date(manifest.importedAt);
  $('#footer-meta').textContent = fill(t('footerImported'), {
    date: d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
    dates: stats.generatedOn.join(', ') || '—'
  });
  renderProvenance(locale);
}

// When the data was pulled, where from, how much of the CEO's own count it
// covers, and a link to the press release those official figures come from.
function renderProvenance(locale) {
  const srcHref = official?.source || manifest.source || 'https://ceo.karnataka.gov.in/asddo.html';
  const pulled = new Date(manifest.importedAt).toLocaleString(locale, {
    year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
  });
  const prov = $('#data-provenance');
  if (prov) fillInto(prov, t('provenancePulled'), { datetime: pulled, source: extLink(srcHref, 'ceo.karnataka.gov.in/asddo.html') });

  const compare = $('#official-compare');
  if (compare) {
    if (official?.asddo) {
      const captured = manifest.counts.records;
      const pct = ((captured / official.asddo) * 100).toFixed(1);
      fillInto(compare, t('officialCompare'), {
        official: nf().format(official.asddo),
        asOf: new Date(official.asOf).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
        captured: nf().format(captured),
        pct,
        link: extLink(official.pressRelease || srcHref, t('pressReleaseWord'))
      });
      compare.hidden = false;
    } else {
      compare.hidden = true;
    }
  }

  const prFoot = $('#press-release-link');
  if (prFoot && official) {
    if (official.pressRelease) prFoot.href = official.pressRelease;
    prFoot.textContent = fill(t('footerPressRelease'), {
      date: official.pressReleaseDate
        ? new Date(official.pressReleaseDate).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })
        : ''
    });
  }
}

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  $('#theme-icon').textContent = theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐';
  try { localStorage.setItem('asddo-theme', theme); } catch { /* private mode */ }
}

// --------------------------------------------------------------------- boot

let busy = false;

// The submit button reads "Check this EPIC" in EPIC mode and "Search…" in the
// serial/name modes, in whichever language is active.
const submitKey = () => (mode === 'epic' ? 'checkBtn' : 'searchBtn');

function setBusy(state) {
  busy = state;
  const btn = $('#submit-btn');
  btn.disabled = state;
  btn.innerHTML = '';
  if (state) {
    btn.appendChild(el('span', 'spinner'));
    btn.appendChild(document.createTextNode(`${t('checking')}…`));
  } else {
    const key = submitKey();
    const span = el('span', null, t(key));
    span.setAttribute('data-i18n', key);
    btn.appendChild(span);
  }
}

// --- mode switching (EPIC / serial / name) ----------------------------------

let mode = 'epic';

function setMode(newMode) {
  if (!['epic', 'serial', 'name'].includes(newMode)) return;
  mode = newMode;
  for (const btn of document.querySelectorAll('.mode-btn')) {
    const on = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  }
  for (const group of document.querySelectorAll('.mode-fields')) {
    group.hidden = !group.dataset.modes.split(' ').includes(mode);
  }
  // A stale answer from the previous mode would be confusing next to new inputs.
  const host = resultEl();
  host.hidden = true;
  host.innerHTML = '';
  lastResult = null;
  lastNameResults = null;
  if (!busy) setBusy(false); // refresh the button label for the new mode
}

// --- cascade population (district -> constituency -> booth) ------------------

const optionEl = (label, value) => {
  const o = el('option', null, label);
  o.value = value;
  return o;
};

// [{ acIdx, acNo, acName, district }] for every constituency, acIdx being the
// index the data files are keyed by.
const acListForSearch = () =>
  (manifest?.dicts?.acs ?? []).map((a, i) => ({
    acIdx: i, acNo: a[0], acName: a[1], district: manifest.dicts.districts[a[2]]
  }));

function populateSearchDistricts() {
  const sel = $('#sel-district');
  if (!sel) return;
  const districts = [...new Set(acListForSearch().map((a) => a.district))].sort((x, y) => x.localeCompare(y));
  sel.innerHTML = '';
  sel.appendChild(optionEl(t('selDistrictPlaceholder'), ''));
  for (const d of districts) sel.appendChild(optionEl(titleCase(d), d));
}

function populateSearchAcs(district) {
  const sel = $('#sel-ac');
  if (!sel) return;
  sel.innerHTML = '';
  sel.appendChild(optionEl(t('selAcPlaceholder'), ''));
  const acs = acListForSearch()
    .filter((a) => a.district === district)
    .sort((a, b) => (a.acNo ?? 0) - (b.acNo ?? 0));
  for (const a of acs) {
    // The option VALUE is the constituency's stable identity (acNo, or its name
    // when a district publishes an AC with no number), NOT the build-specific
    // acIdx. This is what makes the chosen constituency survive a rebuild that
    // reshuffles acIdx while the page is open — otherwise "66 Gadag" could
    // silently become "67 Ron" when the dropdown is repopulated.
    const o = optionEl(`${a.acNo ?? '-'} ${titleCase(a.acName || '')}`.trim(), acIdentityValue(a.acNo, a.acName));
    o.dataset.acname = a.acName ?? '';
    sel.appendChild(o);
  }
  sel.disabled = !district || !acs.length;
}

const acIdentityValue = (acNo, acName) => (acNo != null ? String(acNo) : `name:${acName ?? ''}`);

// The stable (district, acNo/acName) identity of the currently chosen AC, read
// from the option's value (never acIdx).
function selectedAc() {
  const opt = $('#sel-ac')?.selectedOptions?.[0];
  const v = opt?.value ?? '';
  const isName = v.startsWith('name:');
  return {
    district: $('#sel-district')?.value ?? '',
    acNo: v === '' || isName ? null : Number(v),
    acName: isName ? v.slice(5) : (opt?.dataset.acname ?? '')
  };
}

// Booths are populated from the current-build acIdx, resolved fresh from the
// stable selection so a rebuild can never point this at the wrong constituency.
async function populateSearchBooths() {
  const sel = $('#sel-booth');
  if (!sel) return;
  sel.innerHTML = '';
  sel.appendChild(optionEl(t('selBoothPlaceholder'), ''));
  sel.disabled = true;
  if ($('#sel-ac')?.value === '' || $('#sel-ac')?.value == null) return;
  const acIdx = resolveAcIdx(selectedAc());
  if (acIdx < 0) return;
  const parts = await loadParts(acIdx);
  // One entry per booth: a constituency can have the same partNo in more than
  // one source file (a consolidated list plus the booth list).
  const seen = new Map();
  for (const p of Array.isArray(parts) ? parts : []) {
    const [, partNo, partName] = p;
    if (partNo && !seen.has(partNo)) seen.set(partNo, partName);
  }
  for (const [no, rawName] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
    const name = cleanBoothName(rawName);
    sel.appendChild(optionEl(`${no}${name ? ` — ${name}` : ''}`, String(no)));
  }
  sel.disabled = !seen.size;
}

// Rebuild the three selects, preserving the current choices — used at boot and
// when the language changes (the placeholder options are localised).
async function refreshSearchUI() {
  if (!manifest?.dicts?.acs) return;
  const d = $('#sel-district'), a = $('#sel-ac'), b = $('#sel-booth');
  const dv = d?.value ?? '', av = a?.value ?? '', bv = b?.value ?? '';
  populateSearchDistricts();
  if (d) d.value = dv;
  populateSearchAcs(dv);
  if (a) a.value = av;
  await populateSearchBooths();
  if (b) b.value = bv;
}

const problem = (key, focusSel) => {
  renderResult({ kind: 'problem', message: t(key) });
  if (focusSel) $(focusSel)?.focus();
};

async function handleEpicSubmit() {
  const input = $('#epic');
  const epic = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!epic) return problem('errEmpty', '#epic');
  // Refusing malformed input is what stops a typed name returning "not on the
  // deleted list", which reads as an all-clear to someone who may be deleted.
  if (!EPIC_RE.test(epic)) return problem('errInvalid', '#epic');
  if (!globalThis.crypto?.subtle) return void renderResult({ kind: 'problem', message: t('errCrypto') });

  setBusy(true);
  try {
    renderResult(await lookup(epic));
  } catch {
    renderResult({ kind: 'problem', message: t('errNetwork') });
  } finally {
    setBusy(false);
  }
}

async function handleSerialSubmit() {
  if (!$('#sel-district').value) return problem('errPickDistrict', '#sel-district');
  if ($('#sel-ac').value === '') return problem('errPickAc', '#sel-ac');
  const boothVal = $('#sel-booth').value;
  if (boothVal === '') return problem('errPickBooth', '#sel-booth');
  const serialVal = $('#serial-input').value.trim();
  if (!serialVal) return problem('errSerialEmpty', '#serial-input');

  setBusy(true);
  try {
    renderResult(await serialSearch(selectedAc(), Number(boothVal), Number(serialVal)));
  } catch {
    renderResult({ kind: 'problem', message: t('errNetwork') });
  } finally {
    setBusy(false);
  }
}

async function handleNameSubmit() {
  if (!$('#sel-district').value) return problem('errPickDistrict', '#sel-district');
  if ($('#sel-ac').value === '') return problem('errPickAc', '#sel-ac');
  const name = $('#name-input').value.trim();
  if (name.replace(/\s/g, '').length < 2) return problem('errNameShort', '#name-input');

  setBusy(true);
  try {
    renderResult(await nameSearch(selectedAc(), name));
  } catch {
    renderResult({ kind: 'problem', message: t('errNetwork') });
  } finally {
    setBusy(false);
  }
}

$('#lookup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy) return;
  if (mode === 'epic') handleEpicSubmit();
  else if (mode === 'serial') handleSerialSubmit();
  else if (mode === 'name') handleNameSubmit();
});

for (const btn of document.querySelectorAll('.mode-btn')) {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
}

$('#sel-district')?.addEventListener('change', (e) => {
  populateSearchAcs(e.target.value);
  populateSearchBooths(); // AC reset to placeholder, so this just clears booths
});
$('#sel-ac')?.addEventListener('change', () => { populateSearchBooths(); });

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

$('#filter-district').addEventListener('change', (e) => {
  dFilter.district = e.target.value;
  dFilter.constituency = '';   // stale AC from another district would show nothing
  populateFilters();
  renderDistrictTable();
});

$('#filter-constituency').addEventListener('change', (e) => {
  dFilter.constituency = e.target.value;
  renderDistrictTable();
});

$('#filter-reset').addEventListener('click', () => {
  dFilter.district = '';
  dFilter.constituency = '';
  populateFilters();
  renderDistrictTable();
});

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
  official = await loadJson('data/official.json').catch(() => null);
  applyAcNames(await loadJson('data/ac-names.json').catch(() => ({})));
  renderDashboard();
  renderFooterMeta();
  refreshSearchUI(); // populate the district cascade once the manifest is in
} catch {
  $('#dash-scope').textContent = t('errNetwork');
}
