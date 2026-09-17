/**
 * TaxSaathi core tax calculator (FY 2026-27).
 *
 * Pure JavaScript — no AWS, no network calls. Given a person's income and
 * deduction details, returns computed tax under both Old and New regimes.
 *
 * Every function here is a pure function (same input -> same output, no
 * side effects, no shared state). That's deliberate: it makes each piece
 * testable in isolation, and this file becomes the Lambda function body
 * later with zero changes.
 */

// ---------------------------------------------------------------------------
// Slab definitions
// ---------------------------------------------------------------------------
// Each slab is [lowerBound, upperBound, rate]. upperBound=null means "and above".
// Amounts are in rupees.

const NEW_REGIME_SLABS = [
  [0, 400000, 0.00],
  [400000, 800000, 0.05],
  [800000, 1200000, 0.10],
  [1200000, 1600000, 0.15],
  [1600000, 2000000, 0.20],
  [2000000, 2400000, 0.25],
  [2400000, null, 0.30],
];

const OLD_REGIME_SLABS = [
  [0, 250000, 0.00],
  [250000, 500000, 0.05],
  [500000, 1000000, 0.20],
  [1000000, null, 0.30],
];

const CESS_RATE = 0.04;                    // Health & Education Cess, on (tax + surcharge)
const SURCHARGE_THRESHOLD = 5000000;       // ₹50L — above this, surcharge kicks in
const STANDARD_DEDUCTION_SALARIED = 75000; // New regime, salaried only
const NEW_REGIME_REBATE_THRESHOLD = 1200000;  // New regime 87A: taxable income up to 12L -> zero tax
const OLD_REGIME_REBATE_THRESHOLD = 500000;   // Old regime 87A: taxable income up to 5L -> zero tax (smaller, separate provision)

/**
 * Applies a progressive slab structure to taxable income.
 *
 * "Progressive" means each slice of income is taxed at its own rate — e.g.
 * under the new regime, the first 4L is tax-free no matter how high your
 * total income is; only the portion between 4L-8L is taxed at 5%, and so
 * on. We walk each slab and tax only the portion of income inside it.
 */
function computeSlabTax(taxableIncome, slabs) {
  if (taxableIncome <= 0) return 0;

  let tax = 0;
  for (const [lower, upper, rate] of slabs) {
    if (taxableIncome <= lower) break;
    const slabUpper = upper !== null ? upper : taxableIncome;
    const taxableInSlab = Math.min(taxableIncome, slabUpper) - lower;
    if (taxableInSlab > 0) tax += taxableInSlab * rate;
  }
  return tax;
}

/**
 * Section 87A rebate — New Regime.
 *
 * A rebate differs from a deduction: a deduction lowers taxable income
 * *before* tax is computed; a rebate wipes out tax *after* it's computed,
 * but only below a threshold.
 *
 * NOTE: this is a cliff-edge, not a gradual phase-out. Cross the threshold
 * by ₹1 and the ENTIRE tax becomes payable, not just tax on the excess.
 * That's a real quirk of the law, not a bug in this code.
 */
function applyNewRegimeRebate(taxableIncome, tax) {
  if (taxableIncome <= NEW_REGIME_REBATE_THRESHOLD) return 0;
  return tax;
}

/**
 * Section 87A rebate — Old Regime.
 *
 * This is a SEPARATE, smaller provision from the new-regime rebate above:
 * old regime rebate threshold is 5L taxable income, not 12L. This was
 * missing from the first version of this calculator — flagging that fix
 * explicitly here since it changes the answer for any old-regime user
 * under 5L taxable income (a very plausible bracket for first-time earners).
 */
function applyOldRegimeRebate(taxableIncome, tax) {
  if (taxableIncome <= OLD_REGIME_REBATE_THRESHOLD) return 0;
  return tax;
}

/**
 * Surcharge: extra charge on top of tax, only for high incomes.
 * We only implement the >50L bracket (the first threshold) since
 * TaxSaathi's target users (students/freelancers/interns) won't realistically
 * be anywhere near this range. Deliberate scope cut, not an oversight —
 * flagged here so it isn't mistaken for a missed case later.
 */
function applySurcharge(tax, taxableIncome) {
  if (taxableIncome > SURCHARGE_THRESHOLD) return tax * 0.10; // 10% surcharge, first slab only
  return 0;
}

/** Health & Education Cess: flat 4% on (tax + surcharge), both regimes. */
function applyCess(taxPlusSurcharge) {
  return taxPlusSurcharge * CESS_RATE;
}

/**
 * Full New Regime computation, in order:
 * gross income -> standard deduction (if salaried) -> slab tax ->
 * 87A rebate -> surcharge -> cess -> final tax
 */
