# TaxSaathi

**Most tax calculators show you a number. This one shows you the cliff.**

Under India's New Tax Regime, taxable income up to ₹12,00,000 pays **zero** tax. Cross that line by even ₹1, and the rebate disappears entirely — you owe tax on the full amount, not just the excess. It's not a gradual slope. It's a cliff. Almost nobody building a tax calculator shows you where it is. TaxSaathi does.

Built for the WeMakeDevs **First Commit** hackathon (Bharat Builds Tour), Ship It track — September 17–20, 2026.

---

## What it actually does

- **Old vs New regime comparison** — deterministic, zero AI involved in the math. FY 2026-27 slabs, surcharge, and cess, computed exactly.
- **Three optimizer signals**, surfaced as first-class results, not buried under the tax number:
  - **Rebate cliff-edge proximity** — are you dangerously close to the ₹12L wall, on either side?
  - **80C deduction headroom** — if the Old Regime is your better option, exactly how much more headroom you have and what it's worth.
  - **Next slab boundary** — how much more income before your marginal rate jumps, and by how much.
- **"Then vs. now" historical comparison** — the same income, run through FY2024-25's rules (₹7L rebate threshold) against today's (₹12L). For a ₹9L salaried earner, that's the difference between owing ₹33,800 and owing ₹0 — the same person, the same income, two years apart. A real, verifiable consequence of a real reform, not a marketing number.
- **Effective vs. marginal rate** — most first-time filers conflate the two. A ₹15L freelancer's marginal rate is 15%; their actual effective rate is 7.28%. Shown side by side.
- **Free-text income parsing** — describe your income in plain English ("I earn 12 lakhs freelancing"), and it fills in the structured form for you.
- **Grounded Q&A** — ask about 80C, 80D, the rebate, or regime choice, answered from a curated reference table, not open-ended generation.

## Why the cliff-edge is the actual differentiator

The backend doesn't just compute a number — `checkRebateCliffProximity`, `analyzeDeductionHeadroom`, and `analyzeSlabBoundary` all run on every calculation and are returned as structured, labeled data, specifically so the frontend can't bury them under the headline tax figure. The hero itself renders this: the New Regime's slabs as an ascending profile, with the rebate cliff drawn as the one dramatic, non-orthogonal line in an otherwise calm, architectural drawing — because that's exactly what it is in the tax code too.

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

API Gateway (HTTP API) in front of three Lambda functions, all deployed via AWS SAM. `calculate` is pure computation — no external calls, no AI. `explain` and `parseIncome` call Amazon Bedrock (Nova Lite, via a cross-region inference profile, using the Converse API) and are required to degrade gracefully — not optional, not an afterthought — if Bedrock is ever unavailable.

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

**81 automated checks**, run standalone with `node`, no framework — real numbers, not a CI badge:

| File | Checks | Covers |
|---|---|---|
| `calculator/test_calculator.js` | 43 | Both regimes, all three optimizer signals, the historical comparison, effective/marginal rates, boundary cases |
| `lambda-explain/test_explain.js` | 17 | Keyword matching, Bedrock success/failure/timeout paths, fallback badge visibility |
| `lambda-parse-income/test_parse_income.js` | 21 | Prompt construction, model-output validation, Bedrock success/failure/timeout paths |

The Bedrock-dependent handlers are built with the model call as an injectable dependency specifically so the fallback logic can be tested for real with a mocked client — not just asserted to exist.

## Honest shortcuts vs. what production would look like

| Shortcut taken (and why) | Production equivalent |
|---|---|
| `calculator.js` is duplicated between `calculator/` and `lambda/`, since SAM can't bundle across sibling folders without extra tooling | A shared npm package or a Lambda Layer — one source of truth |
| `explain`'s retrieval is keyword matching against a small fixed table, not real vector search | A proper embeddings + vector DB pipeline (OpenSearch, or similar) for open-ended coverage |
| No login, no stored user data (a deliberate PRD scope decision, not a corner cut) | Same either way — this one's a feature, not a shortcut |
| Section 80D has no enforced cap in the calculator, though real law caps it by age | Model the real age-tiered limits |
| An earlier "crossover" optimizer signal (how much more 80C would flip your recommended regime) was built, tested, then **removed** after a broad sweep found it was structurally unreachable for realistic incomes — replaced with the two within-regime signals that are always computable | N/A — this was correcting course on real evidence, not a shortcut |

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