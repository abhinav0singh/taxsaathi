# TaxSaathi — Product Requirements Document (PRD)

**Event:** WeMakeDevs First Commit, Bharat Builds Tour, Ship It track
**Deadline:** Sunday 20 Sept 2026, 8:00 PM IST (official). Working buffer target: [confirm with team].

## 1. Problem

First-time earners in India (students, freelancers, interns) file taxes for
the first time with no intuition for slabs, regimes, deductions, or rebates.
Existing calculators (ClearTax, official IT portal) assume the user already
understands tax vocabulary. They compute a number but don't explain *why*.

## 2. Target user

A 20-something earning their first salary or freelance income, who has never
filed an ITR, doesn't know what "80C" or "regime" means, and wants a plain
answer: "how much tax do I owe, and what should I do about it."

## 3. Goals (in priority order — cut from the bottom if time runs short)

1. **Must have:** Accurate Old vs New regime tax calculator (FY 2026-27),
   correctly handling slabs, 87A rebate (both regimes), surcharge, cess.
2. **Must have:** A working API (API Gateway + Lambda) any frontend can call.
3. **Must have:** A usable frontend where a user enters income details and
   sees a clear comparison + recommendation.
4. **Should have:** AI guidance layer (Bedrock) — user describes income in
   free text, gets it parsed into structured fields automatically.
5. **Should have:** Follow-up Q&A — user asks "what is 80C?" and gets an
   answer grounded in a curated explainer dataset (DynamoDB), in the context
   of their own numbers.
6. **Nice to have:** Polished UI, saved history, PDF summary export.

## 4. Non-goals (explicitly out of scope — say so if asked, don't silently build)

- Actual e-filing / integration with the IT portal.
- Support for capital gains, business income, or other complex income types
  beyond salary/freelance.
- Surcharge slabs beyond the first (₹50L+) threshold.
- Multi-year comparison or tax planning advice beyond the current FY.
- Login/auth/accounts — this is a stateless, single-session tool for the demo.

## 5. Success criteria for the hackathon submission

- Judges can watch a ≤3 min video and see: a real user flow, AWS services
  visibly in use (not just claimed), and the AI layer doing something a
  hardcoded calculator alone couldn't (explaining, not just computing).
- Repo history shows real incremental work across the event dates.
- Writeup clearly states the problem, what was built, and where AWS fits.

## 6. Key risks

- Bedrock integration is the most AWS-unfamiliar piece — highest risk of
  time overrun. Mitigation: mock the response shape early, build against
  the mock, swap in real Bedrock calls once the contract is proven.
- Tax law edge cases (surcharge tiers, deduction interactions) could eat
  time if scope isn't held firmly to section 4 above.
