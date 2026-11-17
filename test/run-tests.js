// Minimal test runner with mocked Google Ads globals: `node test/run-tests.js`
// Writes the generated e-mail to test/output/mail.html and the backup CSV to
// test/output/backup.csv for a visual check.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// --- Load the script ---------------------------------------------------------

function loadScript(replacements) {
  let src = fs.readFileSync(path.join(__dirname, '..', 'negatives-consolidator.js'), 'utf8');
  replacements.forEach(([from, to]) => {
    assert.ok(src.includes(from), `replacement target not found: ${from}`);
    src = src.replace(from, to);
  });
  const mod = { exports: {} };
  new Function('module', 'console', src)(mod, { log() {}, warn() {}, error: console.error });
  return mod.exports;
}

// --- Mocks -------------------------------------------------------------------

const state = { added: [], removed: [], mails: [], lists: {} };

function iterator(items) {
  let i = 0;
  return { hasNext: () => i < items.length, next: () => items[i++], totalNumEntities: () => items.length };
}

function makeList(name, negatives, campaignIds) {
  const items = negatives.map(n => {
    const text = n.type === 'PHRASE' ? `"${n.text}"` : n.type === 'BROAD' ? n.text : `[${n.text}]`;
    return {
      getText: () => text,
      getMatchType: () => n.type,
      remove: () => {
        if (n.text.includes('locked')) throw new Error('CANNOT_REMOVE');
        state.removed.push(text);
      }
    };
  });
  const list = {
    getName: () => name,
    negativeKeywords: () => ({ get: () => iterator(items) }),
    campaigns: () => ({ get: () => iterator((campaignIds || []).map(id => ({ getId: () => id }))) }),
    addNegativeKeyword: k => {
      if (k.includes('invalid')) throw new Error('INVALID_CHARACTER');
      state.added.push(k);
    }
  };
  state.lists[name] = list;
  return list;
}

const queries = [];

global.AdsApp = {
  currentAccount: () => ({
    getName: () => 'Demo Account', getCustomerId: () => '123-456-7890',
    getCurrencyCode: () => 'EUR', getTimeZone: () => 'Europe/Berlin'
  }),
  search: query => {
    queries.push(query);
    if (query.includes('FROM keyword_view')) {
      return iterator([{ adGroupCriterion: { keyword: { text: 'Running Shoes' } } }, { adGroupCriterion: { keyword: { text: 'cheap discount outlet' } } }]);
    }
    return iterator([
      ['free movies shoe shop', 0],          // relevant (pattern) -> blocks candidate "free movies"
      ['tv series online stream', 3],        // converting -> blocks candidate "tv series"
      ['weather today', 0]                   // irrelevant, not protected
    ].map(r => ({ searchTermView: { searchTerm: r[0] }, metrics: { conversions: r[1] } })));
  },
  negativeKeywordLists: () => ({ get: () => iterator(Object.keys(state.lists).map(k => state.lists[k])) })
};
global.Utilities = {
  formatDate: (d, tz, f) => (f.includes('HHmm') && !f.includes(':') ? d.toISOString().slice(0, 16).replace('T', '_').replace(':', '') : d.toISOString().slice(0, 16).replace('T', ' ')),
  newBlob: (content, type, name) => ({ content: content, type: type, name: name })
};
global.MailApp = { sendEmail: o => state.mails.push(o) };
global.SpreadsheetApp = {};

const nc = loadScript([
  ['const DRY_RUN = true;', 'const DRY_RUN = false;'],
  ["const NOTIFY_EMAILS = ['you@example.com'];", "const NOTIFY_EMAILS = ['test@test.de'];"],
  ["const MIN_COVERAGE = 8;", 'const MIN_COVERAGE = 3;']
]);

// --- Unit tests --------------------------------------------------------------

assert.ok(nc.containsPhrase('cheap flights to rome', 'flights to'));
assert.ok(!nc.containsPhrase('cheap flights to rome', 'flight'));
assert.ok(!nc.containsPhrase('cheap flights to rome', 'rome cheap'));
assert.ok(nc.containsAllWords('jobs in hamburg', 'hamburg jobs'));
assert.ok(!nc.containsAllWords('jobs in berlin', 'hamburg jobs'));

const E = t => ({ text: t, type: 'EXACT' });
const P = t => ({ text: t, type: 'PHRASE' });
const B = t => ({ text: t, type: 'BROAD' });
const opts = { minCoverage: 3, minWords: 2, maxWords: 5, removeRedundant: true, maxNewPhrases: 100, maxRemovals: 2000 };
const noGuard = { patterns: [], protectedTerms: [] };

