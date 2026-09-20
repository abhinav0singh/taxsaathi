// Handler for POST /calculate — wraps calculator.js's analyzeOptimization(),
// which itself combines compareRegimes() with all optimizer signals
// (rebate wall proximity, deduction headroom, slab boundary, historical
// comparison, rate summary) into one result. This file only translates
// HTTP <-> function call; all logic stays in calculator.js untouched.

const { analyzeOptimization } = require('./calculator');

const MAX_SANE_INCOME = 1000000000; // ₹100 crore -- generous ceiling, just to reject garbage/typos, not a real limit

function isNonNegativeNumber(v) {
  return typeof v === 'number' && isFinite(v) && v >= 0;
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    // API Gateway HTTP API's own CORS config (set in template.yaml) handles
    // preflight; this header is a safe fallback on the response itself.
    'Access-Control-Allow-Origin': '*',
  };

  let input;
  try {
    input = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
  }

  const {
    grossIncome,
    isSalaried = true,
    deductions80c = 0,
    deductions80d = 0,
    otherOldRegimeDeductions = 0,
  } = input;

  if (!isNonNegativeNumber(grossIncome) || grossIncome > MAX_SANE_INCOME) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'grossIncome is required and must be a non-negative, sane number.' }),
    };
  }
  if (typeof isSalaried !== 'boolean') {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'isSalaried must be a boolean.' }) };
  }
  for (const [name, val] of [
    ['deductions80c', deductions80c],
    ['deductions80d', deductions80d],
    ['otherOldRegimeDeductions', otherOldRegimeDeductions],
  ]) {
    if (!isNonNegativeNumber(val)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `${name} must be a non-negative number.` }) };
    }
  }

  try {
    const result = analyzeOptimization(grossIncome, isSalaried, deductions80c, deductions80d, otherOldRegimeDeductions);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error('analyzeOptimization failed:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error computing tax analysis.' }) };
  }
};