function calculateNewRegime(grossIncome, isSalaried = true) {
  const standardDeduction = isSalaried ? STANDARD_DEDUCTION_SALARIED : 0;
  const taxableIncome = Math.max(0, grossIncome - standardDeduction);

  const slabTax = computeSlabTax(taxableIncome, NEW_REGIME_SLABS);
  const taxAfterRebate = applyNewRegimeRebate(taxableIncome, slabTax);
  const surcharge = applySurcharge(taxAfterRebate, taxableIncome);
  const cess = applyCess(taxAfterRebate + surcharge);
  const finalTax = taxAfterRebate + surcharge + cess;

  return {
    regime: "new",
    grossIncome,
    standardDeduction,
    taxableIncome,
    slabTax: round2(slabTax),
    rebateApplied: slabTax > 0 && taxAfterRebate === 0,
    surcharge: round2(surcharge),
    cess: round2(cess),
    finalTax: round2(finalTax),
  };
}

/**
 * Full Old Regime computation, in order:
 * gross income -> minus 80C/80D deductions -> slab tax -> 87A rebate ->
 * surcharge -> cess -> final tax
 */
function calculateOldRegime(grossIncome, deductions80c = 0, deductions80d = 0) {
  const cappedDeductions80c = Math.min(deductions80c, 150000); // 80C capped at 1.5L by law
  const taxableIncome = Math.max(0, grossIncome - cappedDeductions80c - deductions80d);

  const slabTax = computeSlabTax(taxableIncome, OLD_REGIME_SLABS);
  const taxAfterRebate = applyOldRegimeRebate(taxableIncome, slabTax);
  const surcharge = applySurcharge(taxAfterRebate, taxableIncome);
  const cess = applyCess(taxAfterRebate + surcharge);
  const finalTax = taxAfterRebate + surcharge + cess;

  return {
    regime: "old",
    grossIncome,
    deductions80c: cappedDeductions80c,
    deductions80d,
    taxableIncome,
    slabTax: round2(slabTax),
    rebateApplied: slabTax > 0 && taxAfterRebate === 0,
    surcharge: round2(surcharge),
    cess: round2(cess),
    finalTax: round2(finalTax),
  };
}

