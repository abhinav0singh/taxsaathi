# TaxSaathi — Test Plan

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
- [ ] Surcharge >50L case (currently untested — add before demo if we
      want to claim surcharge support in the writeup)

## 2. Lambda + API Gateway (`calculate` function)

- [ ] Direct Lambda invoke (AWS console "Test" feature) with sample JSON
      input returns expected calculator output — proves the Lambda wrapper
      itself doesn't corrupt the calculator's output.
- [ ] `curl` or Postman request to the deployed API Gateway URL returns
      the same result — proves routing + permissions are correct end to end.
- [ ] Malformed input (missing income field) returns a clear error, not a
      500 crash — basic input validation.
- [ ] CORS headers present — confirmed by testing from an actual browser
      page (not just curl), since CORS is a browser-enforced restriction.

## 3. DynamoDB

- [ ] Table created, sample items inserted for at least: 80C, 80D, 87A
      rebate (both regimes), old vs new regime overview.
- [ ] `explain` Lambda's keyword lookup returns the right item for a few
      test phrasings (e.g. "what's 80c" and "section 80 c" both match).

## 4. Bedrock

- [ ] `parseIncome`: known test phrases (at least 5, varying how income
      is described) produce correctly structured output. Log failures —
      LLM output isn't 100% deterministic, so check this isn't a single
      lucky run.
- [ ] `explain`: given a snippet + a sample calculated result, output is
      grounded (doesn't contradict the snippet or invent numbers not in
      the user's result).
- [ ] Fallback tested: if Bedrock call fails/times out, the app degrades
      gracefully (e.g. shows the raw explainer text without LLM polish)
      rather than crashing the whole flow.

## 5. Frontend

- [ ] Full manual flow: enter income -> see comparison -> ask a question
      -> see an answer, with no console errors.
- [ ] Mobile-width check (judges may view on phone) — layout doesn't break.
- [ ] Test on a completely fresh browser profile / incognito, to catch
      any "works on my machine because I'm logged into AWS" issues.

## 6. End-to-end / demo readiness

- [ ] Full flow works on the deployed URL, not just localhost.
- [ ] At least one full run recorded as backup, in case live demo recording
      hits a flaky network moment.
- [ ] Someone who hasn't seen the project before can use it without
      explanation (quick sanity check that it's actually plain-language).
