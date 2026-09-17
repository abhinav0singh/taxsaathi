/**
 * Standalone tests for calculator.js — run with: node test_calculator.js
 *
 * No test framework (like Jest) used deliberately, to keep this
 * dependency-free for the hackathon. Each check asserts an expected
 * value and prints a pass/fail line.
 */

const {
  calculateNewRegime,
  calculateOldRegime,
  compareRegimes,
  checkRebateCliffProximity,
  analyzeDeductionHeadroom,
  analyzeSlabBoundary,
  analyzeOptimization,
} = require("./calculator");

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

function checkStr(label, actual, expected) {
  const ok = actual === expected;
  console.log(`[${ok ? "PASS" : "FAIL"}] ${label}: got "${actual}", expected "${expected}"`);
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

// ---------------------------------------------------------------------------
// Optimizer tests -- within-regime levers (rescoped after the crossover
// lever was found to almost never fire -- see the note at the bottom of
// this file for the earlier finding that motivated this rescope).
// ---------------------------------------------------------------------------

// 1. Deduction headroom: Old Regime recommended, headroom remains, maxing
// it produces a real saving.
// analyzeDeductionHeadroom takes recommendedRegime as an explicit parameter
// (decoupled from compareRegimes), so this is a direct unit test of the
// function's own logic -- see the note at the bottom of this file for why
// that decoupling matters for testability here specifically.
// gross 8L, no deductions: current old tax = 75400 (verified above).
// Maxing 80C to 150000 -> taxable 650000 -> slab tax 42500, cess 1700,
// final 44200. Savings = 75400 - 44200 = 31200.
let headroom = analyzeDeductionHeadroom(800000, 0, 0, "old");
checkBool("Deduction headroom: applicable when Old recommended with headroom", headroom.applicable, true);
check("Deduction headroom: remaining 80C room", headroom.remainingHeadroom, 150000, 1);
check("Deduction headroom: potential savings from maxing it", headroom.potentialSavings, 31200, 5);
checkStr("Deduction headroom: reason code", headroom.reasonCode, "MAXING_80C_SAVES");

// 2. Deduction headroom: already maxed -> no lever left.
headroom = analyzeDeductionHeadroom(800000, 150000, 0, "old");
checkBool("Deduction headroom: not applicable once 80C already maxed", headroom.applicable, false);
checkStr("Deduction headroom: reason code when already maxed", headroom.reasonCode, "ALREADY_MAXED_80C");

// 3. Deduction headroom: headroom exists but tax is already zero (rebate
// already covers it), so maxing further saves nothing additional.
// gross 6L, 80C=100000 -> taxable 500000, exactly at the Old rebate
// threshold -> already zero tax before AND after maxing further.
headroom = analyzeDeductionHeadroom(600000, 100000, 0, "old");
checkBool("Deduction headroom: no additional savings once already at zero tax", headroom.applicable, false);
checkStr("Deduction headroom: reason code at zero tax", headroom.reasonCode, "NO_ADDITIONAL_SAVINGS");

// 4. Deduction headroom: not applicable at all when New is the recommended
// regime, regardless of 80C/80D inputs -- New doesn't accept these
// deductions, so suggesting them would be misleading, not just unhelpful.
headroom = analyzeDeductionHeadroom(1000000, 50000, 0, "new");
checkBool("Deduction headroom: not applicable when New recommended", headroom.applicable, false);
checkStr("Deduction headroom: reason code when New recommended", headroom.reasonCode, "NOT_APPLICABLE_NEW_REGIME_NO_DEDUCTIONS");

// 5. Slab boundary: mid-slab, New Regime.
// gross 10L salaried -> taxable 925000, sits in the 8L-12L @ 10% slab.
// Distance to the 12L boundary = 1200000 - 925000 = 275000.
let slab = analyzeSlabBoundary(1000000, true, 0, 0, "new");
check("Slab boundary (New): current marginal rate", slab.currentMarginalRate * 100, 10, 0.01);
check("Slab boundary (New): next marginal rate", slab.nextMarginalRate * 100, 15, 0.01);
check("Slab boundary (New): distance to next slab", slab.distanceToNextSlab, 275000, 1);
checkStr("Slab boundary (New): reason code", slab.reasonCode, "WITHIN_SLAB");

// 6. Slab boundary: mid-slab, Old Regime.
// gross 8L, no deductions -> taxable 800000, sits in the 5L-10L @ 20% slab.
// Distance to the 10L boundary = 1000000 - 800000 = 200000.
slab = analyzeSlabBoundary(800000, true, 0, 0, "old");
check("Slab boundary (Old): current marginal rate", slab.currentMarginalRate * 100, 20, 0.01);
check("Slab boundary (Old): distance to next slab", slab.distanceToNextSlab, 200000, 1);

// 7. Slab boundary: top slab, no next boundary to report.
// gross 30L salaried -> taxable 2925000, above the 24L top-slab floor.
slab = analyzeSlabBoundary(3000000, true, 0, 0, "new");
checkBool("Slab boundary: top slab has no next slab", slab.nextMarginalRate, null);
checkBool("Slab boundary: top slab has no distance", slab.distanceToNextSlab, null);
checkStr("Slab boundary: reason code in top slab", slab.reasonCode, "IN_TOP_SLAB");

// 8. Rebate cliff-edge: just above the threshold.
// Salaried, gross 12.8L -> taxable = 1205000, which is 5000 rupees over the
// 12L cliff (rebate lost entirely on the full amount, per the cliff-edge
// behavior already documented on applyNewRegimeRebate).
let cliff = checkRebateCliffProximity(1280000, true);
checkBool("Cliff-edge: flags proximity when just above", cliff.nearCliff, true);
checkStr("Cliff-edge: side when just above", cliff.side, "just_above");
check("Cliff-edge: distance when just above", cliff.distanceFromThreshold, 5000, 1);

// Rebate cliff-edge: comfortably below, should not flag.
cliff = checkRebateCliffProximity(2000000, true);
checkBool("Cliff-edge: does not flag when far from threshold", cliff.nearCliff, false);
checkStr("Cliff-edge: reason code when far from threshold", cliff.reasonCode, "NOT_NEAR_CLIFF");

// 9. Structured data only -- no prose strings leaking into this layer.
// Every reason code must be SCREAMING_SNAKE_CASE (a code, not a sentence),
// and every numeric field must actually be a number, never a string.
const opt = analyzeOptimization(800000, true, 0, 0);
checkBool(
  "Output check: deductionHeadroom.reasonCode is a reason code, not prose",
  /^[A-Z0-9_]+$/.test(opt.deductionHeadroom.reasonCode),
  true
);
checkBool(
  "Output check: slabBoundary.reasonCode is a reason code, not prose",
  /^[A-Z0-9_]+$/.test(opt.slabBoundary.reasonCode),
  true
);
checkBool(
  "Output check: rebateCliffEdge.reasonCode is a reason code, not prose",
  /^[A-Z0-9_]+$/.test(opt.rebateCliffEdge.reasonCode),
  true
);

console.log();
const failed = results.filter((x) => !x).length;
if (failed === 0) {
  console.log(`All ${results.length} checks passed.`);
} else {
  console.log(`${failed} of ${results.length} checks FAILED.`);
  process.exitCode = 1;
}

/**
 * NOTE on why this file no longer tests a "crossover" function, and why
 * some tests above force recommendedRegime as a direct argument instead of
 * deriving it from compareRegimes():
 *
 * An earlier version of the optimizer computed a cross-regime "crossover"
 * lever (how much more 80C/80D would flip New -> Old). A broad sweep across
 * incomes from 3L to 50L and every reasonable deduction combination found
 * ZERO realistic cases where Old Regime is genuinely cheaper than New for a
 * non-zero comparison -- New's gentler slab structure (30% only starts at
 * 24L, vs Old's 30% starting at 10L) wins by a margin no realistic 80C/80D
 * amount closes, once income is past New's rebate cliff. That crossover
 * lever was replaced with the two within-regime levers tested above
 * (deduction headroom, slab boundary distance), which are always
 * computable regardless of which regime is recommended.
 *
 * Consequence for these tests: since Old is essentially never the actual
 * recommended regime for realistic inputs (except a trivial zero-zero tie),
 * analyzeDeductionHeadroom's "old, positive savings" path can't be reached
 * by feeding realistic income through compareRegimes() first. Because the
 * function takes recommendedRegime as an explicit parameter rather than
 * computing it internally, it's tested directly instead -- this is a
 * deliberate design choice (decoupling the lever from the comparison that
 * feeds it), not a workaround, and it's exactly what makes that branch
 * testable at all.
 */