// Redundancy: duplicates, covered by phrase, covered by broad, phrase covered by shorter phrase
let plan = nc.planConsolidation([
  E('weather tomorrow'), E('weather tomorrow'), P('weather'), E('weather berlin'),
  B('hamburg jobs'), E('jobs in hamburg'), P('weather in berlin'), B('jobs hamburg'), E('shoes')
], opts, noGuard);
assert.deepStrictEqual(plan.redundant.map(n => `${n.type}:${n.text}:${n.reason}`).sort(), [
  'BROAD:jobs hamburg:duplicate',
  'EXACT:jobs in hamburg:covered',
  'EXACT:weather berlin:covered',
  'EXACT:weather tomorrow:covered',
  'EXACT:weather tomorrow:duplicate',
  'PHRASE:weather in berlin:covered'
]);
assert.strictEqual(plan.phrases.length, 0);
assert.strictEqual(plan.after, 3);

// Consolidation: greedy picks the phrase covering most exacts; ties -> longer phrase
plan = nc.planConsolidation([
  E('cheap flights rome'), E('cheap flights paris'), E('cheap flights to london'), E('book cheap flights now'),
  E('red apple pie'), E('red apple juice'), E('red apple cake'),
  E('unrelated term'), P('red apple pie recipe')
], opts, noGuard);
assert.deepStrictEqual(plan.phrases.map(p => p.negative), ['"cheap flights"', '"red apple"']);
assert.strictEqual(plan.phrases[0].replaced.length, 4);
assert.deepStrictEqual(plan.phrases[1].alsoCovers.map(n => n.text), ['red apple pie recipe']);
assert.strictEqual(plan.after, 9 - 4 - 3 - 1 + 2);

// Safety: pattern, protected terms, stopword edges
plan = nc.planConsolidation([
  E('cheap outlet a'), E('cheap outlet b'), E('cheap outlet c'),
  E('free movies x'), E('free movies y'), E('free movies z'),
  E('to the x'), E('to the y'), E('to the z')
], opts, { patterns: [/outlet/i], protectedTerms: [{ text: 'watch free movies shoe', reason: 'relevant search term' }] });
assert.strictEqual(plan.phrases.length, 0);
assert.deepStrictEqual(plan.rejected.map(r => `${r.phrase}|${r.reason}`).sort(), [
  'free movies|would block relevant search term "watch free movies shoe"'
]);
// Negatives matching the positive pattern are conflicts, not consolidated
assert.deepStrictEqual(plan.conflicting.map(n => `${n.text}|${n.reason}`), [
  'cheap outlet a|matches positive pattern', 'cheap outlet b|matches positive pattern', 'cheap outlet c|matches positive pattern'
]);

// Conflict: exact negative identical to an own keyword, phrase negative blocking a relevant term
plan = nc.planConsolidation([E('take on do'), P('team'), E('karate')], Object.assign({}, opts, { removeConflicting: true }),
  { patterns: [], protectedTerms: [{ text: 'take on do', reason: 'own keyword' }, { text: 'taekwondo team', reason: 'relevant search term' }] });
assert.deepStrictEqual(plan.conflicting.map(n => n.reason), ['blocks own keyword "take on do"', 'blocks relevant search term "taekwondo team"']);
assert.strictEqual(plan.redundant.length, 2); // removeConflicting = true
assert.strictEqual(plan.after, 1);

// Single terms, phrase extension and word families
const single = Object.assign({}, opts, { minCoverage: 8, singleTerms: true, singleMinCoverage: 3, wordFamilies: true, minRootLength: 3, protectedWords: nc.toWordSet(['nähe kinder']) });
plan = nc.planConsolidation([
  E('karate landshut'), E('karate'), E('karate für kinder'), E('kinderkarate in der nähe'),
  E('boxen landshut'), E('boxen in der nähe'), E('landshut boxen'), E('boxclub in meiner nähe'), E('kickboxtempel ingolstadt'),
  E('kung fu landshut'), E('kung fu lernen'), E('kung fu für kinder'),
  E('yoga in der nähe'), E('kinder in der nähe'), E('fitness in der nähe'), E('taekwondo team'),
  E('turnen kinder'), E('kinderturnen'), E('bodenturnen')
], single, { patterns: [/taekwondo|kampf\s*sport/i], protectedTerms: [{ text: 'taekwondo landshut', reason: 'own keyword' }] });
const got = plan.phrases.map(p => `${p.negative}|${p.basis}|${p.replaced.length}`).sort();
assert.deepStrictEqual(got, [
  '"boxclub"|family box*|1', '"boxen"|term|3', '"karate"|term|3',
  '"kinderkarate"|family karat*|1', '"kung fu"|term|3'
], got.join('\n'));
assert.ok(plan.rejected.some(r => r.phrase === 'landshut' && /own keyword/.test(r.reason)));
assert.ok(plan.rejected.some(r => r.phrase === 'nähe' && /generic/.test(r.reason)));
assert.deepStrictEqual(plan.conflicting.map(n => n.text), ['taekwondo team']);
assert.strictEqual(nc.stemWord('boxen'), 'box');
assert.strictEqual(nc.extendPhrase('kung', [0, 1], [['kung', 'fu', 'x'], ['a', 'kung', 'fu']], 5), 'kung fu');

