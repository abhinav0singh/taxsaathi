<div align="center">

# TaxSaathi

### Most tax calculators show you a number. This one shows you the wall.

**[🔗 Live site](https://main.d20j0nwiyvjjou.amplifyapp.com/)** · **[📁 Repository](https://github.com/abhinav0singh/taxsaathi)**

Built for the WeMakeDevs **First Commit** hackathon (Bharat Builds Tour), Ship It track — September 17–20, 2026

![Node](https://img.shields.io/badge/node-22.x-339933?logo=node.js&logoColor=white)
![AWS SAM](https://img.shields.io/badge/infra-AWS%20SAM-FF9900?logo=amazonaws&logoColor=white)
![Bedrock](https://img.shields.io/badge/AI-Amazon%20Bedrock%20(Nova%20Lite)-8A3FFC)
![Tests](https://img.shields.io/badge/tests-79%20passing-2ea44f)
![License](https://img.shields.io/badge/license-MIT-informational)

</div>

---

## Why this exists

Under India's New Tax Regime for FY 2026-27, taxable income up to **₹12,00,000** pays **zero** tax. Cross that line and most people assume tax phases in gradually. It doesn't — not at first.

In the zone from **₹12L to about ₹12.7L**, marginal relief means roughly **every extra rupee you earn costs roughly a rupee in tax**. Not a cliff to zero — a genuine, verifiable **wall**, built into Section 87A itself. Nobody's calculator surfaces this. TaxSaathi finds it and tells you exactly where you stand relative to it, in your own numbers.

That's the whole pitch: **not** "which regime should I pick" (for most earners that's already settled) but **"here's the specific numeric trap in the law that a plain calculator would compute and never show you."**

---

## Table of contents

- [What it does](#what-it-does)
- [Why the wall is the actual differentiator](#why-the-wall-is-the-actual-differentiator)
- [A real bug we caught and fixed](#a-real-bug-we-caught-and-fixed)
- [Architecture](#architecture)
- [The fallback path is a feature](#the-fallback-path-is-a-feature-not-a-bug)
- [Tech stack](#tech-stack)
- [IAM, scoped deliberately](#iam-scoped-deliberately)
- [Project structure](#project-structure)
- [Testing](#testing)
- [Honest shortcuts vs. production](#honest-shortcuts-vs-what-production-would-look-like)
- [Known simplifications](#known-simplifications-stated-not-hidden)
- [Local setup](#local-setup)
- [AI tools used](#ai-tools-used)
- [Status](#status)

---

## What it does

| Feature | What it actually gives you |
|---|---|
| **Old vs. New regime comparison** | Deterministic, zero AI in the math. FY 2026-27 slabs, surcharge, cess, and Section 87A marginal relief, computed exactly. |
| **Rebate wall zone** | Are you inside the ₹12L–₹12.7L marginal-relief zone, or approaching it? Flagged as a first-class result, not buried under the tax figure. |
| **80C deduction headroom** | If Old Regime is your better option: exactly how much 80C room is left, and what maxing it is worth in rupees. |
| **Next slab boundary** | How much more income before your marginal rate jumps, and by how much. |
| **Other Old Regime deductions** | HRA, home loan interest, NPS 80CCD(1B) — one combined field, so Old Regime isn't artificially uncompetitive against New. |
| **"Then vs. now"** | The *same* income, run through FY2024-25 rules (₹7L rebate threshold) against today's (₹12L). A ₹9L salaried earner: ₹33,800 owed then, ₹0 owed now. Same person, same income, two years apart. |
| **Effective vs. marginal rate** | Most first-time filers conflate the two. A ₹15L freelancer's marginal rate is 15%; effective rate is 7.28%. Shown side by side. |
| **Free-text income parsing** | Type "I earn 12 lakhs freelancing" and the structured form fills itself in. |
| **Grounded Q&A** | Ask about 80C, 80D, the rebate, or regime choice — answered from a curated reference table, not open-ended generation. |

All figures are **estimates** for resident individuals with salary or business income — see [Known simplifications](#known-simplifications-stated-not-hidden).

## Why the wall is the actual differentiator

The backend doesn't stop at a tax number. `checkRebateCliffProximity`, `analyzeDeductionHeadroom`, and `analyzeSlabBoundary` all run on every calculation and return structured, labeled data — specifically so the frontend *can't* bury them under the headline figure. The hero itself renders this idea visually: the New Regime's slabs drawn as an ascending profile, with the wall zone rendered as the one dramatic, non-orthogonal line in an otherwise calm, architectural drawing — because that's exactly what it is in the tax code too.

## A real bug we caught and fixed

A pre-launch review caught that the New Regime rebate was implemented as a **hard cliff** — ₹0 tax at exactly ₹12L, full slab tax the instant it's exceeded — instead of the real rule: **marginal relief**, a genuine Section 87A provision (Finance Bill 2025) that caps the tax increase at the amount income exceeds ₹12L by.

| | Old (buggy) behavior | Correct behavior |
|---|---|---|
| Taxable income ₹12,10,000 | ₹61,500 tax | **₹10,000** tax (+ cess = ₹10,400) |

The same review found the Old Regime's ₹50,000 standard deduction for salaried taxpayers was **missing entirely**, silently biasing every comparison toward New. Both are fixed, verified two independent ways (hand-computed separately from the implementation, then cross-checked against published worked examples), and covered by a rebuilt test suite — see [Testing](#testing).

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

API Gateway (HTTP API) sits in front of three Lambda functions, all deployed via AWS SAM.

- **`calculate`** is pure computation — no external calls, no AI, no policies beyond default CloudWatch logging.
- **`explain`** and **`parseIncome`** call Amazon Bedrock (Nova Lite, via a cross-region inference profile, using the Converse API) and are required to degrade gracefully — not optional — if Bedrock is ever unavailable.
- All three routes are rate-limited (10 req/s, burst 20) at the API Gateway level. CORS is scoped to the live Amplify origin, not `*`.

## The fallback path is a feature, not a bug

Every AI-dependent Lambda call is wrapped in a timeout and a `try`/`catch`. On any failure — timeout, access denied, malformed response — the system falls back to a deterministic, honest response instead of crashing:

- **`parseIncome`** failing → a clear "couldn't parse automatically" message; the user drops to the manual form.
- **`explain`** failing → the *raw reference snippet* it already found, unphrased — provably identical to a plain lookup with zero LLM involvement, since that's literally what it is.
- The frontend shows this **visibly** (a small badge, an offline-estimate banner) rather than hiding it. You can watch the AI layer fail live and see the product keep working.

## Tech stack

| Layer | Technology |
|---|---|
| Infra | AWS SAM — 100% infrastructure as code, zero console-clicked resources |
| Compute | AWS Lambda, Node.js 22.x |
| API | Amazon API Gateway (HTTP API) |
| Data | Amazon DynamoDB (`TaxExplainers` — keyword-matched reference table) |
| AI | Amazon Bedrock, Nova Lite, via a cross-region inference profile and the Converse API |
| Frontend | Self-contained HTML/CSS/JS on AWS Amplify — no framework, no build step |

## IAM, scoped deliberately

Every Lambda's execution role is scoped to exactly what that function needs, nothing more:

- **`calculate`** — no policies attached at all. It needs nothing beyond the default CloudWatch logging SAM grants. The *absence* of a `Policies:` block is the least-privilege choice here, not a gap.
- **`explain`** — `DynamoDBReadPolicy` (read-only, one table) + `bedrock:InvokeModel` scoped to one specific model resource. No write access to anything.
- **`parseIncome`** — `bedrock:InvokeModel` only, scoped to the same one model. No DynamoDB access, since it never touches the table.

## Project structure

```
calculator/          core tax logic — pure functions, zero AWS dependencies, unit tested standalone
lambda/               calculate Lambda (wraps calculator/ directly)
lambda-explain/       explain Lambda — DynamoDB lookup + Bedrock phrasing, with fallback
lambda-parse-income/  parseIncome Lambda — free text → structured fields, with fallback
public/               frontend (index.html) — deployed to AWS Amplify
docs/                 PRD, system design doc, frontend design notes, test plan
template.yaml         SAM template — the entire backend, as code
```

## Testing

**79 automated checks**, run standalone with `node`, no framework — real numbers, not a CI badge:

| File | Checks | Covers |
|---|---|---|
| `calculator/test_calculator.js` | 41 | Both regimes, marginal-relief golden cases, all optimizer signals, historical comparison, effective/marginal rates, boundary cases |
| `lambda-explain/test_explain.js` | 17 | Keyword matching, Bedrock success/failure/timeout paths, fallback badge visibility |
| `lambda-parse-income/test_parse_income.js` | 21 | Prompt construction, model-output validation, Bedrock success/failure/timeout paths |

The Bedrock-dependent handlers take the model call as an injectable dependency specifically so the fallback logic can be tested for real with a mocked client — not just asserted to exist.

```bash
cd calculator && node test_calculator.js
cd lambda-explain && node test_explain.js
cd lambda-parse-income && node test_parse_income.js
```

## Honest shortcuts vs. what production would look like

| Shortcut taken (and why) | Production equivalent |
|---|---|
| `calculator.js` is duplicated between `calculator/` and `lambda/` — SAM can't bundle across sibling folders without extra tooling | A shared npm package or Lambda Layer — one source of truth |
| `explain`'s retrieval is keyword matching against a small fixed table, not real vector search | Embeddings + a vector DB (e.g. OpenSearch) for open-ended coverage |
| No login, no stored user data | Same either way — this one's a deliberate feature, not a corner cut |
| 80D capped at a flat ₹25,000, not the real age-tiered limits | Model the real tiered limits, which needs an age input this calculator doesn't collect |
| HRA / home loan interest / NPS combined into one "Other Old Regime deductions" field | Model each with its own real eligibility rules |
| An earlier "crossover" optimizer signal (how much 80C would flip your recommended regime) was built, tested, then **removed** after evidence showed it was structurally unreachable for realistic incomes | N/A — this was correcting course on evidence, not a shortcut |

## Known simplifications (stated, not hidden)

- **80D** is capped at a flat ₹25,000. Real law allows more for senior citizens and senior-citizen parents (up to ₹1L combined) — not modeled, since this calculator doesn't ask for age.
- **HRA, home loan interest, and NPS 80CCD(1B)** are combined into one "Other Old Regime deductions" field, not modeled individually — each has its own eligibility rules (HRA especially depends on rent, salary structure, and city).
- **Surcharge** only implements the first bracket (>₹50L); results above ₹1Cr should be treated as approximate.
- **Freelancer income** is treated as gross; the real tax base is net profit (or the presumptive 50% under Section 44ADA).
- The **Income-tax Act 2025** renumbers sections (87A → 156/157 depending on source); figures here reflect FY 2026-27 rates as verified at time of writing — always confirm the current section number before citing it elsewhere.

## Local setup

```bash
# Backend
sam build
sam deploy --parameter-overrides \
  BedrockModelId="apac.amazon.nova-lite-v1:0" \
  BedrockUnderlyingModelId="amazon.nova-lite-v1:0"

# Seed the DynamoDB reference table (one-time — see README-seed.md)

# Calculator tests (no AWS needed)
cd calculator && node test_calculator.js

# Frontend
# Open public/index.html directly, or deploy the public/ folder to Amplify
```

## AI tools used

Built with assistance from Claude (Anthropic), as permitted by the hackathon rules — across architecture, infrastructure-as-code, testing, and frontend design.

## Status

| | |
|---|---|
| **Live site** | https://main.d20j0nwiyvjjou.amplifyapp.com/ |
| **Backend** | Deployed, live-tested, all three routes verified against real requests |
| **Frontend** | Deployed to Amplify from `public/` |
| **Tests** | 79/79 passing across calculator, explain, and parseIncome |
| **Demo video** | *(add link here before submission)* |

</div>
