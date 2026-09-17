/**
 * Standalone tests for calculator.js — run with: node test_calculator.js
 *
 * No test framework (like Jest) used deliberately, to keep this
 * dependency-free for the hackathon. Each check asserts an expected
 * value and prints a pass/fail line.
 */

const { calculateNewRegime, calculateOldRegime, compareRegimes } = require("./calculator");

const results = [];

function check(label, actual, expected, tolerance = 1) {
  const ok = Math.abs(actual - expected) <= tolerance;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}: got ${actual}, expected ~${expected}`);
  results.push(ok);
}

function checkBool(label, actual, expected) {
  const ok = actual === expected;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}: got ${actual}, expected ${expected}`);
  results.push(ok);
}

// New regime: income well under 12L -> rebate zeroes tax entirely
let r = calculateNewRegime(1000000, true);
check("New regime, 10L salaried -> rebate zeroes tax", r.finalTax, 0);

// New regime: gross 13L salaried -> taxable = 13L - 75000 = 1225000, above 12L, rebate should NOT apply
r = calculateNewRegime(1300000, true);
checkBool("New regime, 13L salaried -> rebate should NOT apply", r.rebateApplied, false);

// New regime: 15L freelancer (no standard deduction), clean mid-slab case
// taxable = 1500000. slabs: 0-4L@0, 4-8L@5%=20000, 8-12L@10%=40000, 12-15L@15%=45000 => 105000
// not rebate-eligible (>12L). cess = 4% of 105000 = 4200. total = 109200
r = calculateNewRegime(1500000, false);
check("New regime, 15L freelancer -> slab tax + cess", r.finalTax, 109200);

// Old regime: no deductions, gross 6L
// taxable = 600000. slabs: 0-2.5L@0, 2.5-5L@5%=12500, 5-6L@20%=20000 => 32500
// taxable(6L) > 5L rebate threshold, so rebate does NOT apply. cess 4% = 1300. total = 33800
r = calculateOldRegime(600000);
check("Old regime, 6L no deductions", r.finalTax, 33800);

// Old regime: with 80C max deduction
// gross 6L - 150000(80C) = 450000 taxable -> UNDER 5L rebate threshold -> tax fully rebated to 0
r = calculateOldRegime(600000, 150000);
check("Old regime, 6L with 80C max -> under 5L rebate threshold -> zero tax", r.finalTax, 0);

// Old regime: gross 8L, no deductions -> taxable 800000, above 5L rebate threshold, rebate does NOT apply
// slabs: 0-2.5L@0, 2.5-5L@5%=12500, 5-8L@20%=60000 => 72500. cess 4% = 2900. total = 75400
r = calculateOldRegime(800000);
check("Old regime, 8L no deductions -> above rebate threshold", r.finalTax, 75400);

// Comparison sanity check
const c = compareRegimes(1000000, true);
check("Compare: 10L salaried should favor new regime (0 tax)", c.newRegime.finalTax, 0);

console.log();
const failed = results.filter((x) => !x).length;
if (failed === 0) {
  console.log(`All ${results.length} checks passed.`);
} else {
  console.log(`${failed} of ${results.length} checks FAILED.`);
  process.exitCode = 1;
}
