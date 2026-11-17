/**
 * Google Ads Script: Search Query Negatives Consolidator (single account)
 *
 * Shrinks shared negative keyword lists without blocking less traffic: many
 * [exact match] negatives that share the same words (e.g. 30 x "[cheap
 * flights to ...]") are replaced by ONE "phrase match" negative ("cheap
 * flights"). Negatives that are already blocked by another negative in the
 * list are removed. This keeps lists far below Google's limit of 5,000
 * negatives per list - ideal companion of the "Search Query Excluder", which
 * fills such lists with exact negatives.
 *
 * Features
 *   - Step 1: removes redundant negatives (duplicates, exact/phrase negatives
 *     already covered by a phrase or broad negative in the same list)
 *   - Step 2: replaces groups of exact negatives by one phrase negative
 *     (greedy set cover over 2-5 word n-grams)
 *   - Single terms: an off-topic word found in several negatives ("karate")
 *     becomes ONE one-word phrase negative; word families (boxen, kickboxen,
 *     kinderboxen, boxclub, boxing) are recognized and excluded together
 *   - Reports negatives that contradict the rule (match the positive pattern
 *     or block an own keyword) - they cost relevant traffic
 *   - Safety nets: a new phrase is never added if it matches your positive
 *     pattern, appears in one of your own keywords or in a relevant /
 *     converting search term of the campaigns using the list
 *   - Dry run, HTML summary e-mail (en/de) with CSV backup of every removed
 *     negative, optional Google Sheet for rules and log
 *   - Can share the "rules" tab with the Search Query Excluder
 *
 * @name        Search Query Negatives Consolidator
 * @version     1.1.0
 * @author      Richard Stinauer (adtraffic) <rs@adtraffic.de>
 * @copyright   (c) 2026 adtraffic - https://www.adtraffic.de
 * @license     MIT - see LICENSE file or https://opensource.org/licenses/MIT
 *
 * Setup
 *   1. Google Ads > Tools > Bulk actions > Scripts > + > paste this file.
 *   2. Adjust the SETTINGS block below (at least RULES or SPREADSHEET_URL,
 *      and NOTIFY_EMAILS).
 *   3. Authorize, run "Preview" once, check the log / e-mail.
 *   4. Set DRY_RUN = false and schedule the script (e.g. weekly).
 *
 * Changelog
 *   1.1.0  2026-11-17  Single terms ("karate"), word families (boxen, kickboxen,
 *                       boxclub), detection of negatives contradicting the rule.
 *   1.0.0  2026-11-17  First public single-account release.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND. Always
 * test with DRY_RUN = true before letting the script change your account.
 */

// ===========================================================================
// SETTINGS
// ===========================================================================

// true = nothing is changed in the account, the script only reports what it
// would do. Switch to false once the dry run looks plausible.
const DRY_RUN = true;

// Optional: URL of a Google Sheet holding the rules (tab "rules"). If set, the
// RULES below are ignored. Leave empty ('') to use the RULES in this script.
// You can use the same sheet as the Search Query Excluder: both scripts read
// the tab "rules". The consolidator writes its own tab "consolidator_log".
const SPREADSHEET_URL = '';

// Rules used when SPREADSHEET_URL is empty. One object per negative list.
//   listName        Name of the shared negative keyword list to consolidate
//   positivePattern Regex (case-insensitive) describing RELEVANT searches.
//                   A new phrase negative matching it is never added.
//                   Recommended - same pattern as in the Search Query Excluder.
//   campaignFilter  Campaigns whose search terms and keywords are used for the
//                   safety check, '%' = wildcard. '' = all campaigns the list
//                   is attached to.
//   minCoverage     Optional: min. number of exact negatives one new phrase
//                   negative must replace (default MIN_COVERAGE)
//   mode            'live' or 'test' (test = report only, like DRY_RUN)
//   active          false = rule is ignored
const RULES = [
  {
    listName: 'SQE - AI Max negatives',
    positivePattern: '(shoe|sneaker|boot)s?',
    campaignFilter: '%AI Max%',
    mode: 'live',
    active: true
  }
];

// Recipients of the summary e-mail. Empty list = no e-mail.
const NOTIFY_EMAILS = ['you@example.com'];

// false = only send an e-mail if something was changed / planned or went wrong
const SEND_EMAIL_IF_NOTHING_CHANGED = false;

// Language of the e-mail: 'en' or 'de'
const EMAIL_LANGUAGE = 'en';

// Maximum number of rows per table and list in the e-mail
const EMAIL_MAX_ROWS_PER_LIST = 50;

// Attach a CSV with every removed (or to be removed) negative to the e-mail.
// Your backup: re-upload it via Google Ads Editor if you want to undo a run.
const ATTACH_BACKUP_CSV = true;

// --- Consolidation -----------------------------------------------------------

// Min. number of exact negatives a new phrase negative must replace
const MIN_COVERAGE = 8;

// Length of the phrase negatives in words. 1 word phrases are very broad,
// therefore MIN_WORDS = 2 is recommended.
const MIN_WORDS = 2;
const MAX_WORDS = 5;

// Step 1: remove duplicates and negatives already covered by another
// phrase / broad negative of the same list (no traffic impact)
const REMOVE_REDUNDANT_NEGATIVES = true;

// --- Single terms and word families ---------------------------------------

// Replace all exact negatives containing an obviously off-topic word by ONE
// one-word phrase negative: [karate landshut], [karate für kinder], [karate]
// -> "karate". A term must occur in at least SINGLE_TERM_MIN_COVERAGE
// negatives. If all its negatives share more words, the phrase is extended
// ([kung fu landshut], [kung fu kurse] -> "kung fu").
const SINGLE_TERMS = true;
const SINGLE_TERM_MIN_COVERAGE = 3;

// Word families: words sharing a stem (boxen, kickboxen, kinderboxen,
// boxclub, boxing) count together. If the family reaches
// SINGLE_TERM_MIN_COVERAGE, EVERY member becomes a phrase negative - even if
// it occurs only once. (Google Ads has no substring negatives, so each word
// form needs its own negative.)
const WORD_FAMILIES = true;
const MIN_ROOT_LENGTH = 3;

// Words that never become one-word negatives because they also appear in
// relevant searches (locations, audiences, prices, ...). Add account-specific
// words (cities, brand names, services) to PROTECTED_WORDS or to the rule.
const GENERIC_WORDS = 'nähe naehe near nearby umgebung meiner deiner ' +
  'kinder kind kids kid jugendliche teenager erwachsene frauen männer damen herren senioren anfänger ' +
  'baby babys schüler familie familien ' +
  'preis preise kosten kostenlos gratis free günstig billig angebot angebote rabatt gutschein ' +
  'kurs kurse kursplan training trainer lernen schule verein club studio center zentrum ' +
  'probetraining probestunde anmeldung termin termine zeiten öffnungszeiten adresse telefon kontakt ' +
  'übung übungen workout workouts kurse lehrer unterricht stunde stunden ' +
  'online kaufen bestellen shop test erfahrungen bewertung bewertungen vergleich ' +
  'jobs job ausbildung beste bester besten gut gute guter neu neue jahre jahren alter ab bis ' +
  'deutschland germany stadt city kids for near me best cheap price prices cost course courses class classes school';
const PROTECTED_WORDS = '';

// Negatives that contradict the rule (they match the positive pattern or
// block an own keyword / relevant search term) are always reported.
// true = also remove them from the list.
const REMOVE_CONFLICTING_NEGATIVES = false;

// Filler words. A phrase consisting only of them is never used, and with
// SKIP_STOPWORD_EDGES a phrase must neither start nor end with one.
const STOPWORDS = 'a an and at for in of on or the to with without me my is are ' +
  'der die das des dem den ein eine einer eines einem einen an am im in zu zur zum bei auf für fuer und oder ' +
  'von vom mit ohne ist sind mir mich mein meine meiner';
const SKIP_STOPWORD_EDGES = true;

// --- Safety nets ---------------------------------------------------------------

