/**
 * Standalone tests for parseIncome — run with: node test_parse_income.js
 *
 * The Bedrock call itself is mocked via dependency injection (handler's
 * second argument). This is a REAL test of the fallback logic, prompt
 * construction, and output validation -- the one thing it can't test is
 * actual model output quality, which needs live Bedrock access.
 */

const { handler, buildPrompt, parseModelOutput } = require('./app');

const results = [];

function checkBool(label, actual, expected) {
  const ok = actual === expected;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}: got ${actual}, expected ${expected}`);
  results.push(ok);
}

function checkEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  results.push(ok);
}

async function run() {
  // --- buildPrompt: pure function sanity ---
  const prompt = buildPrompt('I earn 12 lakhs a year as a freelancer');
  checkBool('buildPrompt includes the input text', prompt.includes('I earn 12 lakhs a year as a freelancer'), true);
  checkBool('buildPrompt asks for JSON only', prompt.includes('ONLY a single JSON object'), true);

  // --- parseModelOutput: valid, well-formed JSON ---
  let result = parseModelOutput('{"grossIncome": 1200000, "isSalaried": false, "deductions80c": 0, "deductions80d": 0}');
  checkBool('Valid model output: ok', result.ok, true);
  checkEqual('Valid model output: fields', result.fields, { grossIncome: 1200000, isSalaried: false, deductions80c: 0, deductions80d: 0 });

  // --- parseModelOutput: JSON wrapped in markdown fences (models do this despite instructions) ---
  result = parseModelOutput('```json\n{"grossIncome": 800000, "isSalaried": true, "deductions80c": 50000, "deductions80d": 0}\n```');
  checkBool('Fenced JSON output: still parses', result.ok, true);
  checkEqual('Fenced JSON output: fields', result.fields, { grossIncome: 800000, isSalaried: true, deductions80c: 50000, deductions80d: 0 });

  // --- parseModelOutput: model's explicit "can't determine" escape hatch ---
  result = parseModelOutput('{"error": "unable to determine income"}');
  checkBool('Model escape hatch: not ok', result.ok, false);
  checkBool('Model escape hatch: reason code', result.reason === 'MODEL_COULD_NOT_DETERMINE_INCOME', true);

  // --- parseModelOutput: garbage / non-JSON output ---
  result = parseModelOutput('I think you earn about 12 lakhs, hard to say exactly');
  checkBool('Non-JSON model output: not ok', result.ok, false);
  checkBool('Non-JSON model output: reason code', result.reason === 'MODEL_OUTPUT_NOT_JSON', true);

  // --- parseModelOutput: valid JSON but wrong types (model didn't follow schema) ---
  result = parseModelOutput('{"grossIncome": "around twelve lakhs", "isSalaried": false}');
  checkBool('Wrong-type field: not ok', result.ok, false);
  checkBool('Wrong-type field: reason code', result.reason === 'INVALID_GROSS_INCOME_FIELD', true);

  // --- parseModelOutput: missing deduction fields default to 0 rather than fail ---
  result = parseModelOutput('{"grossIncome": 900000, "isSalaried": true}');
  checkBool('Missing deductions: still ok', result.ok, true);
  checkEqual('Missing deductions: default to 0', result.fields, { grossIncome: 900000, isSalaried: true, deductions80c: 0, deductions80d: 0 });

  // --- handler: FULL fallback path via a mocked Bedrock call that REJECTS ---
  // This is the actual TEST_PLAN.md section 5 fallback test, run for real.
  const failingInvoke = async () => {
    throw new Error('simulated Bedrock outage');
  };
  let response = await handler(
    { body: JSON.stringify({ text: 'I earn 10 lakhs a year' }) },
    { invokeModel: failingInvoke }
  );
  let body = JSON.parse(response.body);
  checkBool('Fallback test: statusCode is 200, not 500', response.statusCode, 200);
  checkBool('Fallback test: parsed is false', body.parsed, false);
  checkBool('Fallback test: reason is BEDROCK_UNAVAILABLE', body.reason === 'BEDROCK_UNAVAILABLE', true);

  // --- handler: FULL fallback path via a mocked Bedrock call that TIMES OUT ---
  const hangingInvoke = () => new Promise(() => {}); // never resolves -- simulates a stuck call
  response = await handler(
    { body: JSON.stringify({ text: 'I earn 10 lakhs a year' }) },
    { invokeModel: hangingInvoke }
  );
  body = JSON.parse(response.body);
  checkBool('Timeout test: statusCode is 200, not 500', response.statusCode, 200);
  checkBool('Timeout test: parsed is false', body.parsed, false);

  // --- handler: SUCCESS path via a mocked Bedrock call returning valid output ---
  const succeedingInvoke = async () =>
    '{"grossIncome": 1500000, "isSalaried": false, "deductions80c": 100000, "deductions80d": 25000}';
  response = await handler(
    { body: JSON.stringify({ text: 'freelancer earning 15 lakhs, 1 lakh in ELSS, 25k health insurance' }) },
    { invokeModel: succeedingInvoke }
  );
  body = JSON.parse(response.body);
  checkBool('Success path: statusCode 200', response.statusCode, 200);
  checkBool('Success path: parsed true', body.parsed, true);
  checkEqual('Success path: fields', body.fields, { grossIncome: 1500000, isSalaried: false, deductions80c: 100000, deductions80d: 25000 });

  // --- handler: model returns garbage even though the call itself succeeded ---
  const garbageInvoke = async () => 'sorry, I cannot help with that';
  response = await handler(
    { body: JSON.stringify({ text: 'blah' }) },
    { invokeModel: garbageInvoke }
  );
  body = JSON.parse(response.body);
  checkBool('Garbage output test: falls back cleanly (200)', response.statusCode, 200);
  checkBool('Garbage output test: parsed false', body.parsed, false);

  // --- handler: input validation, unchanged pattern from calculate/explain ---
  response = await handler({ body: '{not json' });
  checkBool('Malformed request JSON: 400', response.statusCode, 400);
  response = await handler({ body: JSON.stringify({}) });
  checkBool('Missing text field: 400', response.statusCode, 400);

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
