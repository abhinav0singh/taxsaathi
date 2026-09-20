# TaxSaathi — Test Plan

**Revision note (v3): a pre-submission review found a real, severe bug —
the New Regime rebate was a hard cliff, not the real marginal-relief rule
(Section 87A, Finance Bill 2025). At taxable ₹12.1L this produced ₹61,500
instead of the correct ₹10,400. Also found: Old Regime's ₹50,000 salaried
standard deduction was entirely missing, biasing every comparison toward
New. Both fixed, verified two independent ways (Python, separate from the
JS, then cross-checked against real published examples), and the entire
test suite for this file was rebuilt from fresh golden values rather than
patched — the old 43 tests encoded the same wrong assumption the code had,
so they never could have caught this.**

## 1. Calculator (`calculator.js`) — DONE (rebuilt, not just patched)

Run: `node calculator/test_calculator.js` — 41 checks, all passing.

Covers:
- [x] Marginal relief: taxable ₹12.1L -> ₹10,400 (not the old, wrong ₹61,500)
- [x] Salaried gross ₹12.75L/₹12.8L/₹13.5L -- boundary and past-wall-zone cases
- [x] Old Regime standard deduction (₹50,000, salaried) is actually applied
- [x] Old Regime 5L/5.1L boundary (Old Regime has no marginal relief -- confirmed)
- [x] 9L salaried with 1.5L 80C, 15L freelance -- explicit golden cases from the review
- [x] 80D cap (₹25,000) and the new otherOldRegimeDeductions field
- [x] Rebate WALL zone proximity (renamed from "cliff" -- see SSD.md)
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

**Status as of 19 Sept:** Migrated from Anthropic Claude (Bedrock model
access request never resolved) to Amazon Nova Lite via a cross-region
inference profile (`apac.amazon.nova-lite-v1:0`), Converse API. This did
NOT resolve live model calls -- a deeper account-level cause was found and
independently confirmed: every Bedrock on-demand inference quota on this
account is provisioned at 0, including Amazon's own first-party Titan
models (checked directly in the Service Quotas console, screenshot
attached to AWS Support case 178972059100386, filed 18 Sept). This is an
AWS account-level block, outside our control, not fixable by any
IAM/template/model change -- confirmed by the fact that IAM was fixed and
verified correct (no more AccessDeniedException) and the failure mode
changed to ValidationException: Operation not allowed instead, which
matches AWS's own documented pattern for this exact account-level issue.

Fallback logic is fully verified, independently, more than once: locally
via mocked Bedrock client (17+21 = 38 tests, both success and
throw/timeout paths, re-run fresh against the live repo files on 19 Sept),
and LIVE against the deployed endpoints -- confirmed via `.phrased`/
`.parsed` returning `false` and the raw reference answer/manual-form
message returned correctly, with the exact CloudWatch error line pulled
and cross-checked, not just trusted from a status code.

- [x] **Fallback test — parseIncome:** verified locally (mocked) AND live
      (real deployed endpoint, real CloudWatch log showing the real
      ValidationException, `parsed:false` returned correctly).
- [x] **Fallback test — explain:** verified locally (mocked) AND live
      (same, `phrased:false`, raw snippet returned unphrased).
- [x] **IAM check:** confirmed directly from the real `template.yaml` AND
      from the actual CloudFormation changeset of a real deploy — `explain`
      has `DynamoDBReadPolicy` + `bedrock:InvokeModel`/`GetInferenceProfile`
      scoped to one inference profile + its underlying model; `parseIncome`
      has the Bedrock permissions only, no DynamoDB access.
- [ ] `parseIncome`: known test phrases (at least 5) produce correctly
      structured output from a REAL model call. **Blocked on the AWS
      Support case above**, not on code or IAM -- both are independently
      confirmed correct.
- [ ] `explain`: a REAL model call produces a grounded response. **Same
      block as above.**

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