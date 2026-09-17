/**
 * Standalone tests for the explain Lambda — run with: node test_explain.js
 *
 * findBestMatch/normalize/buildExplainPrompt are pure functions, tested
 * directly. The handler's Bedrock and DynamoDB calls are both injectable,
 * so the success path, the Bedrock-failure fallback path, and the
 * no-match-skips-Bedrock path are all tested for REAL here, without
 * touching AWS -- see the injected scanTable/invokeModel below.
 */

const { handler, findBestMatch, normalize, buildExplainPrompt } = require('./app');

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

// Mirrors seed-data.json's content.
const items = [
  {
    topic: '80C',
    explanation: 'Section 80C lets you deduct up to Rs 1,50,000, Old Regime only.',
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

async function run() {
  // --- Matching logic (unchanged from the DynamoDB-only stage) ---
  checkTopic('TEST_PLAN exact case: "what\'s 80c"', findBestMatch("what's 80c", items), '80C');
  checkTopic('TEST_PLAN exact case: "section 80 c"', findBestMatch('section 80 c', items), '80C');
  checkTopic('80D phrasing: "do I get 80d benefit"', findBestMatch('do I get 80d benefit', items), '80D');
  checkTopic('87A phrasing: "what is the rebate"', findBestMatch('what is the rebate', items), '87A_rebate');
  checkTopic('87A phrasing: "12 lakh rebate explained"', findBestMatch('12 lakh rebate explained', items), '87A_rebate');
  checkTopic('Overview phrasing: "which regime is better for me"', findBestMatch('which regime is better for me', items), 'new_vs_old_regime');
  checkBool('Unrelated question returns no match', findBestMatch('what is the weather today', items), null);
  checkBool('Empty question returns no match', findBestMatch('', items), null);
  checkBool('Whitespace-only question returns no match', findBestMatch('   ', items), null);
  checkBool('normalize strips spaces and punctuation, lowercases', normalize('Section 80-C!'), 'section80c');

  // --- buildExplainPrompt: pure function sanity ---
  let prompt = buildExplainPrompt('Section 80C explanation text', 'what is 80c', null);
  checkBool('Prompt includes the snippet', prompt.includes('Section 80C explanation text'), true);
  checkBool('Prompt includes the question', prompt.includes('what is 80c'), true);
  checkBool('Prompt with no calculatedResult omits that section', prompt.includes("user's own calculated result"), false);

  prompt = buildExplainPrompt('snippet text', 'question text', { currentRecommendation: 'new', comparison: { savings: 5000 } });
  checkBool('Prompt WITH calculatedResult includes it', prompt.includes('"savings":5000'), true);
  checkBool('Prompt tells the model not to invent numbers', prompt.toLowerCase().includes('do not invent'), true);

  // --- handler: no match -> Bedrock should NOT even be called ---
  let bedrockCallCount = 0;
  const countingInvoke = async () => {
    bedrockCallCount++;
    return 'should not be called';
  };
  let response = await handler(
    { body: JSON.stringify({ question: 'what is the weather today' }) },
    { scanTable: async () => items, invokeModel: countingInvoke }
  );
  let body = JSON.parse(response.body);
  checkBool('No-match: matched is false', body.matched, false);
  checkBool('No-match: Bedrock was never invoked (cost/latency saved)', bedrockCallCount, 0);

  // --- handler: match found, Bedrock SUCCEEDS -> phrased answer returned ---
  response = await handler(
    { body: JSON.stringify({ question: "what's 80c" }) },
    { scanTable: async () => items, invokeModel: async () => 'Section 80C lets you save up to Rs 1.5 lakh, but only in the Old Regime.' }
  );
  body = JSON.parse(response.body);
  checkBool('Bedrock success: matched true', body.matched, true);
  checkBool('Bedrock success: topic is 80C', body.topic === '80C', true);
  checkBool('Bedrock success: phrased is true', body.phrased, true);
  checkBool('Bedrock success: explanation is the phrased text, not the raw snippet', body.explanation.includes('save up to Rs 1.5 lakh'), true);

  // --- handler: match found, Bedrock FAILS -> falls back to raw snippet (the pre-Bedrock behavior) ---
  response = await handler(
    { body: JSON.stringify({ question: "what's 80c" }) },
    { scanTable: async () => items, invokeModel: async () => { throw new Error('simulated Bedrock outage'); } }
  );
  body = JSON.parse(response.body);
  checkBool('Bedrock failure: statusCode is 200, not 500', response.statusCode, 200);
  checkBool('Bedrock failure: matched is still true', body.matched, true);
  checkBool('Bedrock failure: phrased is false', body.phrased, false);
  checkBool('Bedrock failure: explanation is the RAW snippet text exactly', body.explanation, items[0].explanation);

  // --- handler: match found, Bedrock TIMES OUT -> same fallback ---
  response = await handler(
    { body: JSON.stringify({ question: "what's 80c" }) },
    { scanTable: async () => items, invokeModel: () => new Promise(() => {}) }
  );
  body = JSON.parse(response.body);
  checkBool('Bedrock timeout: falls back the same way (phrased false)', body.phrased, false);
  checkBool('Bedrock timeout: raw snippet still correct', body.explanation, items[0].explanation);

  // --- handler: input validation, unchanged ---
  response = await handler({ body: '{not json' });
  checkBool('Malformed request JSON: 400', response.statusCode, 400);
  response = await handler({ body: JSON.stringify({}) });
  checkBool('Missing question field: 400', response.statusCode, 400);

  console.log();
  const failed = results.filter((x) => !x).length;
  if (failed === 0) {
    console.log(`All ${results.length} checks passed.`);
  } else {
    console.log(`${failed} of ${results.length} checks FAILED.`);
    process.exitCode = 1;
  }
}

run();
