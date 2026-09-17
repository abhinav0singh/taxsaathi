# TaxSaathi — Test Plan

**Revision note (v2):** Adds tests for the optimizer function, Bedrock
fallback paths, and IAM role scoping verification, per SSD.md v2.

Principle: each stage gets tests before we move to the next, so bugs are
caught where they're cheap to fix, not after everything's wired together.

## 1. Calculator (`calculator.js`) — DONE

Run: `node calculator/test_calculator.js`

Covers:
- [x] New regime: income under 12L salaried -> rebate zeroes tax
- [x] New regime: income just above threshold -> rebate does NOT apply
- [x] New regime: mid-slab freelancer case -> correct slab math + cess
- [x] Old regime: no deductions -> correct slab math + cess, no rebate
- [x] Old regime: with 80C dropping income under 5L -> rebate zeroes tax
- [x] Old regime: above rebate threshold -> rebate does NOT apply
- [x] Regime comparison picks the lower-tax option correctly

Still missing (add if time allows):
- [ ] Boundary values exactly AT slab edges (e.g. exactly 400000, 1200000)
- [ ] Income of 0 / negative input handling
- [ ] Surcharge >50L case (currently untested)

## 2. Optimizer functions (`calculator.js` additions) — DONE per other-chat report, verify locally

Per SSD.md v2.1: crossover lever was dropped (structurally unreachable for
real inputs), replaced with rebate cliff-edge detection and within-regime
deduction headroom. Re-run `node calculator/test_calculator.js` on your own
machine to confirm these pass locally, not just in the other chat's sandbox.

- [ ] Rebate cliff-edge case: user just above ₹12L/₹12.75L threshold ->
      function flags proximity to the cliff, with correct distance.
- [ ] Deduction headroom, New Regime recommended (the common real case):
      confirm function correctly returns "no headroom lever" rather than a
      forced suggestion, since New Regime's own deduction room doesn't
      work the same way as Old's 80C/80D.
- [ ] Deduction headroom, Old Regime recommended (rare in practice — per
      SSD.md v2.1, this branch is tested via direct `recommendedRegime`
      parameter injection, not through a real `compareRegimes()` result,
      since no realistic income actually produces Old as the winner under
      this calculator's scope. This is a deliberate, documented test
      method — not a coverage gap. Confirm the test file itself notes this,
      so a future reader doesn't mistake it for an oversight.
- [ ] Slab boundary distance: confirm correct "₹X away, rate goes from Y%
      to Z%" output at a mid-slab income point.
- [ ] Output is structured data (numbers + reason code), not prose —
      confirm no hardcoded English strings leaking into this layer
      (keeps math/language separation clean per SSD.md section 6).

## 3. Lambda + API Gateway (`calculate` function), via SAM

- [ ] `sam build` and `sam deploy` complete without errors.
- [ ] `sam local invoke` (local test, before deploying) with sample JSON
      input returns expected calculator + optimizer output.
- [ ] Deployed API Gateway URL, tested via curl/Postman, returns the same
      result — proves routing + permissions correct end to end.
- [ ] Malformed input (missing income field) returns a clear error, not a
      500 crash.
- [ ] CORS headers present, confirmed from an actual browser page.
- [ ] **IAM check:** open the `calculate` Lambda's execution role in the
      console and confirm it does NOT have DynamoDB/Bedrock permissions
      it doesn't need (per SSD.md section 3) — this function should only
      need basic logging permissions.

## 4. DynamoDB

- [ ] Table created via SAM template (not console), sample items inserted
      for at least: 80C, 80D, 87A rebate (both regimes), old vs new
      regime overview.
- [ ] `explain` Lambda's keyword lookup returns the right item for a few
      test phrasings (e.g. "what's 80c" and "section 80 c" both match).
- [ ] **IAM check:** confirm the `explain` Lambda's execution role has
      DynamoDB read-only access (Query/GetItem), not write/admin access.

## 5. Bedrock

- [ ] `parseIncome`: known test phrases (at least 5, varying how income
      is described) produce correctly structured output. Log failures —
      LLM output isn't 100% deterministic, check this isn't a single
      lucky run.
- [ ] `explain`: given a snippet + a sample calculated result + optimizer
      output, response is grounded (doesn't contradict the snippet or
      invent numbers not in the user's result).
- [ ] **Fallback test — parseIncome:** simulate a Bedrock failure/timeout
      (e.g. temporarily break the call) and confirm the frontend correctly
      falls back to the manual structured-input form, per SSD.md section 5.
- [ ] **Fallback test — explain:** simulate a Bedrock failure and confirm
      the raw DynamoDB snippet text is returned instead of a crash or
      empty response.
- [ ] **IAM check:** confirm both Bedrock-calling Lambdas' execution roles
      only have `bedrock:InvokeModel`, not broader Bedrock permissions.

## 6. Frontend

- [ ] Full manual flow: enter income -> see comparison + optimization
      suggestion -> ask a question -> see an answer, with no console errors.
- [ ] Mobile-width check (judges may view on phone) — layout doesn't break.
- [ ] Test on a completely fresh browser profile / incognito.
- [ ] Optimization suggestion is visually distinct/clear, not buried —
      this is the project's differentiator, it should be easy to notice.

## 7. Infra-as-code sanity check — NEW

- [ ] `template.yaml` exists in the repo and `sam deploy` can recreate the
      stack from scratch (test this once, ideally on a clean account state
      or at minimum by deleting and redeploying the stack).
- [ ] Repo README or writeup explicitly mentions IaC usage — this needs to
      be stated for a judge/reviewer to notice it, not just be true.

## 8. End-to-end / demo readiness

- [ ] Full flow works on the deployed URL, not just localhost.
- [ ] At least one full run recorded as backup.
- [ ] Someone who hasn't seen the project before can use it without
      explanation.
- [ ] Demo video includes: the optimization suggestion feature clearly
      shown, one visible failure-handling moment (fallback path), and a
      brief CloudWatch Logs cut (per SSD.md section 9).
- [ ] Writeup explicitly separates hackathon shortcuts from production
      considerations (per SSD.md section 10).