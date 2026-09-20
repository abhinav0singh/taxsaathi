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
const OLD_REGIME_STANDARD_DEDUCTION_SALARIED = 50000; // Old regime, salaried only -- confirmed
  // via multiple independent sources (taxbuddy.com, cleartax.in) as ₹50,000
  // for FY 2026-27, unchanged from prior years, distinct from New Regime's
  // ₹75,000. This was MISSING entirely from earlier versions of this
  // calculator -- every salaried Old-vs-New comparison was biased toward
  // New as a result. Fixed here, not silently.
const NEW_REGIME_REBATE_THRESHOLD = 1200000;  // New regime 87A: taxable income up to 12L -> zero tax
const OLD_REGIME_REBATE_THRESHOLD = 500000;   // Old regime 87A: taxable income up to 5L -> zero tax (smaller, separate provision)

// Marginal relief zone end (New Regime, FY2026-27): the taxable-income point
// where the marginal-relief formula (below) stops binding and full slab tax
// applies again. Derived from the 15% marginal rate above the 12L threshold:
// slabTax(t) = 60000 + 0.15*(t-1200000); relief caps it at (t-1200000); they
// meet where 60000 = 0.85*(t-1200000) => t = 1200000 + 60000/0.85.
// Independently confirmed against real sources (~₹12,70,500-12,70,588) --
// not just derived in isolation.
const NEW_REGIME_RELIEF_ZONE_END = 1200000 + 60000 / 0.85; // ≈ 1,270,588.24

const OLD_REGIME_80D_CAP = 25000; // Section 80D, self + family, non-senior.
  // SIMPLIFICATION, documented not hidden: real law allows higher limits
  // for senior citizens (₹50,000) and senior-citizen parents (up to
  // ₹50,000 more, overall ceiling ₹1L) -- this calculator doesn't model
  // age/senior-citizen status at all, so it applies the single, more
  // conservative non-senior cap uniformly. A senior-citizen user would see
  // a LOWER 80D benefit here than they're actually entitled to -- flagged
  // in the README and the frontend, not silently capped without saying so.

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
 * Section 87A rebate — New Regime, WITH marginal relief.
 *
 * CORRECTED (was a real, confirmed bug): the previous version treated this
 * as a hard cliff -- ₹0 tax at exactly 12L, full slab tax the instant
 * taxable income exceeded it by even ₹1. That is NOT how the law works.
 * Finance Bill 2025 / Section 115BAC(1A) includes marginal relief: once
 * taxable income exceeds ₹12L, tax payable is capped at the amount by
 * which income exceeds ₹12L -- not the full slab tax. Verified against
 * multiple independent tax-law sources, all citing the identical example
 * this calculator now matches exactly: taxable ₹12,10,000 -> ₹10,000 tax
 * before cess (not ₹61,500), with relief phasing out entirely by
 * approximately ₹12,70,588.
 *
 * This is a REAL rule, not a cliff -- the correct mental model is a "wall":
 * once past ₹12L, roughly every additional ₹1 of income costs roughly ₹1
 * of tax (a ~100%+ effective marginal rate zone, with cess) until relief
 * phases out and normal slab progression resumes.
 */