// Check new phrases against the search terms of the campaigns (see
// campaignFilter). A phrase is rejected if it is contained in a search term
// that matches the positive pattern or had conversions.
const CHECK_SEARCH_TERMS = true;

// Date range for this check: 'LAST_30_DAYS' etc. or a number of days
const CHECK_DATE_RANGE = 90;

// Search terms with conversions count as relevant, even without pattern match
const PROTECT_CONVERTING_TERMS = true;

// Reject phrases contained in one of your own (positive) keywords
const PROTECT_OWN_KEYWORDS = true;

// Also test the pattern against an umlaut-free version of the text
// (ä->ae, ö->oe, ü->ue, ß->ss), so 'maenner' in the pattern matches 'männer'.
const MATCH_TRANSLITERATED = true;

// Limits per list and run (the rest follows in the next run)
const MAX_NEW_PHRASES_PER_LIST = 100;
const MAX_REMOVALS_PER_LIST = 2000;

// ===========================================================================
// No changes needed below this line.
// ===========================================================================

const SCRIPT_NAME = 'Search Query Negatives Consolidator';
const SCRIPT_VERSION = '1.1.0';
const SCRIPT_URL = 'https://www.adtraffic.de';

const RULES_SHEET = 'rules';
const LOG_SHEET = 'consolidator_log';

const LIMITS = {
  maxKeywordChars: 80,
  maxKeywordWords: 10,
  maxKeywordsPerList: 5000
};

const DATE_LITERALS = [
  'TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS',
  'LAST_BUSINESS_WEEK', 'THIS_MONTH', 'LAST_MONTH', 'THIS_WEEK_SUN_TODAY',
  'THIS_WEEK_MON_TODAY', 'LAST_WEEK_SUN_SAT', 'LAST_WEEK_MON_SUN'
];

const RULE_DEFAULTS = {
  listName: '',
  positivePattern: '',
  campaignFilter: '',
  minCoverage: '',
  singleMinCoverage: '',
  protectedWords: '',
  mode: 'live',
  consolidatorMode: '',
  consolidate: true,
  active: true
};

const RULE_HEADER = ['active', 'campaignFilter', 'listName', 'positivePattern', 'dateRange', 'minImpressions', 'mode', 'consolidate', 'consolidatorMode', 'minCoverage', 'singleMinCoverage', 'protectedWords', 'notes'];
const LOG_HEADER = ['timestamp', 'list', 'action', 'negative', 'matchType', 'replaces', 'reason'];

// Header aliases, compatible with the Search Query Excluder sheet
const HEADER_ALIASES = {
  active: ['active', 'enabled', 'aktiv'],
  campaignFilter: ['campaignfilter', 'campaign', 'kampagnenfilter'],
  listName: ['listname', 'negativelist', 'list', 'listenname'],
  positivePattern: ['positivepattern', 'positivestrings', 'pattern', 'regex', 'erlaubtebegriffe'],
  mode: ['mode', 'modeliveortest', 'modus'],
  consolidate: ['consolidate', 'consolidation', 'konsolidieren'],
  consolidatorMode: ['consolidatormode', 'consolidationmode', 'konsolidierungsmodus'],
  minCoverage: ['mincoverage', 'mindestabdeckung'],
  singleMinCoverage: ['singlemincoverage', 'singletermmincoverage', 'mindestabdeckungeinzelbegriff'],
  protectedWords: ['protectedwords', 'geschuetztewoerter', 'geschütztewörter', 'geschtztewrter']
};

const ACTION = {
  added: 'ADDED',
  wouldAdd: 'WOULD_ADD',
  removed: 'REMOVED',
  wouldRemove: 'WOULD_REMOVE',
  rejected: 'REJECTED',
  conflict: 'CONFLICT',
  postponed: 'POSTPONED',
  failed: 'FAILED'
};

const STOPWORD_SET = STOPWORDS.split(/\s+/).filter(Boolean).reduce((m, w) => { m[w] = true; return m; }, {});

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (typeof AdsManagerApp !== 'undefined' && isManagerAccount()) {
    throw new Error('This is the single-account version. Please run it inside a client account, not in a manager account (MCC).');
  }

  const account = AdsApp.currentAccount();
  const context = {
    accountName: account.getName(),
    accountId: account.getCustomerId(),
    currency: account.getCurrencyCode(),
    timeZone: account.getTimeZone(),
    startedAt: new Date(),
    spreadsheet: SPREADSHEET_URL ? openSpreadsheet(SPREADSHEET_URL) : null
  };

  console.log(`${SCRIPT_NAME} v${SCRIPT_VERSION} - ${context.accountName} (${context.accountId})${DRY_RUN ? ' - DRY RUN' : ''}`);

  const loaded = context.spreadsheet ? loadRulesFromSheet(context.spreadsheet) : { rules: RULES.map((r, i) => Object.assign({ id: `#${i + 1}` }, r)), problems: [] };
  const parsed = validateRules(loaded.rules);
  const problems = loaded.problems.concat(parsed.problems);
  const groups = groupRulesByList(parsed.rules);

  problems.forEach(p => console.warn(p));
  console.log(`${groups.length} list(s) to consolidate.`);

  const listCache = loadNegativeKeywordLists();
  const results = [];

  for (const group of groups) {
    try {
      results.push(processList(group, context, listCache));
    } catch (e) {
      console.error(`List "${group.listName}": ${e.message}`);
      results.push(emptyResult(group, e.message));
    }
  }

  if (context.spreadsheet) {
    writeLog(context.spreadsheet, results, context);
  }

  logSummary(results);
  sendSummaryMail(results, problems, context);
}

// ---------------------------------------------------------------------------
// List processing
// ---------------------------------------------------------------------------

function processList(group, context, listCache) {
  const result = emptyResult(group);
  const list = listCache[group.listName];

  console.log(`List "${group.listName}"${group.testMode ? ' (test)' : ''}`);

  if (!list) {
    result.errors.push(`Negative keyword list "${group.listName}" not found.`);
    return result;
  }

  // 1. Read list and safety data
  const negatives = readNegatives(list);
  const patterns = group.patterns.map(p => new RegExp(p, 'i'));
  const scope = scopeConditions(group, list);
  const protectedTerms = fetchProtectedTerms(scope, patterns, context);

  result.scope = scope.label;
  result.protectedCount = protectedTerms.length;

  if (patterns.length === 0) {
    result.warnings.push('No positivePattern set - new phrases are only checked against own keywords and converting search terms.');
  }

  console.log(`  ${negatives.length} negatives, ${protectedTerms.length} protected terms/keywords (${scope.label}).`);

  // 2. Plan (pure function)
  const plan = planConsolidation(negatives, {
    minCoverage: group.minCoverage,
    minWords: MIN_WORDS,
    maxWords: MAX_WORDS,
    removeRedundant: REMOVE_REDUNDANT_NEGATIVES,
    removeConflicting: REMOVE_CONFLICTING_NEGATIVES,
    singleTerms: SINGLE_TERMS,
    singleMinCoverage: group.singleMinCoverage,
    wordFamilies: WORD_FAMILIES,
    minRootLength: MIN_ROOT_LENGTH,
    protectedWords: toWordSet([GENERIC_WORDS, PROTECTED_WORDS].concat(group.protectedWords)),
    maxNewPhrases: MAX_NEW_PHRASES_PER_LIST,
    maxRemovals: MAX_REMOVALS_PER_LIST
  }, { patterns: patterns, protectedTerms: protectedTerms });

  Object.assign(result, {
    before: plan.before,
    after: plan.after,
    redundant: plan.redundant,
    conflicting: plan.conflicting,
    phrases: plan.phrases,
    rejected: plan.rejected,
    postponed: plan.postponed
  });

  if (plan.conflicting.length > 0 && !REMOVE_CONFLICTING_NEGATIVES) {
    result.warnings.push(`${plan.conflicting.length} negative(s) contradict the rule and may block relevant traffic - please check (or set REMOVE_CONFLICTING_NEGATIVES = true).`);
  }

  if (plan.postponed.length > 0) {
    result.warnings.push(`${plan.postponed.length} change(s) postponed to the next run (limit per run reached).`);
  }

  console.log(`  ${plan.redundant.length} redundant, ${plan.phrases.length} new phrase(s) replacing ${plan.phrases.reduce((n, p) => n + p.replaced.length + p.alsoCovers.length, 0)} negative(s), ${plan.rejected.length} candidate(s) rejected.`);
  console.log(`  ${plan.before} -> ${plan.after} negatives.`);

  // 3. Execute
  if (!group.testMode) {
    executePlan(list, plan, result);
  }

  return result;
}

