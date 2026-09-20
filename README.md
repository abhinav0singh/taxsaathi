# TaxSaathi

**Most tax calculators show you a number. This one shows you the wall.**

Under India's New Tax Regime, taxable income up to ₹12,00,000 pays **zero** tax. Cross that line, and marginal relief kicks in — but here's the part almost nobody shows you: in the zone from ₹12L to about ₹12.7L, roughly every extra rupee you earn costs roughly a rupee in tax. It's not a cliff to zero. It's a wall — real, verifiable, built into Section 87A itself. TaxSaathi finds it and shows you exactly where you stand relative to it.

Built for the WeMakeDevs **First Commit** hackathon (Bharat Builds Tour), Ship It track — September 17–20, 2026.

---

## What it actually does

- **Old vs New regime comparison** — deterministic, zero AI involved in the math. FY 2026-27 slabs, surcharge, cess, and Section 87A marginal relief. Treat these as *estimates* — see "Known simplifications" below for what isn't modeled (senior-citizen limits, individual HRA rules, surcharge above ₹50L).
- **Optimizer signals**, surfaced as first-class results, not buried under the tax number:
  - **Rebate wall zone** — are you inside the ₹12L–₹12.7L marginal-relief zone, or approaching it?
  - **80C deduction headroom** — if the Old Regime is your better option, exactly how much more headroom you have and what it's worth.
  - **Next slab boundary** — how much more income before your marginal rate jumps, and by how much.
  - **Other Old Regime deductions** (HRA, home loan interest, NPS 80CCD(1B)) — one combined field, since without it the Old Regime looked artificially uncompetitive.
- **"Then vs. now" historical comparison** — the same income, run through FY2024-25's rules (₹7L rebate threshold) against today's (₹12L). For a ₹9L salaried earner, that's the difference between owing ₹33,800 and owing ₹0 — the same person, the same income, two years apart. A real, verifiable consequence of a real reform, not a marketing number.
- **Effective vs. marginal rate** — most first-time filers conflate the two. A ₹15L freelancer's marginal rate is 15%; their actual effective rate is 7.28%. Shown side by side.
- **Free-text income parsing** — describe your income in plain English ("I earn 12 lakhs freelancing"), and it fills in the structured form for you.
- **Grounded Q&A** — ask about 80C, 80D, the rebate, or regime choice, answered from a curated reference table, not open-ended generation.

## Why the wall is the actual differentiator

The backend doesn't just compute a number — `checkRebateCliffProximity`, `analyzeDeductionHeadroom`, and `analyzeSlabBoundary` all run on every calculation and are returned as structured, labeled data, specifically so the frontend can't bury them under the headline tax figure. The hero itself renders this: the New Regime's slabs as an ascending profile, with the wall zone drawn as the one dramatic, non-orthogonal line in an otherwise calm, architectural drawing — because that's exactly what it is in the tax code too.

## A real bug we found and fixed, not just a feature we built