function applyNewRegimeRebate(taxableIncome, slabTax) {
  if (taxableIncome <= NEW_REGIME_REBATE_THRESHOLD) return 0;
  const excessOverThreshold = taxableIncome - NEW_REGIME_REBATE_THRESHOLD;
  return Math.min(slabTax, excessOverThreshold);
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
 * gross income -> standard deduction (if salaried) -> minus 80C/80D/other
 * deductions -> slab tax -> 87A rebate (NO marginal relief in Old Regime --
 * confirmed, this provision is New-Regime-only) -> surcharge -> cess ->
 * final tax.
 *
 * CORRECTED: isSalaried and its ₹50,000 standard deduction were entirely
 * missing before -- confirmed via multiple sources that this is real,
 * distinct from New Regime's ₹75,000, and its absence biased every
 * salaried Old-vs-New comparison toward New. 80D is now capped (see
 * OLD_REGIME_80D_CAP for the documented simplification). A new
 * otherOldRegimeDeductions parameter covers HRA / home loan interest /
 * NPS 80CCD(1B) etc. as ONE combined figure, not modeled individually --
 * each has its own real eligibility rules (HRA especially, which depends
 * on rent paid, basic salary, and city) that this calculator does not
 * verify; the user supplies the number, same trust model as 80C/80D.
 */
function calculateOldRegime(grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0, otherOldRegimeDeductions = 0) {
  const standardDeduction = isSalaried ? OLD_REGIME_STANDARD_DEDUCTION_SALARIED : 0;
  const cappedDeductions80c = Math.min(deductions80c, 150000); // 80C capped at 1.5L by law
  const cappedDeductions80d = Math.min(deductions80d, OLD_REGIME_80D_CAP);
  const otherDeductions = Math.max(0, otherOldRegimeDeductions);
  const taxableIncome = Math.max(
    0,
    grossIncome - standardDeduction - cappedDeductions80c - cappedDeductions80d - otherDeductions
  );

  const slabTax = computeSlabTax(taxableIncome, OLD_REGIME_SLABS);
  const taxAfterRebate = applyOldRegimeRebate(taxableIncome, slabTax);
  const surcharge = applySurcharge(taxAfterRebate, taxableIncome);
  const cess = applyCess(taxAfterRebate + surcharge);
  const finalTax = taxAfterRebate + surcharge + cess;

  return {
    regime: "old",
    grossIncome,
    standardDeduction,
    deductions80c: cappedDeductions80c,
    deductions80d: cappedDeductions80d,
    otherOldRegimeDeductions: otherDeductions,
    taxableIncome,
    slabTax: round2(slabTax),
    rebateApplied: slabTax > 0 && taxAfterRebate === 0,
    surcharge: round2(surcharge),
    cess: round2(cess),
    finalTax: round2(finalTax),
  };
}

/** Runs both regimes and returns a side-by-side comparison. */
function compareRegimes(grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0, otherOldRegimeDeductions = 0) {
  const newRegime = calculateNewRegime(grossIncome, isSalaried);
  const oldRegime = calculateOldRegime(grossIncome, isSalaried, deductions80c, deductions80d, otherOldRegimeDeductions);

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
function analyzeDeductionHeadroom(grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0, otherOldRegimeDeductions = 0, recommendedRegime) {
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

  const currentTax = calculateOldRegime(grossIncome, isSalaried, deductions80c, deductions80d, otherOldRegimeDeductions).finalTax;
  const maxedTax = calculateOldRegime(grossIncome, isSalaried, deductions80c + remainingHeadroom, deductions80d, otherOldRegimeDeductions).finalTax;
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

function analyzeSlabBoundary(grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0, otherOldRegimeDeductions = 0, recommendedRegime) {
  let taxableIncome;
  let slabs;

  if (recommendedRegime === "new") {
    const standardDeduction = isSalaried ? STANDARD_DEDUCTION_SALARIED : 0;
    taxableIncome = Math.max(0, grossIncome - standardDeduction);
    slabs = NEW_REGIME_SLABS;
  } else {
    // Delegates to calculateOldRegime rather than recomputing taxable
    // income here independently -- avoids the two calculations silently
    // drifting apart the way the missing standard deduction did before.
    taxableIncome = calculateOldRegime(grossIncome, isSalaried, deductions80c, deductions80d, otherOldRegimeDeductions).taxableIncome;
    slabs = OLD_REGIME_SLABS;
  }

  return findSlabBoundaryDistance(taxableIncome, slabs);
}

/**
 * Rebate WALL proximity — New Regime only. (Function name kept as-is since
 * it's part of the public API other code calls by name; the concept and
 * output it describes has changed -- see below.)
 *
 * CORRECTED framing: this is not a cliff. With marginal relief in place
 * (see applyNewRegimeRebate), crossing ₹12L taxable income doesn't zero
 * out to full tax instantly -- it enters a WALL zone (taxable ₹12L to
 * ~₹12,70,588) where each additional rupee of income costs very close to
 * a full rupee of tax, before easing back to normal slab progression.
 * That's the real, striking, verifiable fact -- not a hard drop.
 *
 * Threshold note: taxable income boundary is always ₹12L / ~₹12.7L
 * regardless of salaried status; the GROSS income equivalent shifts by
 * the ₹75,000 standard deduction -- ₹12.75L gross for salaried is where
 * the wall begins, ₹12L gross for freelance.
 */
function checkRebateCliffProximity(grossIncome, isSalaried = true) {
  const standardDeduction = isSalaried ? STANDARD_DEDUCTION_SALARIED : 0;
  const taxableIncome = Math.max(0, grossIncome - standardDeduction);

  const inWallZone = taxableIncome > NEW_REGIME_REBATE_THRESHOLD && taxableIncome <= NEW_REGIME_RELIEF_ZONE_END;
  if (inWallZone) {
    return {
      nearCliff: true, // field name kept for backward compatibility with existing callers
      side: "in_wall_zone",
      distanceFromThreshold: round2(taxableIncome - NEW_REGIME_REBATE_THRESHOLD),
      distanceToWallEnd: round2(NEW_REGIME_RELIEF_ZONE_END - taxableIncome),
      reasonCode: "IN_MARGINAL_RELIEF_WALL_ZONE",
    };
  }

  const approachingBand = 50000; // heuristic, documented: "about to hit the wall" warning distance
  const distanceBelow = NEW_REGIME_REBATE_THRESHOLD - taxableIncome;
  if (distanceBelow > 0 && distanceBelow <= approachingBand) {
    return {
      nearCliff: true,
      side: "approaching_wall",
      distanceFromThreshold: round2(distanceBelow),
      distanceToWallEnd: null,
      reasonCode: "APPROACHING_REBATE_WALL",
    };
  }

  return {
    nearCliff: false,
    side: null,
    distanceFromThreshold: null,
    distanceToWallEnd: null,
    reasonCode: "NOT_NEAR_WALL",
  };
}

// ---------------------------------------------------------------------------
// Historical comparison — FY2024-25 New Regime, for "then vs now" framing
// ---------------------------------------------------------------------------
// Verified against public sources (Budget 2024 coverage) before adding.
// Deliberately backward-looking only, not tax planning -- this illustrates
// how much the FY2026-27 reform changed things for the SAME income, it does
// not advise the user on anything. See docs/PRD.md non-goals for why this
// distinction matters: forward-looking multi-year planning stays out of
// scope, this does not cross that line.

const FY2024_25_NEW_REGIME_SLABS = [
  [0, 300000, 0.00],
  [300000, 700000, 0.05],
  [700000, 1000000, 0.10],
  [1000000, 1200000, 0.15],
  [1200000, 1500000, 0.20],
  [1500000, null, 0.30],
];
const FY2024_25_REBATE_THRESHOLD = 700000;   // vs 1,200,000 today -- this is the headline number
const FY2024_25_STANDARD_DEDUCTION = 75000;  // unchanged from today, confirmed via search

/**
 * Generalized version of calculateNewRegime, parameterized by year config,
 * so old years can be computed without duplicating slab/surcharge/cess
 * logic. calculateNewRegime() itself is untouched -- this is intentionally
 * a separate function, not a refactor of the already-verified one, to
 * avoid any risk of regressing tested behavior under time pressure.
 *
 * CORRECTED: now applies marginal relief using the YEAR-SPECIFIC threshold
 * (₹7L for FY2024-25), not a hard cliff. Confirmed via search that
 * marginal relief existed for the ₹7L threshold too (Finance Bill 2023),
 * not just this year's ₹12L one -- the FY2024-25 comparison had the exact
 * same class of bug as the current-year calculation did.
 */
function calculateNewRegimeForYear(grossIncome, isSalaried, slabs, rebateThreshold, standardDeduction) {
  const stdDed = isSalaried ? standardDeduction : 0;
  const taxableIncome = Math.max(0, grossIncome - stdDed);

  const slabTax = computeSlabTax(taxableIncome, slabs);
  const taxAfterRebate = taxableIncome <= rebateThreshold
    ? 0
    : Math.min(slabTax, taxableIncome - rebateThreshold);
  const surcharge = applySurcharge(taxAfterRebate, taxableIncome);
  const cess = applyCess(taxAfterRebate + surcharge);
  const finalTax = taxAfterRebate + surcharge + cess;

  return { taxableIncome, slabTax: round2(slabTax), finalTax: round2(finalTax) };
}

/**
 * "Then vs now": same gross income, FY2024-25 New Regime rules vs today's.
 * Purely illustrative -- reveals the real effect of the FY2026-27 reform
 * (rebate threshold jumped from 7L to 12L) rather than recommending
 * anything. No new user inputs required.
 */
function compareAcrossYears(grossIncome, isSalaried = true) {
  const current = calculateNewRegime(grossIncome, isSalaried);
  const fy2024_25 = calculateNewRegimeForYear(
    grossIncome, isSalaried, FY2024_25_NEW_REGIME_SLABS, FY2024_25_REBATE_THRESHOLD, FY2024_25_STANDARD_DEDUCTION
  );
  const savingsFromReform = round2(fy2024_25.finalTax - current.finalTax);

  let reasonCode;
  if (savingsFromReform > 0) reasonCode = "REFORM_SAVED_YOU_MONEY";
  else if (savingsFromReform < 0) reasonCode = "OLDER_RULES_WERE_CHEAPER";
  else reasonCode = "NO_DIFFERENCE";

  return {
    currentFinalTax: current.finalTax,
    fy2024_25FinalTax: fy2024_25.finalTax,
    savingsFromReform,
    reasonCode,
  };
}

// ---------------------------------------------------------------------------
// Effective vs marginal rate -- cheap, always-computable context
// ---------------------------------------------------------------------------

function findMarginalRate(taxableIncome, slabs) {
  if (taxableIncome <= 0) return 0;
  let rate = 0;
  for (const [lower, , r] of slabs) {
    if (taxableIncome > lower) rate = r;
    else break;
  }
  return rate;
}

/**
 * Effective rate = actual tax as a % of gross income (usually well below
 * the top marginal rate -- a genuinely useful, often-surprising number for
 * a first-time filer). Marginal rate = the rate applied to their next
 * rupee, computed from whichever regime is currently recommended.
 */
function computeRateSummary(grossIncome, taxableIncome, finalTax, slabs) {
  const effectiveRatePercent = grossIncome > 0 ? round2((finalTax / grossIncome) * 100) : 0;
  const marginalRatePercent = round2(findMarginalRate(taxableIncome, slabs) * 100);
  return { effectiveRatePercent, marginalRatePercent };
}

/**
 * Combines the full regime comparison with all optimizer signals into one
 * structured result — this is what the `calculate` Lambda returns directly
 * (SSD.md section 4: "full comparison + optimization suggestion"). Includes
 * the complete `comparison` object (both regimes' tax breakdowns), not just
 * the recommendation label, so this function alone is a complete API
 * response with nothing further to assemble.
 */
function analyzeOptimization(grossIncome, isSalaried = true, deductions80c = 0, deductions80d = 0, otherOldRegimeDeductions = 0) {
  const comparison = compareRegimes(grossIncome, isSalaried, deductions80c, deductions80d, otherOldRegimeDeductions);
  const rebateCliffEdge = checkRebateCliffProximity(grossIncome, isSalaried);
  const deductionHeadroom = analyzeDeductionHeadroom(grossIncome, isSalaried, deductions80c, deductions80d, otherOldRegimeDeductions, comparison.recommended);
  const slabBoundary = analyzeSlabBoundary(grossIncome, isSalaried, deductions80c, deductions80d, otherOldRegimeDeductions, comparison.recommended);
  const historicalComparison = compareAcrossYears(grossIncome, isSalaried);

  const recommendedSlabs = comparison.recommended === "new" ? NEW_REGIME_SLABS : OLD_REGIME_SLABS;
  const recommendedTaxableIncome = comparison.recommended === "new"
    ? comparison.newRegime.taxableIncome
    : comparison.oldRegime.taxableIncome;
  const recommendedFinalTax = comparison.recommended === "new"
    ? comparison.newRegime.finalTax
    : comparison.oldRegime.finalTax;
  const rateSummary = computeRateSummary(grossIncome, recommendedTaxableIncome, recommendedFinalTax, recommendedSlabs);

  return {
    comparison,
    currentRecommendation: comparison.recommended,
    rebateCliffEdge,
    deductionHeadroom,
    slabBoundary,
    historicalComparison,
    rateSummary,
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
  compareAcrossYears,
  computeRateSummary,
  analyzeOptimization,
};