// Transliteration: pattern "maenner" protects "männer"
plan = nc.planConsolidation([E('männer schuhe a'), E('männer schuhe b'), E('männer schuhe c')], opts, { patterns: [/maenner/i], protectedTerms: [] });
assert.strictEqual(plan.phrases.length, 0);

// Limits: max removals
plan = nc.planConsolidation([E('foo bar c'), E('foo bar d'), E('foo bar e'), E('x y'), E('x y')], Object.assign({}, opts, { maxRemovals: 2 }), noGuard);
assert.strictEqual(plan.redundant.length, 1);
assert.strictEqual(plan.phrases.length, 0);
assert.strictEqual(plan.postponed.length, 1);

// Rules from an Excluder sheet (shared "rules" tab)
const parsed = nc.parseRuleRows([
  ['active', 'campaignFilter', 'listName', 'positiveStrings', 'dateRange', 'minImpressions', 'mode', 'consolidate', 'consolidatorMode', 'minCoverage'],
  [true, '%A%', 'List A', 'abc', 'LAST_30_DAYS', 1, 'live', '', 'test', 5],
  [true, '%B%', 'List A', 'xyz', '', '', 'live', '', '', ''],
  [true, '', 'List B', '', '', '', '', 'no', '', ''],
  ['', '', '', '', '', '', '', '', '', '']
]);
assert.strictEqual(parsed.rules.length, 3);
const validated = nc.validateRules(parsed.rules.concat([{ id: 'x', listName: 'L', positivePattern: '(' }, { id: 'y', listName: 'L', minCoverage: 1 }]));
assert.strictEqual(validated.rules.length, 2);
assert.strictEqual(validated.problems.length, 2);
const groups = nc.groupRulesByList(validated.rules);
assert.strictEqual(groups.length, 1);
assert.deepStrictEqual(groups[0].patterns, ['abc', 'xyz']);
assert.deepStrictEqual(groups[0].campaignFilters, ['%A%', '%B%']);
assert.strictEqual(groups[0].testMode, true);
assert.strictEqual(groups[0].minCoverage, 5);

// --- Integration: full run ------------------------------------------------------

makeList('SQE - AI Max negatives', [
  E('cheap flights rome'), E('cheap flights paris'), E('cheap flights london'), E('last minute cheap flights'),
  E('free movies online'), E('free movies hd'), E('free movies download'),
  E('tv series x'), E('tv series y'), E('tv series z'),
  E('discount outlet a'), E('discount outlet b'), E('discount outlet c'),  // own keyword "cheap discount outlet"
  E('weather tomorrow'), E('weather tomorrow'), P('cheap flights to rome'),
  P('weather'), E('weather locked')                                          // removal fails in mock
], [11, 12]);
nc.main();

assert.ok(queries.some(q => q.includes('campaign.name LIKE "%AI Max%"')), 'campaign filter in query');
assert.deepStrictEqual(state.added, ['"cheap flights"']);
assert.deepStrictEqual(state.removed.sort(), [
  '"cheap flights to rome"',
  '[cheap flights london]', '[cheap flights paris]', '[cheap flights rome]', '[last minute cheap flights]',
  '[weather tomorrow]', '[weather tomorrow]'
].sort());
assert.strictEqual(state.mails.length, 1);
const mail = state.mails[0];
assert.ok(mail.subject.includes('6 negative(s) saved'), mail.subject);
assert.ok(mail.subject.includes('1 error(s)'), mail.subject);
assert.ok(mail.htmlBody.includes('would block relevant search term'));
assert.ok(mail.htmlBody.includes('would block converting search term'));
assert.ok(mail.htmlBody.includes('would block own keyword'));
assert.ok(mail.htmlBody.includes('CANNOT_REMOVE'));
assert.strictEqual(mail.attachments.length, 1);
assert.ok(mail.attachments[0].content.includes('REMOVED,[cheap flights rome]'));
assert.ok(mail.attachments[0].content.includes('FAILED,[weather locked]'));

const out = path.join(__dirname, 'output');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'mail.html'), mail.htmlBody);
fs.writeFileSync(path.join(out, 'backup.csv'), mail.attachments[0].content);
console.log('All tests passed. Mail preview: test/output/mail.html');
