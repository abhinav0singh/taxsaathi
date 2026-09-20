/**
 * Standalone tests for calculator.js — run with: node test_calculator.js
 *
 * REWRITTEN following the marginal-relief bug fix. The previous 43 tests
 * were built on the same wrong cliff-edge assumption the code had, so they
 * pinned the bug rather than catching it -- passing tests are not proof of
 * correctness if the tests share the code's own wrong assumption. Every
 * golden value below was computed independently in Python (not derived
 * from this JS), cross-checked against this actual implementation, and
 * for the marginal-relief cases, checked against real published tax-law
 * examples (Finance Bill 2025 coverage) that use the identical numbers.
 */

const {
  calculateNewRegime,
  calculateOldRegime,
  compareRegimes,
  checkRebateCliffProximity,
  analyzeDeductionHeadroom,
  analyzeSlabBoundary,
  compareAcrossYears,
  computeRateSummary,
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

// ===========================================================================
// MARGINAL RELIEF golden cases -- the actual bug fix, verified two ways:
// independently in Python (see the build log), and against real published
// Finance Bill 2025 examples using these exact numbers.
// ===========================================================================

let r = calculateNewRegime(1210000, false); // taxable 12.1L, freelance (no std deduction)
check("Marginal relief: taxable 12.1L -> slabTax", r.slabTax, 61500);
check("Marginal relief: taxable 12.1L -> finalTax (NOT the old, wrong 63960)", r.finalTax, 10400);

r = calculateNewRegime(1275000, true); // salaried gross 12.75L -> taxable exactly 12L
check("Salaried gross 12.75L -> taxable exactly at threshold -> zero tax", r.finalTax, 0);

r = calculateNewRegime(1280000, true); // salaried gross 12.8L
check("Salaried gross 12.8L -> in the wall zone", r.finalTax, 5200);

r = calculateNewRegime(1350000, true); // salaried gross 13.5L -- PAST the wall zone end
check("Salaried gross 13.5L -> past wall zone, full slab tax applies", r.finalTax, 74100);

// ===========================================================================
// OLD REGIME standard deduction -- the second confirmed bug (was entirely
// missing for salaried users, biasing every comparison toward New).
// ===========================================================================

r = calculateOldRegime(500000, false); // freelance, no deductions, taxable exactly 5L
check("Old regime, freelance 5L exactly -> at rebate threshold -> zero tax", r.finalTax, 0);

r = calculateOldRegime(510000, false); // freelance, 5.1L -- Old has NO marginal relief
check("Old regime, freelance 5.1L -> full slab tax, no relief (Old has none)", r.finalTax, 15080);

r = calculateOldRegime(900000, true, 150000, 0);
checkBool("Old regime standard deduction is actually applied for salaried", r.standardDeduction, 50000);
check("9L salaried with 1.5L 80C -- Old Regime tax", r.finalTax, 54600);

r = calculateNewRegime(900000, true);
check("9L salaried with 1.5L 80C -- New Regime tax (unaffected by Old's fix)", r.finalTax, 0);

// ===========================================================================
// 15L freelance -- confirms the fix does NOT change already-correct
// far-from-boundary results (this exact case passed before AND after).
// ===========================================================================

r = calculateNewRegime(1500000, false);
check("15L freelance -- New Regime (unchanged by the fix, well past the wall)", r.finalTax, 109200);

r = calculateOldRegime(1500000, false);
check("15L freelance -- Old Regime, no deductions", r.finalTax, 273000);

// ===========================================================================
// 80D cap -- new, was previously unlimited
// ===========================================================================

r = calculateOldRegime(1000000, true, 0, 100000); // claims 1L in 80D, way over the cap
checkBool("80D is capped at 25,000 (documented simplification, not senior-aware)", r.deductions80d, 25000);

// ===========================================================================
// otherOldRegimeDeductions -- new field (HRA / home loan interest / NPS,
// combined, not modeled individually -- see calculator.js's comment on why)
// ===========================================================================

r = calculateOldRegime(1500000, true, 150000, 25000, 200000);
check(
  "otherOldRegimeDeductions actually reduces taxable income",
  r.taxableIncome,
  1500000 - 50000 - 150000 - 25000 - 200000
);

// ===========================================================================
// Original structural tests, re-verified against the CORRECTED logic
// ===========================================================================

r = calculateNewRegime(1000000, true);
check("New regime, 10L salaried -> rebate zeroes tax", r.finalTax, 0);

r = calculateNewRegime(1300000, true);
checkBool("New regime, 13L salaried -> rebate should NOT apply outright (relief may still reduce it)", r.rebateApplied, false);

const c = compareRegimes(1000000, true);
check("Compare: 10L salaried should favor new regime (0 tax)", c.newRegime.finalTax, 0);

// Deduction headroom -- now needs isSalaried threaded through
let headroom = analyzeDeductionHeadroom(800000, true, 0, 0, 0, "old");
checkBool("Deduction headroom: applicable when Old recommended with headroom", headroom.applicable, true);
check("Deduction headroom: remaining 80C room", headroom.remainingHeadroom, 150000, 1);
checkStr("Deduction headroom: reason code", headroom.reasonCode, "MAXING_80C_SAVES");

headroom = analyzeDeductionHeadroom(800000, true, 150000, 0, 0, "old");
checkBool("Deduction headroom: not applicable once 80C already maxed", headroom.applicable, false);
checkStr("Deduction headroom: reason code when already maxed", headroom.reasonCode, "ALREADY_MAXED_80C");

headroom = analyzeDeductionHeadroom(1000000, true, 50000, 0, 0, "new");
checkBool("Deduction headroom: not applicable when New recommended", headroom.applicable, false);
checkStr("Deduction headroom: reason code when New recommended", headroom.reasonCode, "NOT_APPLICABLE_NEW_REGIME_NO_DEDUCTIONS");

// Slab boundary -- new signature includes otherOldRegimeDeductions
let slab = analyzeSlabBoundary(1000000, true, 0, 0, 0, "new");
check("Slab boundary (New): current marginal rate", slab.currentMarginalRate * 100, 10, 0.01);
check("Slab boundary (New): distance to next slab", slab.distanceToNextSlab, 275000, 1);
checkStr("Slab boundary (New): reason code", slab.reasonCode, "WITHIN_SLAB");

slab = analyzeSlabBoundary(3000000, true, 0, 0, 0, "new");
checkBool("Slab boundary: top slab has no next slab", slab.nextMarginalRate, null);
checkStr("Slab boundary: reason code in top slab", slab.reasonCode, "IN_TOP_SLAB");

// ===========================================================================
// Rebate WALL proximity -- rewritten from "cliff" framing
// ===========================================================================

let wall = checkRebateCliffProximity(1280000, true); // taxable 1205000 -- inside the wall zone
checkBool("Wall zone: flags when inside it", wall.nearCliff, true);
checkStr("Wall zone: side", wall.side, "in_wall_zone");
checkStr("Wall zone: reason code", wall.reasonCode, "IN_MARGINAL_RELIEF_WALL_ZONE");

wall = checkRebateCliffProximity(2000000, true); // well past the wall zone
checkBool("Wall zone: does not flag when far past it", wall.nearCliff, false);
checkStr("Wall zone: reason code when far away", wall.reasonCode, "NOT_NEAR_WALL");

wall = checkRebateCliffProximity(1740000, true); // taxable = 1740000-75000=1665000, way above wall zone end
checkBool("Wall zone: does not flag once relief has phased out", wall.nearCliff, false);

// ===========================================================================
// Historical comparison -- FY2024-25 marginal relief fix
// ===========================================================================

let hist = compareAcrossYears(900000, true);
check("Historical: today's tax on 9L salaried (unaffected, well below 12L)", hist.currentFinalTax, 0);
checkStr("Historical: reason code on clear savings case", hist.reasonCode, "REFORM_SAVED_YOU_MONEY");

// ===========================================================================
// Output shape / structured-data checks
// ===========================================================================

const opt = analyzeOptimization(800000, true);
checkBool(
  "Output check: deductionHeadroom.reasonCode is a reason code, not prose",
  /^[A-Z0-9_]+$/.test(opt.deductionHeadroom.reasonCode),
  true
);
checkBool(
  "Output check: rebateCliffEdge.reasonCode is a reason code, not prose",
  /^[A-Z0-9_]+$/.test(opt.rebateCliffEdge.reasonCode),
  true
);
checkBool(
  "Output check: analyzeOptimization includes historicalComparison",
  typeof opt.historicalComparison === "object" && opt.historicalComparison !== null,
  true
);
checkBool(
  "Output check: analyzeOptimization includes rateSummary",
  typeof opt.rateSummary === "object" && opt.rateSummary !== null,
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
 * NOTE on what changed and why this suite was rebuilt, not extended:
 *
 * The previous suite's numbers were computed under the same wrong
 * cliff-edge assumption the code itself had, so 43 passing tests never
 * caught the bug -- they pinned it. This suite's golden values were
 * computed independently in Python (separate from this JS), then
 * cross-checked against real published marginal-relief examples where
 * applicable.
 *
 * Known, documented simplifications this suite does NOT cover because the
 * calculator itself doesn't model them (see calculator.js's own comments):
 * senior-citizen 80D limits, HRA/home-loan-interest/NPS modeled
 * individually (combined into one otherOldRegimeDeductions field instead),
 * surcharge above ₹50L (only the first bracket is implemented).
 */
