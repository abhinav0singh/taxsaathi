// Handler for POST /calculate — wraps calculator.js's analyzeOptimization(),
// which itself combines compareRegimes() with all three optimizer signals
// (rebate cliff-edge, deduction headroom, slab boundary) into one result.
// This file only translates HTTP <-> function call; all logic stays in
// calculator.js untouched.

const { analyzeOptimization } = require('./calculator');

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

  const { grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0 } = input;

  if (typeof grossIncome !== 'number' || grossIncome < 0) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'grossIncome is required and must be a non-negative number.' }),
    };
  }

  try {
    const result = analyzeOptimization(grossIncome, isSalaried, deductions80c, deductions80d);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (err) {
    console.error('analyzeOptimization failed:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error computing tax analysis.' }) };
  }
};