function emptyResult(group, error) {
  return {
    group: group,
    listName: group.listName,
    testMode: group.testMode,
    before: 0,
    after: 0,
    redundant: [],
    conflicting: [],
    phrases: [],
    rejected: [],
    postponed: [],
    failed: [],
    scope: '',
    protectedCount: 0,
    errors: error ? [error] : [],
    warnings: []
  };
}

// Pure function: decides which negatives are removed and which phrase
// negatives are added (testable without Google Ads).
//   negatives  [{ text, type: 'EXACT'|'PHRASE'|'BROAD', kw }]
//   options    { minCoverage, minWords, maxWords, removeRedundant, removeConflicting,
//                singleTerms, singleMinCoverage, wordFamilies, minRootLength,
//                protectedWords: { word: true }, maxNewPhrases, maxRemovals }
//   guard      { patterns: [RegExp], protectedTerms: [{ text, reason }] }
function planConsolidation(negatives, options, guard) {
  const plan = { before: negatives.length, after: negatives.length, redundant: [], conflicting: [], phrases: [], rejected: [], postponed: [] };
  const redundant = [];
  const protectedIndex = buildWordIndex(guard.protectedTerms);
  const patternWords = extractPatternWords(guard.patterns);
  const protectedWords = options.protectedWords || {};

  // Step 0: negatives contradicting the rule (match the positive pattern or
  // block an own keyword / relevant search term). Never consolidated.
  const valid = [];

  negatives.forEach(n => {
    const conflict = findConflict(n, guard, protectedIndex);

    if (conflict) {
      plan.conflicting.push(Object.assign({}, n, { reason: conflict }));
    } else {
      valid.push(n);
    }
  });

  // Step 1a: duplicates (broad negatives are compared as word sets)
  const seen = {};
  const unique = [];

  valid.forEach(n => {
    const key = n.type === 'BROAD' ? `B|${wordSetKey(n.text)}` : `${n.type}|${n.text}`;

    if (seen[key]) {
      redundant.push(Object.assign({}, n, { reason: 'duplicate', coveredBy: formatNegative(seen[key]) }));
      return;
    }

    seen[key] = n;
    unique.push(n);
  });

  // Step 1b: negatives already blocked by a phrase / broad negative of the list
  const phrases = unique.filter(n => n.type === 'PHRASE');
  const broads = unique.filter(n => n.type === 'BROAD');
  const coveredBy = n => {
    if (n.type !== 'BROAD') {
      const p = phrases.find(x => x !== n && containsPhrase(n.text, x.text));
      if (p) {
        return p;
      }
    }
    return broads.find(x => x !== n && containsAllWords(n.text, x.text)) || null;
  };

  const exacts = [];
  const keptPhrases = [];

  unique.forEach(n => {
    const c = coveredBy(n);

    if (c) {
      redundant.push(Object.assign({}, n, { reason: 'covered', coveredBy: formatNegative(c) }));
    } else if (n.type === 'EXACT') {
      exacts.push(n);
    } else if (n.type === 'PHRASE') {
      keptPhrases.push(n);
    }
  });

  if (!options.removeRedundant) {
    // Redundant negatives stay, but covered exacts are not consolidated either
    redundant.length = 0;
  }

  // Step 2: candidates from the remaining exact negatives
  const words = exacts.map(n => n.text.split(' '));
  const maxWords = Math.min(options.maxWords, LIMITS.maxKeywordWords);
  const coverage = {};      // multi-word n-grams
  const wordCoverage = {};  // single words

  words.forEach((w, idx) => {
    const local = {};
    for (let n = 1; n <= maxWords; n++) {
      for (let i = 0; i + n <= w.length; i++) {
        const gram = w.slice(i, i + n).join(' ');
        if (!local[gram]) {
          local[gram] = true;
          const target = n === 1 ? wordCoverage : coverage;
          (target[gram] || (target[gram] = [])).push(idx);
        }
      }
    }
  });

  const candidates = {};
  const rejected = {};
  const reject = (phrase, count, reason) => {
    if (!rejected[phrase] || rejected[phrase].coverage < count) {
      rejected[phrase] = { phrase: phrase, coverage: count, reason: reason };
    }
  };
  const addCandidate = (phrase, idx, min, basis, requires) => {
    const existing = candidates[phrase];
    if (!existing) {
      candidates[phrase] = { phrase: phrase, idx: idx, words: phrase.split(' ').length, min: min, basis: basis, requires: requires || null };
    } else if (min < existing.min && existing.requires) {
      existing.requires = existing.requires.concat(requires || []);
    }
  };

  // 2a: multi-word phrases (n-grams) shared by many exact negatives
  Object.keys(coverage).forEach(gram => {
    const count = coverage[gram].length;
    if (gram.split(' ').length < Math.max(options.minWords, 2) || count < options.minCoverage) {
      return;
    }
    const check = checkCandidate(gram, guard, protectedIndex);
    if (check.reason) {
      if (!check.silent) {
        reject(gram, count, check.reason);
      }
      return;
    }
    addCandidate(gram, coverage[gram], options.minCoverage, 'phrase');
  });

  // 2b: single terms ("karate") and word families ("boxen", "kickboxen", "boxclub")
  if (options.singleTerms) {
    const termCheck = {};
    const checkTerm = word => {
      if (termCheck[word] === undefined) {
        termCheck[word] = checkSingleTerm(word, guard, protectedIndex, protectedWords, patternWords);
      }
      return termCheck[word];
    };

    // A single term is extended to the longest phrase all its negatives share
    // ("kung" -> "kung fu"), so it never gets broader than necessary.
    const termPhrase = {};
    const useTerm = (word, min, basis, requires) => {
      const idx = wordCoverage[word];
      const phrase = idx.length >= 2 ? extendPhrase(word, idx, words, maxWords) : word;
      if (phrase !== word && checkCandidate(phrase, guard, protectedIndex).reason) {
        return;
      }
      termPhrase[word] = phrase;
      addCandidate(phrase, idx, Math.min(min, idx.length), basis, requires);
    };

    Object.keys(wordCoverage).forEach(word => {
      const count = wordCoverage[word].length;
      if (count < options.singleMinCoverage) {
        return;
      }
      const check = checkTerm(word);
      if (check.reason) {
        if (!check.silent) {
          reject(word, count, check.reason);
        }
        return;
      }
      useTerm(word, options.singleMinCoverage, 'term');
    });

    if (options.wordFamilies) {
      // A family needs an anchor: a word of the family that qualifies as a
      // single term on its own (e.g. "boxen" in 4 negatives). Members are
      // words starting with the anchor's stem (boxing, boxclub) or
      // containing the anchor itself (kickboxen, kinderboxen).
      const anchors = {};
      Object.keys(wordCoverage).forEach(word => {
        const root = stemWord(word);
        if (root.length >= options.minRootLength && wordCoverage[word].length >= options.singleMinCoverage && !checkTerm(word).reason) {
          (anchors[root] || (anchors[root] = [])).push(word);
        }
      });

      Object.keys(anchors).forEach(root => {
        const anchorWords = anchors[root];
        const anchorPhrases = anchorWords.map(a => termPhrase[a]).filter(Boolean);
        if (anchorPhrases.length === 0) {
          return;
        }
        Object.keys(wordCoverage)
          .filter(w => !anchorWords.includes(w))
          .filter(w => w.indexOf(root) === 0 || anchorWords.some(a => a.length >= 4 && w.indexOf(a) >= 0))
          .filter(w => !checkTerm(w).reason)
          .forEach(m => useTerm(m, 1, `family ${root}*`, anchorPhrases));
      });
    }
  }

  plan.rejected = Object.keys(rejected).map(k => rejected[k]).filter(r => !candidates[r.phrase]).sort((a, b) => b.coverage - a.coverage);

  // Greedy set cover: most replaced negatives first, on a tie the more
  // specific phrase. Every candidate has its own minimum (families: 1).
  const pool = Object.keys(candidates).map(k => candidates[k]);
  const open = {};
  words.forEach((_, i) => { open[i] = true; });
  const selected = [];
  const selectedPhrases = {};

  while (true) {
    let best = null;
    let bestCount = 0;

    for (const c of pool) {
      let count = 0;
      for (const i of c.idx) {
        if (open[i]) {
          count++;
        }
      }
      if (count < c.min || count === 0) {
        continue;
      }
      // family members only follow once their anchor ("boxen") was selected
      if (c.requires && !c.requires.some(r => selectedPhrases[r])) {
        continue;
      }
      if (count > bestCount || (count === bestCount && best && c.words > best.words)) {
        best = c;
        bestCount = count;
      }
    }

    if (!best) {
      break;
    }

    const replaced = best.idx.filter(i => open[i]).map(i => { delete open[i]; return exacts[i]; });
    const alsoCovers = keptPhrases.filter(p => !p.coveredByNew && containsPhrase(p.text, best.phrase));
    alsoCovers.forEach(p => { p.coveredByNew = true; });

    selected.push({ phrase: best.phrase, negative: formatNegative({ text: best.phrase, type: 'PHRASE' }), basis: best.basis, replaced: replaced, alsoCovers: alsoCovers });
    selectedPhrases[best.phrase] = true;
    pool.splice(pool.indexOf(best), 1);
  }

  keptPhrases.forEach(p => { delete p.coveredByNew; });

  // Limits per run
  let removals = 0;
  const removable = (options.removeConflicting ? plan.conflicting.map(n => Object.assign({}, n, { coveredBy: '' })) : []).concat(redundant);

  removable.forEach(n => {
    if (removals < options.maxRemovals) {
      plan.redundant.push(n);
      removals++;
    } else {
      plan.postponed.push({ text: formatNegative(n), reason: 'removal limit' });
    }
  });

  selected.forEach(p => {
    const cost = p.replaced.length + p.alsoCovers.length;

    if (plan.phrases.length >= options.maxNewPhrases || removals + cost > options.maxRemovals) {
      plan.postponed.push({ text: p.negative, reason: 'limit per run' });
      return;
    }

    plan.phrases.push(p);
    removals += cost;
  });

  plan.after = plan.before - removals + plan.phrases.length;
  return plan;
}

