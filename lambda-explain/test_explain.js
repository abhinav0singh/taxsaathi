/**
 * Standalone tests for the explain Lambda's matching logic —
 * run with: node test_explain.js
 *
 * No AWS involved: findBestMatch/normalize are pure functions, tested
 * directly against the real seed data content (kept in sync with
 * seed-data.json by hand for now — small enough that this is fine).
 */

const { findBestMatch, normalize } = require('./app');

const results = [];

function checkBool(label, actual, expected) {
  const ok = actual === expected;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}: got ${actual}, expected ${expected}`);
  results.push(ok);
}

function checkTopic(label, actual, expectedTopic) {
  const got = actual ? actual.topic : null;
  const ok = got === expectedTopic;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}: matched "${got}", expected "${expectedTopic}"`);
  results.push(ok);
}

// Mirrors seed-data.json's content — see that file for the real payload.
const items = [
  {
    topic: '80C',
    explanation: 'Section 80C (Old Regime only)...',
    keywords: ['80c', 'section 80c', '80 c', 'eighty c', 'elss', 'ppf', 'life insurance premium'],
  },
  {
    topic: '80D',
    explanation: 'Section 80D (Old Regime only)...',
    keywords: ['80d', 'section 80d', '80 d', 'health insurance deduction', 'medical insurance premium'],
  },
  {
    topic: '87A_rebate',
    explanation: 'Rebate under Section 87A...',
    keywords: ['87a', 'section 87a', 'rebate', 'tax rebate', 'zero tax threshold', '12 lakh rebate', '5 lakh rebate'],
  },
  {
    topic: 'new_vs_old_regime',
    explanation: 'Old vs New Regime overview...',
    keywords: ['old vs new', 'which regime', 'regime comparison', 'old regime', 'new regime', 'which is better', 'default regime'],
  },
];

// The exact two phrasings TEST_PLAN.md section 4 names explicitly.
checkTopic('TEST_PLAN exact case: "what\'s 80c"', findBestMatch("what's 80c", items), '80C');
checkTopic('TEST_PLAN exact case: "section 80 c"', findBestMatch('section 80 c', items), '80C');

// A few more phrasings per topic, to catch a lucky-match false positive.
checkTopic('80D phrasing: "do I get 80d benefit"', findBestMatch('do I get 80d benefit', items), '80D');
checkTopic('87A phrasing: "what is the rebate"', findBestMatch('what is the rebate', items), '87A_rebate');
checkTopic('87A phrasing: "12 lakh rebate explained"', findBestMatch('12 lakh rebate explained', items), '87A_rebate');
checkTopic('Overview phrasing: "which regime is better for me"', findBestMatch('which regime is better for me', items), 'new_vs_old_regime');

// No match should return null, not throw or default to the wrong topic.
checkBool('Unrelated question returns no match', findBestMatch('what is the weather today', items), null);

// Empty/whitespace-only question is handled without throwing.
checkBool('Empty question returns no match', findBestMatch('', items), null);
checkBool('Whitespace-only question returns no match', findBestMatch('   ', items), null);

// normalize() sanity — this is what makes the matching case/punctuation-insensitive.
checkBool('normalize strips spaces and punctuation, lowercases', normalize('Section 80-C!'), 'section80c');

console.log();
const failed = results.filter((x) => !x).length;
if (failed === 0) {
  console.log(`All ${results.length} checks passed.`);
} else {
  console.log(`${failed} of ${results.length} checks FAILED.`);
  process.exitCode = 1;
}
