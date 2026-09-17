# TaxSaathi — Product Requirements Document (PRD)

**Event:** WeMakeDevs First Commit, Bharat Builds Tour, Ship It track
**Official deadline:** Sunday 20 Sept 2026, 8:00 PM IST
**Working target:** 19 Sept, 8:00 AM (self-imposed buffer)

**Revision note (v2):** Updated after a judge/engineer-bar self-assessment.
Original plan scored low on Innovation and Technical Depth because it read
as a standard "calculator + LLM wrapper" tutorial architecture. This version
folds fixes directly into the build stages rather than adding them at the
end, since most are cheaper to do right the first time (e.g. IAM scoping,
infra-as-code) than to retrofit.

## 1. Problem

First-time earners in India (students, freelancers, interns) file taxes for
the first time with no intuition for slabs, regimes, deductions, or rebates.
Existing calculators (ClearTax, official IT portal) assume the user already
understands tax vocabulary. They compute a number but don't explain *why*,
and don't tell you what you could change to owe less.

## 2. Target user

A 20-something earning their first salary or freelance income, who has never
filed an ITR, doesn't know what "80C" or "regime" means, and wants a plain
answer: "how much tax do I owe, what should I do about it, and what happens
if I change something (like investing more in 80C)?"

## 3. Goals (in priority order — cut from the bottom if time runs short)

1. **Must have:** Accurate Old vs New regime tax calculator (FY 2026-27) —
   slabs, 87A rebate (both regimes), surcharge, cess. **DONE.**
2. **Must have:** Regime-optimization logic — not just "here's your tax,"
   but "here's what would change it" (e.g. crossover point where old regime
   beats new regime given more 80C investment; how much more 80C you'd need
   to flip the recommendation). Pure computed logic, no AI needed — this is
   the project's real differentiator over a static calculator.
3. **Must have:** API layer (API Gateway + Lambda) deployed via
   infrastructure-as-code (AWS SAM), not manual console clicks. Lambda
   execution roles scoped to least-privilege (not admin-wide).
4. **Must have:** A usable, clearly-designed frontend where a user enters
   income details and sees the comparison + optimization suggestion.
5. **Should have:** AI guidance layer (Bedrock) — free-text income parsing,
   and follow-up Q&A grounded in a curated DynamoDB dataset, explained in
   context of the user's own numbers and their optimization suggestion.
   Must degrade gracefully (visible fallback) if Bedrock fails/times out —
   this is treated as a requirement, not a nice-to-have, because an
   untested failure path is a demo risk as much as a code-quality one.
6. **Nice to have:** Saved history, PDF summary export, polish beyond
   functional clarity.

## 4. Non-goals (explicitly out of scope — say so if asked, don't silently build)

- Actual e-filing / integration with the IT portal.
- Support for capital gains, business income, or other complex income types
  beyond salary/freelance.
- Surcharge slabs beyond the first (₹50L+) threshold.
- Multi-year comparison or tax planning advice beyond the current FY.
- Login/auth/accounts — stateless, single-session tool for the demo.
- Full vector-embedding RAG — keyword retrieval-lite is the deliberate scope.

## 5. Success criteria for the hackathon submission

- Judges can watch a ≤3 min video and see: a real user flow, AWS services
  visibly in use, a feature that couldn't exist as a static FAQ (the
  optimization logic + grounded explanation), and at least one moment that
  signals engineering maturity (a handled failure case, or infra-as-code
  mentioned/shown).
- Repo shows infra-as-code (SAM template) for Lambda/API Gateway/DynamoDB,
  not just hand-deployed resources.
- Lambda execution role(s) are scoped, not admin-wide — and the writeup
  says so explicitly, since judges reading the repo won't infer good
  judgment, it has to be stated.
- Repo history shows real incremental work across the event dates.
- Writeup clearly states the problem, what was built, where AWS fits, and
  is explicit about what's a hackathon shortcut vs. what production-grade
  would add — self-awareness reads as competence to a senior reviewer.

## 6. Key risks

- Bedrock integration remains the most AWS-unfamiliar piece and highest
  time risk. Mitigation unchanged: mock the response shape early, build
  against the mock, swap in real Bedrock calls once the contract is proven.
- Adding IaC and role-scoping takes slightly longer than console-clicking
  did originally. Accepted tradeoff — the PRD update exists because the
  original approach scored poorly on exactly the axis judges use to
  separate "tutorial project" from "internship-signal project."
- Optimization logic must stay simple (crossover/suggestion math on top of
  existing pure functions) — do not let this balloon into a general
  tax-planning engine. Scope is: given current inputs, what's the nearest
  lever that changes the recommendation, computed directly.