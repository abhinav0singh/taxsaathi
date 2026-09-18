/**
 * Standalone tests for parseIncome — run with: node test_parse_income.js
 *
 * Updated for the Converse API migration: the mocked invokeModel here
 * simulates what defaultInvokeModel extracts AFTER parsing a Converse
 * response (a plain text string) -- same as before the model swap, since
 * invokeModel's return contract (a string) didn't change, only how
 * defaultInvokeModel itself gets that string internally. Fallback tests
 * (mocked throw/hang) are the real regression check that the model swap
 * didn't quietly change the failure-handling contract.
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
  const prompt = buildPrompt('I earn 12 lakhs a year as a freelancer');
  checkBool('buildPrompt includes the input text', prompt.includes('I earn 12 lakhs a year as a freelancer'), true);
  checkBool('buildPrompt asks for JSON only', prompt.includes('ONLY a single JSON object'), true);

  let result = parseModelOutput('{"grossIncome": 1200000, "isSalaried": false, "deductions80c": 0, "deductions80d": 0}');
  checkBool('Valid model output: ok', result.ok, true);
  checkEqual('Valid model output: fields', result.fields, { grossIncome: 1200000, isSalaried: false, deductions80c: 0, deductions80d: 0 });

  result = parseModelOutput('```json\n{"grossIncome": 800000, "isSalaried": true, "deductions80c": 50000, "deductions80d": 0}\n```');
  checkBool('Fenced JSON output: still parses', result.ok, true);

  result = parseModelOutput('{"error": "unable to determine income"}');
  checkBool('Model escape hatch: not ok', result.ok, false);
  checkBool('Model escape hatch: reason code', result.reason === 'MODEL_COULD_NOT_DETERMINE_INCOME', true);

  result = parseModelOutput('I think you earn about 12 lakhs, hard to say exactly');
  checkBool('Non-JSON model output: not ok', result.ok, false);

  result = parseModelOutput('{"grossIncome": "around twelve lakhs", "isSalaried": false}');
  checkBool('Wrong-type field: not ok', result.ok, false);

  result = parseModelOutput('{"grossIncome": 900000, "isSalaried": true}');
  checkBool('Missing deductions: default to 0', result.ok, true);
  checkEqual('Missing deductions: fields', result.fields, { grossIncome: 900000, isSalaried: true, deductions80c: 0, deductions80d: 0 });

  // --- Fallback path: mocked Bedrock call REJECTS (Converse would throw the same way InvokeModel did) ---
  const failingInvoke = async () => { throw new Error('simulated Converse failure'); };
  let response = await handler(
    { body: JSON.stringify({ text: 'I earn 10 lakhs a year' }) },
    { invokeModel: failingInvoke }
  );
  let body = JSON.parse(response.body);
  checkBool('Fallback test: statusCode 200, not 500', response.statusCode, 200);
  checkBool('Fallback test: parsed false', body.parsed, false);
  checkBool('Fallback test: reason BEDROCK_UNAVAILABLE', body.reason === 'BEDROCK_UNAVAILABLE', true);

  // --- Fallback path: mocked Bedrock call TIMES OUT ---
  const hangingInvoke = () => new Promise(() => {});
  response = await handler(
    { body: JSON.stringify({ text: 'I earn 10 lakhs a year' }) },
    { invokeModel: hangingInvoke }
  );
  body = JSON.parse(response.body);
  checkBool('Timeout test: statusCode 200, not 500', response.statusCode, 200);
  checkBool('Timeout test: parsed false', body.parsed, false);

  // --- Success path: mocked invokeModel returns valid text (simulating a successful Converse call's extracted text) ---
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

  response = await handler({ body: '{not json' });
  checkBool('Malformed request JSON: 400', response.statusCode, 400);
  response = await handler({ body: JSON.stringify({}) });
  checkBool('Missing text field: 400', response.statusCode, 400);

  console.log();
  const failed = results.filter((x) => !x).length;
  console.log(failed === 0 ? `All ${results.length} checks passed.` : `${failed} of ${results.length} FAILED.`);
  process.exitCode = failed === 0 ? 0 : 1;
}
run();
