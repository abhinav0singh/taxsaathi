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

**Revision note (v2.1):** Verified finding during optimizer development:
under FY2026-27 rules, with only 80C/80D modeled (no HRA, no home loan
interest — see non-goals), New Regime beats Old Regime for essentially
every realistic income level. This matches the real-world intent of the
2025 tax reforms (New Regime was deliberately made dominant for earners
without large deductions), so it's not a bug — but it means "compare Old
vs New and pick one" is a weak pitch, since the answer is nearly always
the same. Reframed the product's core value below from *regime comparison*
to *explaining a mostly-settled answer clearly, and catching specific
numeric traps (rebate cliff-edge, marginal savings) a plain calculator
would compute but not surface.*

## 1. Problem

First-time earners in India (students, freelancers, interns) file taxes for
the first time with no intuition for slabs, regimes, deductions, or rebates.
Existing calculators (ClearTax, official IT portal) give you a number and
stop there. Two specific gaps this project targets:

1. Most first-time earners don't know **why** New Regime is now the right
   default for them — they see "two regimes" and assume it's a real choice
   requiring research, when for most of them it structurally isn't anymore.
   Nobody's explaining *why*, in their own numbers.
2. A plain calculator computes a rebate cliff-edge or a marginal-savings
   opportunity but doesn't **surface** it — the number exists in the math,
   but the user never sees it unless they know to go looking. E.g., earning
   ₹1 over the ₹12.75L threshold can add ₹60,000+ in tax; nothing about
   that is obvious from a bare "your tax is ₹X" output.

## 2. Target user

A 20-something earning their first salary or freelance income, who has never
filed an ITR, doesn't know what "80C" or "regime" means, and would otherwise
either (a) blindly trust New Regime without knowing why it's right for them,
or (b) waste time comparing regimes manually when the answer is settled for
their situation — while missing the specific numeric traps (cliff-edges,
unused deduction headroom) a bare calculator wouldn't point out.

## 3. Goals (in priority order — cut from the bottom if time runs short)

1. **Must have:** Accurate Old vs New regime tax calculator (FY 2026-27) —
   slabs, 87A rebate (both regimes), surcharge, cess. **DONE.** Note: given
   the v2.1 finding, this is framed to the user as computing *their actual
   number*, not staging a real "which one should I pick" decision — the
   comparison still runs and is shown (transparency matters), but the
   product doesn't oversell it as a genuine toss-up.
2. **Must have:** Two verified, always-meaningful insight functions on top
   of the calculator — rebate cliff-edge proximity detection, and
   within-regime marginal savings from unused 80C/80D headroom. (Dropped:
   a cross-regime "crossover" lever that, per v2.1, can't fire for
   realistic inputs — see docs/SSD.md section 6 for the full finding.)
   Pure computed logic, no AI needed — this is the project's real
   differentiator over a static calculator: not picking a regime for you,
   but catching specific numbers a bare calculator computes and buries.
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
- Forward-looking, multi-year tax PLANNING advice ("what should I do next
  year"). CLARIFICATION (added when the historical comparison feature was
  built): a backward-looking, illustrative "then vs. now" comparison using
  a real prior-year rule change (FY2024-25's rebate threshold vs today's)
  is judged to be in scope -- it reuses existing computation with zero new
  inputs and reinforces the product's own pitch, rather than offering
  planning advice. This line was consciously narrowed for that reason, not
  silently overridden -- see calculator.js's compareAcrossYears.
- Login/auth/accounts — stateless, single-session tool for the demo.
- Full vector-embedding RAG — keyword retrieval-lite is the deliberate scope.
- Modeling HRA, home loan interest (Section 24b), or employer NPS
  contribution (80CCD(2)) under Old Regime — these are the deductions that
  actually make Old Regime competitive for higher earners in the real
  world, and excluding them is why Old Regime rarely wins in this tool
  (see v2.1 revision note above). Explicit scope cut for hackathon time,
  not an oversight — state this if asked why Old Regime "never wins."

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