A pre-launch review caught that the New Regime rebate was implemented as a hard cliff (₹0 tax at exactly ₹12L, full slab tax the instant it's exceeded) instead of the real rule: **marginal relief**, a genuine Section 87A provision (Finance Bill 2025) that caps the tax increase at the amount income exceeds ₹12L by. At taxable ₹12,10,000, the old code returned ₹61,500; the correct answer, confirmed against multiple independent tax-law sources using this exact example, is ₹10,400 (₹10,000 + cess). The same review also found the Old Regime's ₹50,000 standard deduction for salaried taxpayers was missing entirely, silently biasing every comparison toward New. Both are fixed, verified two independent ways (hand-computed in Python separately from the implementation, then cross-checked against real published examples), and covered by a rebuilt test suite — see Testing below.

## Architecture

```
Browser (public/index.html, hosted on AWS Amplify)
        │
        ├── POST /calculate   ──▶ Lambda (pure JS, no AI) ──▶ response
        ├── POST /parseIncome ──▶ Lambda ──▶ Bedrock (Amazon Nova Lite, Converse API)
        └── POST /explain     ──▶ Lambda ──▶ DynamoDB (TaxExplainers) ──▶ Bedrock (Nova Lite)
                                              │                              │
                                     keyword-match retrieval          graceful fallback
                                     (retrieval-lite RAG)              on ANY failure
```

API Gateway (HTTP API) in front of three Lambda functions, all deployed via AWS SAM. `calculate` is pure computation — no external calls, no AI. `explain` and `parseIncome` call Amazon Bedrock (Nova Lite, via a cross-region inference profile, using the Converse API) and are required to degrade gracefully — not optional, not an afterthought — if Bedrock is ever unavailable. All three routes are rate-limited (10 req/s, burst 20) at the API Gateway level, and the two Bedrock-calling functions have reserved concurrency caps, since they're public and cost money per call.

## The fallback path is a feature, not a bug

Every AI-dependent Lambda call is wrapped in a timeout and a try/catch. On any failure — timeout, access denied, malformed response — the system falls back to a deterministic, honest response instead of crashing:

- `parseIncome` failing returns a clear "couldn't parse automatically" message and the user falls back to the manual form.
- `explain` failing returns the *raw reference snippet* it already found, unphrased — which is provably identical to a snippet lookup with zero LLM involvement, since that's literally what it is.
- The frontend shows this fallback **visibly** (a small badge, an offline-estimate banner) rather than hiding it. A judge can watch the AI layer fail live and see the product keep working.

## Tech stack

| Layer | Technology |
|---|---|
| Infra | AWS SAM (100% IaC — zero console-clicked resources) |
| Compute | AWS Lambda, Node.js 22.x |
| API | Amazon API Gateway (HTTP API) |
| Data | Amazon DynamoDB (`TaxExplainers` — keyword-matched reference table) |
| AI | Amazon Bedrock, Nova Lite, via a cross-region inference profile and the Converse API |
| Frontend | Self-contained HTML/CSS/JS, hosted on AWS Amplify — no framework, no build step |

## IAM, scoped deliberately

Every Lambda's execution role is scoped to exactly what that function needs, nothing more:

- `calculate` — no policies attached at all. It needs nothing beyond basic CloudWatch logging, which SAM grants by default. The *absence* of a `Policies:` block is the least-privilege choice here, not a gap.
- `explain` — `DynamoDBReadPolicy` (read-only, one table) + `bedrock:InvokeModel` scoped to one specific model resource. No write access to anything.
- `parseIncome` — `bedrock:InvokeModel` only, scoped to the same one model. No DynamoDB access at all, since it never touches the table.

## Project structure

```
calculator/          core tax logic — pure functions, zero AWS dependencies, unit tested standalone
lambda/               calculate Lambda (wraps calculator/ directly)
lambda-explain/       explain Lambda — DynamoDB lookup + Bedrock phrasing, with fallback
lambda-parse-income/  parseIncome Lambda — free text → structured fields, with fallback
public/               frontend (index.html) — deployed to AWS Amplify
docs/                 PRD, system design doc, and test plan
template.yaml         SAM template — the entire backend, as code
```

## Testing

**79 automated checks**, run standalone with `node`, no framework — real numbers, not a CI badge:

| File | Checks | Covers |
|---|---|---|
| `calculator/test_calculator.js` | 41 | Both regimes, marginal relief golden cases, all optimizer signals, historical comparison, effective/marginal rates, boundary cases |
| `lambda-explain/test_explain.js` | 17 | Keyword matching, Bedrock success/failure/timeout paths, fallback badge visibility |
| `lambda-parse-income/test_parse_income.js` | 21 | Prompt construction, model-output validation, Bedrock success/failure/timeout paths |

The Bedrock-dependent handlers are built with the model call as an injectable dependency specifically so the fallback logic can be tested for real with a mocked client — not just asserted to exist.

## Honest shortcuts vs. what production would look like

| Shortcut taken (and why) | Production equivalent |
|---|---|
| `calculator.js` is duplicated between `calculator/` and `lambda/`, since SAM can't bundle across sibling folders without extra tooling | A shared npm package or a Lambda Layer — one source of truth |
| `explain`'s retrieval is keyword matching against a small fixed table, not real vector search | A proper embeddings + vector DB pipeline (OpenSearch, or similar) for open-ended coverage |
| No login, no stored user data (a deliberate PRD scope decision, not a corner cut) | Same either way — this one's a feature, not a shortcut |
| Section 80D is capped at a flat ₹25,000, not the real age-tiered limits (senior citizens, senior-citizen parents) | Model the real tiered limits, which needs an age input this calculator doesn't collect |
| HRA / home loan interest / NPS combined into one "Other Old Regime deductions" field instead of modeled individually | Model each with its own real eligibility rules |
| An earlier "crossover" optimizer signal (how much more 80C would flip your recommended regime) was built, tested, then **removed** after a broad sweep found it was structurally unreachable for realistic incomes — replaced with the two within-regime signals that are always computable | N/A — this was correcting course on real evidence, not a shortcut |

## Known simplifications (stated, not hidden)

- **80D** is capped at a flat ₹25,000. Real law allows more for senior citizens and senior-citizen parents (up to ₹1L combined) — not modeled, since this calculator doesn't ask for anyone's age.
- **HRA, home loan interest, and NPS 80CCD(1B)** are combined into one "Other Old Regime deductions" field, not modeled individually — each has its own eligibility rules (HRA especially depends on rent, salary structure, and city) this calculator doesn't verify.
- **Surcharge** only implements the first bracket (>₹50L). A flat 10% is not correct above ₹1Cr.
- **Freelancer income** is treated as gross; the real tax base is net profit (or the presumptive 50% under Section 44ADA).

## Local setup

```bash
# Backend
sam build
sam deploy --parameter-overrides BedrockModelId="apac.amazon.nova-lite-v1:0" BedrockUnderlyingModelId="amazon.nova-lite-v1:0"

# Seed the DynamoDB reference table (one-time, see README-seed.md)

# Calculator tests (no AWS needed)
cd calculator && node test_calculator.js

# Frontend
# Open public/index.html directly, or deploy the public/ folder to Amplify
```

## AI tools used

Built with assistance from Claude (Anthropic), as permitted by the hackathon rules — across architecture, infrastructure-as-code, testing, and frontend design.

## Status

Backend deployed and live-tested. Frontend built and locally verified. Amplify deployment: **[fill in on completion]**. Demo video: **[fill in]**.