/** Runs both regimes and returns a side-by-side comparison. */
function compareRegimes(grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0) {
  const newRegime = calculateNewRegime(grossIncome, isSalaried);
  const oldRegime = calculateOldRegime(grossIncome, deductions80c, deductions80d);

  const recommended = newRegime.finalTax <= oldRegime.finalTax ? "new" : "old";
  const savings = Math.abs(newRegime.finalTax - oldRegime.finalTax);

  return {
    newRegime,
    oldRegime,
    recommended,
    savings: round2(savings),
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Regime-optimization logic (SSD.md v2, section 6)
// ---------------------------------------------------------------------------
// Pure functions, same pattern as everything above. Output is structured
// data (numbers + a reason code) — no prose. The `explain` Lambda phrases
// this into language later via Bedrock; this layer never does language,
// Bedrock never does math (SSD.md's separation-of-concerns principle).

// Heuristic threshold below is a deliberate hackathon-speed judgment call,
// not a value from tax law. Flagging it explicitly so it's easy to spot
// and revisit if time allows:
const REBATE_CLIFF_PROXIMITY_BAND = 50000; // "near" the 87A cliff = within ±₹50,000 of it

/**
 * Within-regime lever #1: if Old Regime is the CURRENT recommendation, how
 * much would maxing out remaining 80C room actually save?
 *
 * Deliberately scoped to only fire when Old is recommended — New Regime
 * doesn't accept 80C/80D deductions at all, so "max your 80C" is not a
 * lever that changes anything for a New-Regime user; suggesting it anyway
 * would be misleading, not just unhelpful. (This replaces an earlier
 * cross-regime "crossover" version of this function — see the note at the
 * bottom of test_calculator.js for why that approach was dropped.)
 */
function analyzeDeductionHeadroom(grossIncome, deductions80c = 0, deductions80d = 0, recommendedRegime) {
  if (recommendedRegime !== "old") {
    return {
      applicable: false,
      remainingHeadroom: null,
      potentialSavings: null,
      reasonCode: "NOT_APPLICABLE_NEW_REGIME_NO_DEDUCTIONS",
    };
  }

  const remainingHeadroom = Math.max(0, 150000 - deductions80c);
  if (remainingHeadroom === 0) {
    return {
      applicable: false,
      remainingHeadroom: 0,
      potentialSavings: 0,
      reasonCode: "ALREADY_MAXED_80C",
    };
  }

  const currentTax = calculateOldRegime(grossIncome, deductions80c, deductions80d).finalTax;
  const maxedTax = calculateOldRegime(grossIncome, deductions80c + remainingHeadroom, deductions80d).finalTax;
  const savings = round2(currentTax - maxedTax);

  if (savings <= 0) {
    return {
      applicable: false,
      remainingHeadroom,
      potentialSavings: 0,
      reasonCode: "NO_ADDITIONAL_SAVINGS",
    };
  }

  return {
    applicable: true,
    remainingHeadroom,
    potentialSavings: savings,
    reasonCode: "MAXING_80C_SAVES",
  };
}

/**
 * Within-regime lever #2: distance to the next slab boundary, in whichever
 * regime is currently recommended.
 *
 * Always computable — every taxable income sits inside exactly one slab
 * bracket, in both regimes. Answers "how much more taxable income before
 * your marginal rate jumps" (useful for a freelancer deciding whether to
 * take on more work this FY) rather than prescribing an action.
 */
function findSlabBoundaryDistance(taxableIncome, slabs) {
  for (let i = 0; i < slabs.length; i++) {
    const [lower, upper, rate] = slabs[i];
    const inThisSlab = taxableIncome >= lower && (upper === null || taxableIncome < upper);
    if (inThisSlab) {
      if (upper === null) {
        return {
          currentMarginalRate: rate,
          nextMarginalRate: null,
          distanceToNextSlab: null,
          reasonCode: "IN_TOP_SLAB",
        };
      }
      const nextMarginalRate = slabs[i + 1] ? slabs[i + 1][2] : null;
      return {
        currentMarginalRate: rate,
        nextMarginalRate,
        distanceToNextSlab: round2(upper - taxableIncome),
        reasonCode: "WITHIN_SLAB",
      };
    }
  }
  // Unreachable given slabs cover [0, Infinity) — guard kept cheap and honest.
  return {
    currentMarginalRate: null,
    nextMarginalRate: null,
    distanceToNextSlab: null,
    reasonCode: "UNRESOLVED_SLAB",
  };
}

function analyzeSlabBoundary(grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0, recommendedRegime) {
  let taxableIncome;
  let slabs;

  if (recommendedRegime === "new") {
    const standardDeduction = isSalaried ? STANDARD_DEDUCTION_SALARIED : 0;
    taxableIncome = Math.max(0, grossIncome - standardDeduction);
    slabs = NEW_REGIME_SLABS;
  } else {
    const cappedDeductions80c = Math.min(deductions80c, 150000);
    taxableIncome = Math.max(0, grossIncome - cappedDeductions80c - deductions80d);
    slabs = OLD_REGIME_SLABS;
  }

  return findSlabBoundaryDistance(taxableIncome, slabs);
}

/**
 * Rebate cliff-edge proximity — New Regime only.
 *
 * The 87A rebate in the new regime is a cliff (see applyNewRegimeRebate's
 * comment): taxable income of exactly 12L pays zero tax; 12L + ₹1 pays tax
 * on the FULL amount, not just the ₹1 over. This flags when a user is close
 * to that cliff on either side, since it's worth knowing about even though
 * (unlike the crossover above) there's no deduction lever to pull here —
 * the new regime doesn't accept 80C/80D deductions at all.
 *
 * Threshold note: taxable income threshold is always ₹12L, but the GROSS
 * income threshold differs by ₹75,000 (the standard deduction) depending on
 * salaried status — ₹12.75L gross for salaried, ₹12L gross for freelance.
 * That's the "12L / 12.75L" distinction from SSD.md section 6.
 */
function checkRebateCliffProximity(grossIncome, isSalaried = true) {
  const standardDeduction = isSalaried ? STANDARD_DEDUCTION_SALARIED : 0;
  const taxableIncome = Math.max(0, grossIncome - standardDeduction);
  const distance = taxableIncome - NEW_REGIME_REBATE_THRESHOLD;

  if (distance > 0 && distance <= REBATE_CLIFF_PROXIMITY_BAND) {
    return {
      nearCliff: true,
      side: "just_above",
      distanceFromThreshold: round2(distance),
      reasonCode: "JUST_ABOVE_REBATE_CLIFF",
    };
  }

  if (distance <= 0 && Math.abs(distance) <= REBATE_CLIFF_PROXIMITY_BAND) {
    return {
      nearCliff: true,
      side: "just_below",
      distanceFromThreshold: round2(Math.abs(distance)),
      reasonCode: "SAFELY_JUST_BELOW_REBATE_CLIFF",
    };
  }

  return {
    nearCliff: false,
    side: null,
    distanceFromThreshold: null,
    reasonCode: "NOT_NEAR_CLIFF",
  };
}

/**
 * Combines the current comparison with all optimizer signals into one
 * structured result — this is what the `calculate` Lambda will return once
 * wired up (SSD.md section 4).
 */
function analyzeOptimization(grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0) {
  const comparison = compareRegimes(grossIncome, isSalaried, deductions80c, deductions80d);
  const rebateCliffEdge = checkRebateCliffProximity(grossIncome, isSalaried);
  const deductionHeadroom = analyzeDeductionHeadroom(grossIncome, deductions80c, deductions80d, comparison.recommended);
  const slabBoundary = analyzeSlabBoundary(grossIncome, isSalaried, deductions80c, deductions80d, comparison.recommended);

  return {
    currentRecommendation: comparison.recommended,
    rebateCliffEdge,
    deductionHeadroom,
    slabBoundary,
  };
}

module.exports = {
  computeSlabTax,
  applyNewRegimeRebate,
  applyOldRegimeRebate,
  applySurcharge,
  applyCess,
  calculateNewRegime,
  calculateOldRegime,
  compareRegimes,
  checkRebateCliffProximity,
  analyzeDeductionHeadroom,
  findSlabBoundaryDistance,
  analyzeSlabBoundary,
  analyzeOptimization,
};