/**
 * Standalone tests for the explain Lambda — run with: node test_explain.js
 * Updated for the Converse API migration -- see parse_income's test file
 * header for what changed vs. what's still exercised the same way.
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

const items = [
  { topic: '80C', explanation: 'Section 80C lets you deduct up to Rs 1,50,000, Old Regime only.', keywords: ['80c', 'section 80c', '80 c', 'eighty c', 'elss', 'ppf', 'life insurance premium'] },
  { topic: '80D', explanation: 'Section 80D (Old Regime only)...', keywords: ['80d', 'section 80d', '80 d', 'health insurance deduction', 'medical insurance premium'] },
  { topic: '87A_rebate', explanation: 'Rebate under Section 87A...', keywords: ['87a', 'section 87a', 'rebate', 'tax rebate', 'zero tax threshold', '12 lakh rebate', '5 lakh rebate'] },
  { topic: 'new_vs_old_regime', explanation: 'Old vs New Regime overview...', keywords: ['old vs new', 'which regime', 'regime comparison', 'old regime', 'new regime', 'which is better', 'default regime'] },
];

async function run() {
  checkTopic('TEST_PLAN exact case: "what\'s 80c"', findBestMatch("what's 80c", items), '80C');
  checkTopic('TEST_PLAN exact case: "section 80 c"', findBestMatch('section 80 c', items), '80C');
  checkBool('Unrelated question returns no match', findBestMatch('what is the weather today', items), null);
  checkBool('normalize strips spaces/punctuation', normalize('Section 80-C!'), 'section80c');

  let prompt = buildExplainPrompt('Section 80C explanation text', 'what is 80c', null);
  checkBool('Prompt includes the snippet', prompt.includes('Section 80C explanation text'), true);
  checkBool('Prompt tells the model not to invent numbers', prompt.toLowerCase().includes('do not invent'), true);

  // No match -> Bedrock never called
  let bedrockCallCount = 0;
  const countingInvoke = async () => { bedrockCallCount++; return 'should not be called'; };
  let response = await handler(
    { body: JSON.stringify({ question: 'what is the weather today' }) },
    { scanTable: async () => items, invokeModel: countingInvoke }
  );
  let body = JSON.parse(response.body);
  checkBool('No-match: matched false', body.matched, false);
  checkBool('No-match: Bedrock never invoked', bedrockCallCount, 0);

  // Match found, Bedrock succeeds
  response = await handler(
    { body: JSON.stringify({ question: "what's 80c" }) },
    { scanTable: async () => items, invokeModel: async () => 'Section 80C lets you save up to Rs 1.5 lakh, but only in the Old Regime.' }
  );
  body = JSON.parse(response.body);
  checkBool('Bedrock success: matched true', body.matched, true);
  checkBool('Bedrock success: phrased true', body.phrased, true);
  checkBool('Bedrock success: uses the phrased text', body.explanation.includes('save up to Rs 1.5 lakh'), true);

  // Match found, Bedrock fails -> raw snippet fallback (unchanged contract, now Converse-triggered failure)
  response = await handler(
    { body: JSON.stringify({ question: "what's 80c" }) },
    { scanTable: async () => items, invokeModel: async () => { throw new Error('simulated Converse failure'); } }
  );
  body = JSON.parse(response.body);
  checkBool('Bedrock failure: statusCode 200, not 500', response.statusCode, 200);
  checkBool('Bedrock failure: phrased false', body.phrased, false);
  checkBool('Bedrock failure: RAW snippet exactly', body.explanation, items[0].explanation);

  // Timeout -> same fallback
  response = await handler(
    { body: JSON.stringify({ question: "what's 80c" }) },
    { scanTable: async () => items, invokeModel: () => new Promise(() => {}) }
  );
  body = JSON.parse(response.body);
  checkBool('Bedrock timeout: falls back the same way', body.phrased, false);

  response = await handler({ body: '{not json' });
  checkBool('Malformed request JSON: 400', response.statusCode, 400);
  response = await handler({ body: JSON.stringify({}) });
  checkBool('Missing question field: 400', response.statusCode, 400);

  console.log();
  const failed = results.filter((x) => !x).length;
  console.log(failed === 0 ? `All ${results.length} checks passed.` : `${failed} of ${results.length} FAILED.`);
  process.exitCode = failed === 0 ? 0 : 1;
}
run();