// Returns a reason if the negative blocks what the rule declares relevant
function findConflict(n, guard, protectedIndex) {
  for (const re of guard.patterns) {
    if (matchesPattern(re, n.text)) {
      return 'matches positive pattern';
    }
  }

  const w = n.text.split(' ');
  let pool = null;
  for (const x of w) {
    const hits = protectedIndex.byWord[x] || [];
    if (!pool || hits.length < pool.length) {
      pool = hits;
    }
  }

  for (const i of pool || []) {
    const p = protectedIndex.items[i];
    const blocks = n.type === 'EXACT' ? p.text === n.text : n.type === 'PHRASE' ? containsPhrase(p.text, n.text) : containsAllWords(p.text, n.text);
    if (blocks) {
      return `blocks ${p.reason} "${p.text}"`;
    }
  }

  return '';
}

// Returns { reason, silent }. reason '' = candidate is safe.
function checkCandidate(gram, guard, protectedIndex) {
  const w = gram.split(' ');

  if (gram.length + 2 > LIMITS.maxKeywordChars) {
    return { reason: 'too long', silent: true };
  }

  if (!w.some(x => !STOPWORD_SET[x])) {
    return { reason: 'stopwords only', silent: true };
  }

  if (SKIP_STOPWORD_EDGES && (STOPWORD_SET[w[0]] || STOPWORD_SET[w[w.length - 1]])) {
    return { reason: 'starts or ends with a stopword', silent: true };
  }

  for (const re of guard.patterns) {
    if (matchesPattern(re, gram)) {
      return { reason: 'matches positive pattern', silent: false };
    }
  }

  // Only protected texts containing the rarest word of the phrase need a check
  let pool = null;
  for (const x of w) {
    const hits = protectedIndex.byWord[x] || [];
    if (!pool || hits.length < pool.length) {
      pool = hits;
    }
  }

  for (const i of pool || []) {
    const p = protectedIndex.items[i];
    if (containsPhrase(p.text, gram)) {
      return { reason: `would block ${p.reason} "${p.text}"`, silent: false };
    }
  }

  return { reason: '', silent: false };
}

// Extra checks for one-word negatives, which block the most traffic
function checkSingleTerm(word, guard, protectedIndex, protectedWords, patternWords) {
  if (word.length < 3 || /^\d+$/.test(word) || STOPWORD_SET[word]) {
    return { reason: 'too short / stopword / number', silent: true };
  }

  if (protectedWords[word] || protectedWords[transliterate(word)]) {
    return { reason: 'generic or protected word', silent: false };
  }

  if (patternWords.some(p => p.indexOf(word) >= 0 || p.indexOf(transliterate(word)) >= 0)) {
    return { reason: 'part of the positive pattern', silent: false };
  }

  return checkCandidate(word, guard, protectedIndex);
}

// Longest word sequence around `word` that all negatives idx share
function extendPhrase(word, idx, words, maxWords) {
  const occ = idx.map(i => ({ w: words[i], p: words[i].indexOf(word) }));
  const same = offset => {
    const first = occ[0].w[occ[0].p + offset];
    return first !== undefined && occ.every(o => o.w[o.p + offset] === first);
  };
  let left = 0;
  let right = 0;

  while (left + right + 1 < maxWords && same(-(left + 1))) {
    left++;
  }
  while (left + right + 1 < maxWords && same(right + 1)) {
    right++;
  }

  let phrase = occ[0].w.slice(occ[0].p - left, occ[0].p + right + 1);

  // no filler words at the edges ("karate in" -> "karate")
  while (phrase.length > 1 && STOPWORD_SET[phrase[0]] && phrase[0] !== word) {
    phrase.shift();
  }
  while (phrase.length > 1 && STOPWORD_SET[phrase[phrase.length - 1]] && phrase[phrase.length - 1] !== word) {
    phrase.pop();
  }

  return phrase.join(' ');
}

// Light stemming for word families: boxen -> box, karate -> karat
function stemWord(word) {
  const suffixes = ['ungen', 'ung', 'ern', 'en', 'er', 'ing', 'es', 'e', 'n', 's'];
  for (const s of suffixes) {
    if (word.length - s.length >= 3 && word.slice(-s.length) === s) {
      return word.slice(0, -s.length);
    }
  }
  return word;
}

// Literal words of the positive patterns ("kampf", "sport", "selbstverteidigung")
function extractPatternWords(patterns) {
  const out = [];
  patterns.forEach(re => {
    re.source
      .replace(/\\[a-zA-Z]/g, ' ')
      .replace(/\[[^\]]*\]|\{[^}]*\}/g, ' ')
      .toLowerCase()
      .split(/[^a-z0-9äöüßéèáàóòúùâêîôûç]+/)
      .filter(w => w.length >= 4)
      .forEach(w => out.push(w, transliterate(w)));
  });
  return out;
}

function buildWordIndex(items) {
  const byWord = {};

  items.forEach((item, i) => {
    const local = {};
    item.text.split(' ').forEach(w => {
      if (!local[w]) {
        local[w] = true;
        (byWord[w] || (byWord[w] = [])).push(i);
      }
    });
  });

  return { items: items, byWord: byWord };
}

function matchesPattern(re, text) {
  return re.test(text) || (MATCH_TRANSLITERATED && re.test(transliterate(text)));
}

// true if `needle` occurs in `haystack` as consecutive whole words (phrase match)
function containsPhrase(haystack, needle) {
  return ` ${haystack} `.indexOf(` ${needle} `) >= 0;
}

// true if all words of `needle` occur in `haystack` in any order (broad match)
function containsAllWords(haystack, needle) {
  const h = {};
  haystack.split(' ').forEach(w => { h[w] = true; });
  return needle.split(' ').every(w => h[w]);
}

function wordSetKey(text) {
  return text.split(' ').filter((w, i, a) => a.indexOf(w) === i).sort().join(' ');
}

function formatNegative(n) {
  return n.type === 'PHRASE' ? `"${n.text}"` : n.type === 'BROAD' ? n.text : `[${n.text}]`;
}

function normalizeTerm(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function transliterate(text) {
  return text.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

// ---------------------------------------------------------------------------
// Rules: validation, grouping and Google Sheet
// ---------------------------------------------------------------------------

function validateRules(rawRules) {
  const rules = [];
  const problems = [];

  rawRules.forEach(raw => {
    const r = Object.assign({}, RULE_DEFAULTS);
    Object.keys(raw).forEach(k => {
      if (raw[k] !== '' && raw[k] !== null && raw[k] !== undefined) {
        r[k] = raw[k];
      }
    });
    r.id = raw.id;

    if (!toBool(r.active) || !toBool(r.consolidate)) {
      return;
    }

    r.listName = String(r.listName).trim();
    r.positivePattern = String(r.positivePattern).trim();
    r.campaignFilter = String(r.campaignFilter).trim();
    r.mode = String(r.consolidatorMode || r.mode).trim().toLowerCase() === 'test' ? 'test' : 'live';
    r.minCoverage = r.minCoverage === '' ? null : parseInt(r.minCoverage, 10);
    r.singleMinCoverage = r.singleMinCoverage === '' ? null : parseInt(r.singleMinCoverage, 10);
    r.protectedWords = String(r.protectedWords || '');

    if (!r.listName) {
      problems.push(`Rule ${r.id}: listName is missing.`);
      return;
    }

    if (r.positivePattern) {
      try {
        new RegExp(r.positivePattern, 'i');
      } catch (e) {
        problems.push(`Rule ${r.id}: invalid positivePattern - ${e.message}`);
        return;
      }
    }

    if (r.minCoverage !== null && (isNaN(r.minCoverage) || r.minCoverage < 2)) {
      problems.push(`Rule ${r.id}: invalid minCoverage (min. 2).`);
      return;
    }

    if (r.singleMinCoverage !== null && (isNaN(r.singleMinCoverage) || r.singleMinCoverage < 2)) {
      problems.push(`Rule ${r.id}: invalid singleMinCoverage (min. 2).`);
      return;
    }

    rules.push(r);
  });

  return { rules: rules, problems: problems };
}

// Several rules may use the same list (e.g. one per campaign group). The list
// is consolidated once; all their patterns and campaign filters protect it.
function groupRulesByList(rules) {
  const groups = [];
  const byName = {};

  rules.forEach(r => {
    let g = byName[r.listName];

    if (!g) {
      g = byName[r.listName] = { listName: r.listName, ruleIds: [], patterns: [], campaignFilters: [], useAttached: false, testMode: DRY_RUN, minCoverage: null, singleMinCoverage: null, protectedWords: [] };
      groups.push(g);
    }

    g.ruleIds.push(r.id);

    if (r.positivePattern && !g.patterns.includes(r.positivePattern)) {
      g.patterns.push(r.positivePattern);
    }

    if (r.campaignFilter) {
      if (!g.campaignFilters.includes(r.campaignFilter)) {
        g.campaignFilters.push(r.campaignFilter);
      }
    } else {
      g.useAttached = true;
    }

    if (r.mode === 'test') {
      g.testMode = true; // conservative: one rule in test mode = list in test mode
    }

    if (r.minCoverage) {
      g.minCoverage = Math.max(g.minCoverage || 0, r.minCoverage);
    }

    if (r.singleMinCoverage) {
      g.singleMinCoverage = Math.max(g.singleMinCoverage || 0, r.singleMinCoverage);
    }

    if (r.protectedWords) {
      g.protectedWords.push(r.protectedWords);
    }
  });

  groups.forEach(g => {
    g.minCoverage = Math.max(g.minCoverage || MIN_COVERAGE, 2);
    g.singleMinCoverage = Math.max(g.singleMinCoverage || SINGLE_TERM_MIN_COVERAGE, 2);
  });

  return groups;
}

function toWordSet(texts) {
  const set = {};
  texts.forEach(t => String(t || '').toLowerCase().split(/[\s,;]+/).filter(Boolean).forEach(w => {
    set[w] = true;
    set[transliterate(w)] = true;
  }));
  return set;
}

function toBool(value) {
  if (value === true || value === false) {
    return value;
  }
  return !['false', 'no', 'nein', '0', 'off', 'inactive'].includes(String(value).trim().toLowerCase());
}

function openSpreadsheet(url) {
  try {
    return SpreadsheetApp.openByUrl(url);
  } catch (e) {
    throw new Error(`Cannot open spreadsheet (${e.message}). Check SPREADSHEET_URL and access rights.`);
  }
}

function loadRulesFromSheet(ss) {
  let sheet = ss.getSheetByName(RULES_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(RULES_SHEET);
    sheet.getRange(1, 1, 1, RULE_HEADER.length).setValues([RULE_HEADER]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return { rules: [], problems: [`Tab "${RULES_SHEET}" was created. Please add your rules there and run the script again.`] };
  }

  const values = sheet.getDataRange().getValues();

  if (values.length < 2) {
    return { rules: [], problems: [`Tab "${RULES_SHEET}" contains no rules.`] };
  }

  return parseRuleRows(values);
}

// Pure function: sheet values (incl. header row) -> rule objects
function parseRuleRows(values) {
  const header = values[0].map(h => String(h).toLowerCase().replace(/[^a-z]/g, ''));
  const columns = {};
  const problems = [];

  Object.keys(HEADER_ALIASES).forEach(key => {
    const index = header.findIndex(h => HEADER_ALIASES[key].includes(h));
    if (index >= 0) {
      columns[key] = index;
    }
  });

  if (columns.listName === undefined) {
    return { rules: [], problems: [`Tab "${RULES_SHEET}": column "listName" not found.`] };
  }

  const rules = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i];

    if (row.every(cell => String(cell).trim() === '')) {
      continue;
    }

    const rule = { id: `row ${i + 1}` };
    Object.keys(columns).forEach(key => { rule[key] = row[columns[key]]; });
    rules.push(rule);
  }

  return { rules: rules, problems: problems };
}

// Rows for the log tab and the backup CSV
function buildLogRows(results, timestamp) {
  const rows = [];

  for (const r of results) {
    const done = !r.testMode;
    const removedAction = done ? ACTION.removed : ACTION.wouldRemove;
    const failedTexts = {};
    r.failed.filter(f => f.kind !== 'add').forEach(f => { failedTexts[f.text] = true; });
    const row = (action, negative, type, replaces, reason) => [timestamp, r.listName, failedTexts[negative] ? ACTION.failed : action, negative, type, replaces || '', reason || ''];

    r.redundant.forEach(n => rows.push(row(removedAction, formatNegative(n), n.type, '', n.coveredBy ? `${n.reason}: ${n.coveredBy}` : n.reason)));
    if (!REMOVE_CONFLICTING_NEGATIVES) {
      r.conflicting.forEach(n => rows.push(row(ACTION.conflict, formatNegative(n), n.type, '', n.reason)));
    }

    r.phrases.forEach(p => {
      rows.push(row(done ? ACTION.added : ACTION.wouldAdd, p.negative, 'PHRASE', p.replaced.length + p.alsoCovers.length, p.basis));
      p.replaced.concat(p.alsoCovers).forEach(n => rows.push(row(removedAction, formatNegative(n), n.type, '', `replaced by ${p.negative}`)));
    });

    r.failed.filter(f => f.kind === 'add')
      .forEach(f => rows.push(row(ACTION.failed, f.text, 'PHRASE', '', f.reason)));
    r.rejected.forEach(c => rows.push(row(ACTION.rejected,`"${c.phrase}"`, 'PHRASE', c.coverage, c.reason)));
    r.postponed.forEach(c => rows.push(row(ACTION.postponed, c.text, '', '', c.reason)));
  }

  return rows;
}

function writeLog(ss, results, context) {
  const rows = buildLogRows(results, Utilities.formatDate(context.startedAt, context.timeZone, 'yyyy-MM-dd HH:mm:ss'));

  if (rows.length === 0) {
    return;
  }

  try {
    let sheet = ss.getSheetByName(LOG_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(LOG_SHEET);
      sheet.getRange(1, 1, 1, LOG_HEADER.length).setValues([LOG_HEADER]).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }

    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LOG_HEADER.length).setValues(rows);
  } catch (e) {
    console.warn(`Could not write tab "${LOG_SHEET}": ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Google Ads access
// ---------------------------------------------------------------------------

function isManagerAccount() {
  try {
    AdsManagerApp.accounts().get();
    return true;
  } catch (e) {
    return false;
  }
}

function gaqlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function dateCondition(dateRange, context) {
  const range = String(dateRange).trim().toUpperCase();

  if (DATE_LITERALS.includes(range)) {
    return `segments.date DURING ${range}`;
  }

  const days = Math.max(parseInt(range, 10) || 90, 1);
  const end = new Date(context.startedAt.getTime() - 24 * 3600 * 1000);
  const start = new Date(end.getTime() - (days - 1) * 24 * 3600 * 1000);
  const fmt = d => Utilities.formatDate(d, context.timeZone, 'yyyy-MM-dd');
  return `segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'`;
}

// GAQL has no OR, so every campaign filter becomes its own condition
function scopeConditions(group, list) {
  const conditions = group.campaignFilters.map(f => ` AND campaign.name LIKE ${gaqlString(f)}`);
  const labels = group.campaignFilters.map(f => `"${f}"`);

  if (group.useAttached || conditions.length === 0) {
    const ids = [];
    const it = list.campaigns().get();
    while (it.hasNext()) {
      ids.push(it.next().getId());
    }

    if (ids.length > 0) {
      conditions.push(` AND campaign.id IN (${ids.join(',')})`);
      labels.push(`${ids.length} attached campaign(s)`);
    } else if (conditions.length === 0) {
      conditions.push('');
      labels.push('all campaigns');
    }
  }

  return { conditions: conditions, label: labels.join(' + ') };
}

// Search terms and keywords a new phrase negative must never block
function fetchProtectedTerms(scope, patterns, context) {
  const byText = {};
  const add = (text, reason) => {
    const t = normalizeTerm(text);
    if (t && !byText[t]) {
      byText[t] = { text: t, reason: reason };
    }
  };

  for (const cond of scope.conditions) {
    if (PROTECT_OWN_KEYWORDS) {
      const rows = AdsApp.search(
        'SELECT ad_group_criterion.keyword.text FROM keyword_view ' +
        `WHERE ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.negative = FALSE AND campaign.status != 'REMOVED'${cond}`
      );
      while (rows.hasNext()) {
        add(String(rows.next().adGroupCriterion.keyword.text).replace(/[\[\]"+]/g, ''), 'own keyword');
      }
    }

    if (CHECK_SEARCH_TERMS && (patterns.length > 0 || PROTECT_CONVERTING_TERMS)) {
      const conversions = {};
      const rows = AdsApp.search(
        'SELECT search_term_view.search_term, metrics.conversions FROM search_term_view ' +
        `WHERE ${dateCondition(CHECK_DATE_RANGE, context)} AND metrics.impressions > 0 AND campaign.status != 'REMOVED'${cond}`
      );
      while (rows.hasNext()) {
        const row = rows.next();
        const term = normalizeTerm(row.searchTermView.searchTerm);
        conversions[term] = (conversions[term] || 0) + (Number(row.metrics.conversions) || 0);
      }

      Object.keys(conversions).forEach(term => {
        if (patterns.some(re => matchesPattern(re, term))) {
          add(term, 'relevant search term');
        } else if (PROTECT_CONVERTING_TERMS && conversions[term] > 0) {
          add(term, 'converting search term');
        }
      });
    }
  }

  return Object.keys(byText).map(k => byText[k]);
}

function loadNegativeKeywordLists() {
  const lists = {};
  const it = AdsApp.negativeKeywordLists().get();

  while (it.hasNext()) {
    const list = it.next();
    lists[list.getName()] = list;
  }

  return lists;
}

function readNegatives(list) {
  const negatives = [];
  const it = list.negativeKeywords().get();

  while (it.hasNext()) {
    const kw = it.next();
    const rawType = typeof kw.getMatchType === 'function' ? String(kw.getMatchType()).toUpperCase() : 'EXACT';
    const type = rawType === 'PHRASE' || rawType === 'BROAD' ? rawType : 'EXACT';
    const text = normalizeTerm(String(kw.getText()).replace(/^[\["]+|[\]"]+$/g, '').replace(/(^|\s)\+/g, '$1'));

    if (text) {
      negatives.push({ text: text, type: type, kw: kw });
    }
  }

  return negatives;
}

// Removes redundant negatives first (frees capacity), then adds each phrase
// and only removes the negatives it replaces once the phrase was accepted.
function executePlan(list, plan, result) {
  let removed = 0;
  let added = 0;
  const remove = n => {
    try {
      n.kw.remove();
      removed++;
    } catch (e) {
      result.failed.push({ text: formatNegative(n), reason: e.message });
    }
  };

  plan.redundant.forEach(remove);

  for (const p of plan.phrases) {
    try {
      list.addNegativeKeyword(p.negative);
      added++;
    } catch (e) {
      result.failed.push({ text: p.negative, reason: `rejected by Google Ads: ${e.message}`, kind: 'add' });
      p.failed = true;
      continue;
    }
    p.replaced.concat(p.alsoCovers).forEach(remove);
  }

  // Phrases that could not be added do not replace anything
  result.phrases = plan.phrases.filter(p => !p.failed);
  result.after = result.before - removed + added;

  if (result.failed.length > 0) {
    result.errors.push(`${result.failed.length} change(s) failed: ${result.failed.slice(0, 5).map(f => `${f.text} (${f.reason})`).join(', ')}${result.failed.length > 5 ? ', ...' : ''}`);
  }

  console.log(`  Done: ${added} phrase(s) added, ${removed} negative(s) removed.`);
}

// ---------------------------------------------------------------------------
// Output: log + e-mail
// ---------------------------------------------------------------------------

function logSummary(results) {
  const saved = results.reduce((n, r) => n + (r.before - r.after), 0);
  const errors = results.reduce((n, r) => n + r.errors.length, 0);
  console.log(`Done: ${saved} negative(s) ${DRY_RUN ? 'could be saved (dry run)' : 'saved or planned'}, ${errors} error(s).`);
}

const I18N = {
  en: {
    subjectSaved: n => `${n} negative(s) saved`,
    subjectPlanned: n => `${n} negative(s) could be saved`,
    subjectNone: 'no changes',
    subjectErrors: n => `${n} error(s)`,
    testPrefix: '[Test] ',
    subtitleLive: 'Summary of the changes made',
    subtitleTest: 'Test run: preview of the planned consolidation',
    banner: '<b>Test run:</b> nothing was changed in the account. The numbers show what the script would do in live mode.',
    tileBefore: 'Negatives before',
    tileAfter: 'Negatives after',
    tileSaved: 'Saved',
    tilePhrases: 'New phrase negatives',
    tileRedundant: 'Redundant removed',
    tileErrors: 'Errors',
    intro: 'Every new "phrase" negative blocks all search terms of the [exact] negatives it replaces. Redundant negatives were already blocked by another negative of the same list. A CSV with all removed negatives is attached as backup.',
    listSub: (b, a, s) => `${b} → ${a} negatives (−${s})`,
    colPhrase: 'New phrase negative', colCount: 'Replaces', colExamples: 'Examples', colBasis: 'Basis',
    basis: b => b === 'phrase' ? 'shared phrase' : b === 'term' ? 'single term' : b.replace('family', 'word family'),
    conflictTitle: (n, removed) => `${n} negative(s) contradicting the rule${removed ? ' (removed)' : ' - please check'}`,
    colConflict: 'Negative', colConflictReason: 'Problem',
    colRedundant: 'Removed negative', colReason: 'Blocked by',
    colCandidate: 'Rejected candidate', colWhy: 'Reason',
    redundantTitle: n => `${n} redundant negative(s)`,
    rejectedTitle: n => `${n} candidate(s) rejected by the safety check`,
    more: n => `... and ${n} more (see CSV / log tab).`,
    scope: (s, n) => `Safety check: ${s}, ${n} protected search terms / keywords.`,
    nothing: 'Nothing to consolidate.',
    testList: 'List in test mode - nothing was changed.',
    error: 'Error', warning: 'Note', general: 'General',
    openSheet: 'Open the Google Sheet',
    footer: 'Automated message from the Google Ads script',
    noRules: 'No active rules found.'
  },
  de: {
    subjectSaved: n => `${n} Ausschlüsse eingespart`,
    subjectPlanned: n => `${n} Ausschlüsse könnten eingespart werden`,
    subjectNone: 'keine Änderungen',
    subjectErrors: n => `${n} Fehler`,
    testPrefix: '[Testlauf] ',
    subtitleLive: 'Zusammenfassung der vorgenommenen Änderungen',
    subtitleTest: 'Testlauf: Vorschau der geplanten Konsolidierung',
    banner: '<b>Testlauf:</b> Es wurde nichts im Konto verändert. Die Zahlen zeigen, was das Script im Livebetrieb tun würde.',
    tileBefore: 'Ausschlüsse vorher',
    tileAfter: 'Ausschlüsse nachher',
    tileSaved: 'Eingespart',
    tilePhrases: 'Neue Phrase-Ausschlüsse',
    tileRedundant: 'Redundante entfernt',
    tileErrors: 'Fehler',
    intro: 'Jeder neue "Phrase"-Ausschluss blockiert alle Suchbegriffe der [Exact]-Ausschlüsse, die er ersetzt. Redundante Ausschlüsse waren bereits durch einen anderen Ausschluss derselben Liste blockiert. Eine CSV mit allen entfernten Ausschlüssen hängt als Backup an.',
    listSub: (b, a, s) => `${b} → ${a} Ausschlüsse (−${s})`,
    colPhrase: 'Neuer Phrase-Ausschluss', colCount: 'Ersetzt', colExamples: 'Beispiele', colBasis: 'Grundlage',
    basis: b => b === 'phrase' ? 'gemeinsame Phrase' : b === 'term' ? 'Einzelbegriff' : b.replace('family', 'Wortfamilie'),
    conflictTitle: (n, removed) => `${n} Ausschluss/Ausschlüsse im Widerspruch zur Regel${removed ? ' (entfernt)' : ' - bitte prüfen'}`,
    colConflict: 'Ausschluss', colConflictReason: 'Problem',
    colRedundant: 'Entfernter Ausschluss', colReason: 'Blockiert durch',
    colCandidate: 'Abgelehnter Kandidat', colWhy: 'Grund',
    redundantTitle: n => `${n} redundante(r) Ausschluss/Ausschlüsse`,
    rejectedTitle: n => `${n} Kandidat(en) durch die Sicherheitsprüfung abgelehnt`,
    more: n => `... und ${n} weitere (siehe CSV / Log-Tab).`,
    scope: (s, n) => `Sicherheitsprüfung: ${s}, ${n} geschützte Suchbegriffe / Keywords.`,
    nothing: 'Nichts zu konsolidieren.',
    testList: 'Liste im Testmodus - es wurde nichts verändert.',
    error: 'Fehler', warning: 'Hinweis', general: 'Allgemein',
    openSheet: 'Google Sheet öffnen',
    footer: 'Automatische Nachricht vom Google-Ads-Script',
    noRules: 'Keine aktiven Regeln gefunden.'
  }
};

function sendSummaryMail(results, problems, context) {
  const recipients = NOTIFY_EMAILS.map(e => String(e).trim()).filter(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && !/@example\.com$/i.test(e));

  if (recipients.length === 0) {
    console.log('E-mail: no recipients configured.');
    return;
  }

  const html = buildMailHtml(results, problems, context);

  if (!html) {
    console.log('E-mail: nothing changed - not sent.');
    return;
  }

  const mail = { to: recipients.join(','), subject: html.subject, htmlBody: html.body, name: SCRIPT_NAME };
  const csvRows = buildLogRows(results, Utilities.formatDate(context.startedAt, context.timeZone, 'yyyy-MM-dd HH:mm:ss'))
    .filter(row => [ACTION.removed, ACTION.wouldRemove, ACTION.added, ACTION.wouldAdd, ACTION.failed].includes(row[2]));

  if (ATTACH_BACKUP_CSV && csvRows.length > 0) {
    const fileName = `negatives-consolidator_${context.accountId}_${Utilities.formatDate(context.startedAt, context.timeZone, 'yyyy-MM-dd_HHmm')}.csv`;
    mail.attachments = [Utilities.newBlob(toCsv([LOG_HEADER].concat(csvRows)), 'text/csv', fileName)];
  }

  try {
    MailApp.sendEmail(mail);
    console.log(`E-mail sent to ${recipients.join(', ')}.`);
  } catch (e) {
    console.warn(`E-mail could not be sent: ${e.message}`);
  }
}

function toCsv(rows) {
  return rows.map(row => row.map(v => {
    const s = String(v === undefined || v === null ? '' : v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
}

// Pure function (apart from formatting): returns { subject, body } or null if nothing to report
function buildMailHtml(results, problems, context) {
  const t = I18N[EMAIL_LANGUAGE] || I18N.en;
  const lang = EMAIL_LANGUAGE === 'de' ? 'de' : 'en';
  const fmt = (v, d) => formatNumber(v, d, lang);
  const sum = fn => results.reduce((n, r) => n + fn(r), 0);
  const before = sum(r => r.before);
  const after = sum(r => r.after);
  const saved = before - after;
  const phraseCount = sum(r => r.phrases.length);
  const redundantCount = sum(r => r.redundant.length);
  const errorCount = sum(r => r.errors.length) + problems.length;
  const allTest = results.length > 0 && results.every(r => r.testMode);
  const max = EMAIL_MAX_ROWS_PER_LIST;

  if (saved + phraseCount + redundantCount + errorCount + sum(r => r.conflicting.length) === 0 && !SEND_EMAIL_IF_NOTHING_CHANGED) {
    return null;
  }

  // Subject
  const parts = [];
  if (saved > 0) {
    parts.push(allTest ? t.subjectPlanned(fmt(saved)) : t.subjectSaved(fmt(saved)));
  }
  if (errorCount > 0) {
    parts.push(t.subjectErrors(errorCount));
  }
  const subject = `${allTest ? t.testPrefix : ''}${SCRIPT_NAME} | ${context.accountName}: ${parts.length ? parts.join(', ') : t.subjectNone}`;

  // Body
  let body = mailTiles([
    { value: fmt(before), label: t.tileBefore },
    { value: fmt(after), label: t.tileAfter },
    { value: before > 0 ? `${fmt(saved)} (${fmt(100 * saved / before, 0)} %)` : fmt(saved), label: t.tileSaved, color: saved > 0 ? '#1e7b45' : null },
    { value: fmt(phraseCount), label: t.tilePhrases },
    { value: fmt(redundantCount), label: t.tileRedundant },
    { value: fmt(errorCount), label: t.tileErrors, color: errorCount > 0 ? '#c0392b' : null }
  ]) + mailNote(t.intro);

  if (problems.length > 0) {
    body += mailHeading(t.general);
    problems.forEach(p => { body += mailNote(`${t.warning}: ${p}`, '#7a5a00'); });
  }

  if (results.length === 0) {
    body += mailNote(t.noRules, '#7a5a00');
  }

  for (const r of results) {
    body += mailHeading(r.listName, t.listSub(fmt(r.before), fmt(r.after), fmt(r.before - r.after)));

    if (r.testMode && !allTest) {
      body += mailNote(t.testList, '#7a5a00');
    }

    if (r.scope) {
      body += mailNote(t.scope(r.scope, fmt(r.protectedCount)));
    }

    if (r.phrases.length > 0) {
      body += mailTable(
        [{ title: t.colPhrase }, { title: t.colBasis }, { title: t.colCount, align: 'right' }, { title: t.colExamples }],
        r.phrases.slice(0, max).map(p => {
          const all = p.replaced.concat(p.alsoCovers);
          return [p.negative, t.basis(p.basis || 'phrase'), fmt(all.length), all.slice(0, 3).map(formatNegative).join(', ') + (all.length > 3 ? ', ...' : '')];
        }));
      if (r.phrases.length > max) {
        body += mailNote(t.more(r.phrases.length - max));
      }
    }

    if (r.conflicting.length > 0) {
      body += mailSubheading(t.conflictTitle(fmt(r.conflicting.length), REMOVE_CONFLICTING_NEGATIVES));
      body += mailTable(
        [{ title: t.colConflict }, { title: t.colConflictReason }],
        r.conflicting.slice(0, max).map(n => [formatNegative(n), n.reason]));
    }

    const redundantOnly = r.redundant.filter(n => n.coveredBy);
    if (redundantOnly.length > 0) {
      body += mailSubheading(t.redundantTitle(fmt(redundantOnly.length)));
      body += mailTable(
        [{ title: t.colRedundant }, { title: t.colReason }],
        redundantOnly.slice(0, max).map(n => [formatNegative(n), n.reason === 'duplicate' ? `${n.coveredBy} (duplicate)` : n.coveredBy]));
      if (redundantOnly.length > max) {
        body += mailNote(t.more(redundantOnly.length - max));
      }
    }

    if (r.rejected.length > 0) {
      body += mailSubheading(t.rejectedTitle(fmt(r.rejected.length)));
      body += mailTable(
        [{ title: t.colCandidate }, { title: t.colCount, align: 'right' }, { title: t.colWhy }],
        r.rejected.slice(0, 20).map(c => [`"${c.phrase}"`, fmt(c.coverage), c.reason]));
      if (r.rejected.length > 20) {
        body += mailNote(t.more(r.rejected.length - 20));
      }
    }

    if (r.phrases.length + r.redundant.length === 0 && r.errors.length === 0) {
      body += mailNote(t.nothing);
    }

    r.errors.forEach(e => { body += mailNote(`${t.error}: ${e}`, '#c0392b'); });
    r.warnings.forEach(w => { body += mailNote(`${t.warning}: ${w}`, '#7a5a00'); });
  }

  return {
    subject: subject,
    body: mailLayout({
      title: `${SCRIPT_NAME} · ${context.accountName} (${context.accountId})`,
      subtitle: allTest ? t.subtitleTest : t.subtitleLive,
      banner: allTest ? t.banner : '',
      bodyHtml: body,
      sheetLink: context.spreadsheet ? `<a href="${escapeHtml(context.spreadsheet.getUrl())}" style="color:#1f3a5f;">${escapeHtml(t.openSheet)}</a> &middot; ` : '',
      footer: `${t.footer} ${SCRIPT_NAME} v${SCRIPT_VERSION} &middot; ${escapeHtml(Utilities.formatDate(context.startedAt, context.timeZone, 'yyyy-MM-dd HH:mm'))} &middot; <a href="${SCRIPT_URL}" style="color:#5a6472;">adtraffic.de</a>`
    })
  };
}

// --- HTML helpers (inline CSS + tables, so it renders in Gmail and Outlook) --

function escapeHtml(text) {
  return String(text === undefined || text === null ? '' : text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatNumber(value, digits, lang) {
  if (value === undefined || value === null || value === '' || isNaN(value)) {
    return '-';
  }

  const parts = Number(value).toFixed(digits || 0).split('.');
  const thousands = lang === 'de' ? '.' : ',';
  const decimal = lang === 'de' ? ',' : '.';
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return parts.join(decimal);
}

function mailTiles(tiles) {
  const width = Math.floor(100 / tiles.length);
  const cells = tiles.map(x =>
    `<td width="${width}%" align="center" valign="top" style="padding:12px 4px;background:#f2f5f9;border-radius:6px;">` +
    `<div style="font-size:20px;font-weight:bold;color:${x.color || '#1f3a5f'};">${escapeHtml(x.value)}</div>` +
    `<div style="font-size:12px;color:#5a6472;margin-top:3px;">${escapeHtml(x.label)}</div></td>`).join('');
  return `<table width="100%" cellspacing="6" cellpadding="0" style="border-collapse:separate;"><tr>${cells}</tr></table>`;
}

function mailTable(columns, rows) {
  const cell = 'padding:4px 10px;border:1px solid #d0d0d0;';
  const head = columns.map(c => `<th align="${c.align || 'left'}" style="${cell}background:#f0f0f0;white-space:nowrap;">${escapeHtml(c.title)}</th>`).join('');
  const body = rows.map(row => '<tr>' + columns.map((c, i) => `<td align="${c.align || 'left'}" style="${cell}">${escapeHtml(row[i])}</td>`).join('') + '</tr>').join('');
  return `<table width="100%" style="border-collapse:collapse;font-size:13px;margin-top:6px;"><tr>${head}</tr>${body}</table>`;
}

function mailHeading(text, sub) {
  return '<div style="margin:24px 0 8px;font-size:15px;font-weight:bold;color:#1f3a5f;border-bottom:2px solid #1f3a5f;padding-bottom:4px;">' +
    `${escapeHtml(text)}${sub ? ` <span style="font-weight:normal;font-size:12px;color:#5a6472;">${escapeHtml(sub)}</span>` : ''}</div>`;
}

function mailSubheading(text) {
  return `<div style="margin:16px 0 0;font-size:13px;font-weight:bold;color:#1d2530;">${escapeHtml(text)}</div>`;
}

function mailNote(text, color) {
  return `<div style="margin:6px 0 0;font-size:12px;color:${color || '#5a6472'};">${escapeHtml(text)}</div>`;
}

function mailLayout(o) {
  const banner = o.banner ? `<tr><td style="background:#fff4d6;color:#7a5a00;padding:10px 24px;font-size:13px;">${o.banner}</td></tr>` : '';

  return '<html><body style="margin:0;padding:0;background:#e9edf2;font-family:Arial,Helvetica,sans-serif;color:#1d2530;">' +
    '<table width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 10px;">' +
    '<table width="720" cellspacing="0" cellpadding="0" style="max-width:720px;width:100%;background:#ffffff;border-radius:8px;">' +
    '<tr><td style="background:#1f3a5f;color:#ffffff;padding:18px 24px;border-radius:8px 8px 0 0;">' +
    `<div style="font-size:19px;font-weight:bold;">${escapeHtml(o.title)}</div>` +
    `<div style="font-size:13px;color:#c9d6e8;margin-top:4px;">${escapeHtml(o.subtitle)}</div></td></tr>` +
    banner +
    `<tr><td style="padding:16px 24px 24px;font-size:14px;line-height:1.45;">${o.bodyHtml}</td></tr>` +
    '<tr><td style="padding:12px 24px;background:#f2f5f9;border-radius:0 0 8px 8px;font-size:12px;color:#5a6472;">' +
    `${o.sheetLink}${o.footer}</td></tr>` +
    '</table></td></tr></table></body></html>';
}

// Allows running the unit tests with Node.js (ignored by Google Ads)
if (typeof module !== 'undefined') {
  module.exports = { planConsolidation, toWordSet, stemWord, extendPhrase, containsPhrase, containsAllWords, parseRuleRows, validateRules, groupRulesByList, buildMailHtml, buildLogRows, main };
}
