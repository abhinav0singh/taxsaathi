# TaxSaathi — System Design Document (SSD)

**Revision note (v2):** Adds infra-as-code, scoped IAM roles, Bedrock
fallback behavior, and the regime-optimization function. See PRD.md v2 for
why. Sections marked **[NEW]** are additions; everything else is unchanged
from the original design.

## 1. Architecture overview

```
User Browser
    |
    v
Frontend (static site, AWS Amplify Hosting)
    |
    v  (HTTPS, JSON)
API Gateway  (public HTTP endpoint, routes requests to Lambda)
    |
    v
Lambda functions (Node.js) — one per responsibility, see below
    |
    +--> calculator + optimizer logic (in-process, no external call)
    |
    +--> DynamoDB (curated tax explainer snippets — read-only lookup)
    |
    +--> Bedrock (LLM calls: free-text parsing, guided explanation)
         with fallback behavior if the call fails or times out
```

Deployed via **AWS SAM (Serverless Application Model)** — infra defined in
a `template.yaml` file, not created by clicking through the console.
**[NEW]**

## 2. Why each piece, and what it replaces

| Piece | Why this, not the alternative |
|---|---|
| **Lambda** (not a long-running server / EC2) | Code runs only in response to a request, briefly. A server would sit idle (and cost money) between requests. Tradeoff: "cold starts" — acceptable for a demo. |
| **API Gateway** (in front of Lambda) | Lambda isn't directly reachable over HTTP by default. API Gateway turns an HTTP request into a Lambda invocation, and handles routing, validation, and CORS. |
| **DynamoDB** (not SQL) | Explainer data is small, simple key-value lookups with no joins. DynamoDB is serverless and fits this access pattern without managing a DB server. |
| **Bedrock** (not a hardcoded ruleset) | Free-text income parsing and contextual explanation both need language understanding a rule-based parser can't generalize to. |
| **Amplify Hosting** (not raw S3) | CI/CD from git, HTTPS, working URL with minimal config — faster to a working demo. |
| **AWS SAM** (not manual console setup) **[NEW]** | SAM is a thin layer over CloudFormation purpose-built for serverless apps (Lambda/API Gateway/DynamoDB). Writing infra as a `template.yaml` file means: (1) it's reproducible — `sam deploy` recreates everything from scratch, provable to a judge or future employer; (2) it's diffable in git — infra changes show up in commit history same as code; (3) it forces you to declare permissions explicitly per-resource, which is what makes least-privilege IAM practical instead of "just attach AdministratorAccess and move on." Manual console clicking was the original plan purely for speed — this revision trades a small amount of time for a large signal-quality improvement. |

## 3. IAM: least-privilege execution roles **[NEW]**

The IAM *user* you created (Stage 1, `AdministratorAccess`) is what *you*
log in as — broad access is a reasonable hackathon shortcut for a human
operator working solo under time pressure, and we're keeping that as-is.

What changes: each **Lambda's execution role** — the permissions the
*function itself* has when it runs — should be scoped to only what that
function actually touches:

- `calculate` Lambda: no AWS permissions needed beyond basic CloudWatch
  logging (it's pure computation, no DynamoDB/Bedrock calls).
- `explain` Lambda: DynamoDB read-only (`GetItem`/`Query` on the
  `TaxExplainers` table only) + Bedrock `InvokeModel` only. Not write
  access, not access to other tables, not admin.
- `parseIncome` Lambda: Bedrock `InvokeModel` only.

SAM makes this natural: each function's `template.yaml` entry declares its
own `Policies`, scoped to the specific resource ARN it needs — you're not
hand-writing IAM policy JSON from scratch.

## 4. Lambda function breakdown

- `calculate` — wraps `calculator.js` (now including the optimizer, see
  section 6). Input: income + deductions. Output: full comparison +
  optimization suggestion. No external calls — fast, deterministic.
- `parseIncome` — free text → Bedrock → structured fields (income amount,
  salaried vs freelance, existing deductions if mentioned).
- `explain` — user question + their calculated result → DynamoDB snippet
  lookup → Bedrock call to phrase a grounded answer using both the snippet
  and the user's numbers (including their optimization suggestion, so the
  explanation can be genuinely personalized, not generic).

## 5. Bedrock fallback behavior **[NEW]**

Both Bedrock-calling Lambdas (`parseIncome`, `explain`) must handle failure
visibly rather than crash the request:

- Wrap the Bedrock call in try/catch with a reasonable timeout.
- On failure: `parseIncome` returns a clear "couldn't parse that, please
  use the structured form instead" response (frontend falls back to manual
  input fields). `explain` returns the raw DynamoDB snippet text directly,
  unphrased by the LLM, rather than nothing.
- This fallback path gets tested explicitly (see TEST_PLAN.md) and is
  worth showing briefly in the demo video — it's a concrete signal of
  engineering maturity, not just a safety net.

## 6. Regime-optimization logic **[NEW]**

New pure function(s) in `calculator.js`, alongside the existing
`compareRegimes`. No AWS involved — same "pure function, unit tested
standalone" pattern as the rest of the calculator.

**Revision (v2.1):** The original design included a cross-regime "crossover
lever" — how much more 80C/80D investment would flip the recommendation
from Old to New Regime or vice versa. Verified against the actual slab
numbers and dropped: once income crosses the New Regime rebate threshold,
New Regime's slabs are structurally so much gentler than Old's that no
realistic 80C/80D amount (capped near ₹2L combined) ever closes the gap —
the lever would return "no lever" for nearly every real input, making it a
dead feature rather than a differentiator. Replaced with two levers that
are meaningful for realistic inputs in both regimes.

**What it computes**, given the user's current inputs:
- **`analyzeRebateCliffEdge`** — rebate cliff-edge proximity (kept, verified
  real): if the user is near the New Regime 87A rebate cliff-edge (₹12L /
  ₹12.75L threshold), flag it explicitly — crossing it by a small amount
  has an outsized effect (a ₹1 increase in income can add tens of
  thousands in tax; see the rebate cliff-edge note already in
  `calculator.js`).
- **`analyzeDeductionHeadroom`** — within-regime marginal savings (new):
  given whichever regime is currently recommended, compute how much tax
  would be saved by maxing remaining unused 80C/80D room. Caveat: its
  positive-savings branch (Old Regime recommended and headroom exists) is
  functionally unreachable through real income inputs run via
  `compareRegimes()`, per the v2.1 finding — Old is essentially never the
  actual recommended regime. That branch is still correct code and worth
  keeping (decoupled from `compareRegimes` by taking `recommendedRegime`
  as a direct parameter, so it's not dead code, just rarely-fired code),
  but it's tested by passing `recommendedRegime: "old"` directly rather
  than deriving it from a real calculation — know that going in so it's
  not mistaken for a test gap.
- **`analyzeSlabBoundary`** — distance to next slab boundary (new, optional
  if time-constrained): how much additional income would push the user
  into the next slab, so they can see the shape of their own marginal
  rate — useful context, not a "lever" the user directly pulls, but cheap
  to compute from data `computeSlabTax` already touches.
- Output remains structured data (numbers + a short reason code), NOT
  prose — prose phrasing happens in the `explain` Lambda via Bedrock,
  keeping deterministic math and language generation cleanly separated
  (Bedrock never does math, the calculator never does language).

This is the project's actual differentiator: a static calculator tells you
a number, this tells you a lever you could pull and what it's worth —
scoped now to levers that actually move for realistic inputs, not ones
that were only theoretically possible.

## 7. Data model (DynamoDB) — unchanged

Single table, `TaxExplainers`:

| Attribute | Type | Notes |
|---|---|---|
| `topic` (partition key) | String | e.g. `"80C"`, `"87A_rebate"`, `"new_vs_old_regime"` |
| `explanation` | String | Plain-language explainer text, written ahead of time |
| `keywords` | String list | Alternate phrasings, for retrieval-lite matching |

## 8. Request flow example (end to end)

1. User types free-text income description into frontend.
2. Frontend → API Gateway → `parseIncome` Lambda → Bedrock → structured fields.
   (If Bedrock fails: fallback to manual form, per section 5.)
3. Frontend → API Gateway → `calculate` Lambda → `compareRegimes()` +
   optimizer function → comparison + optimization suggestion.
4. Frontend displays result + suggestion. User asks a follow-up question.
5. Frontend → API Gateway → `explain` Lambda → DynamoDB snippet lookup →
   Bedrock (snippet + user's numbers + optimization suggestion as context)
   → grounded plain-language answer. (If Bedrock fails: raw snippet text
   returned instead, per section 5.)

## 9. Observability **[NEW]**

Lambda logs to CloudWatch automatically — no extra code needed. The only
action item is to actually **open CloudWatch Logs during the demo video**
(even a 5-second cut showing a real invocation log) — this is free signal
that costs a screenshot, not engineering time.

## 10. What's a hackathon shortcut vs. "doing it properly"

| Shortcut here | Production version |
|---|---|
| IAM **user** with AdministratorAccess (human operator only) | Scoped human access too, via permission sets / SSO |
| No auth/login | Cognito user pools, per-user history |
| Retrieval-lite keyword match | Real vector search (e.g. OpenSearch, embeddings) |
| Single DynamoDB table, hand-written data | Larger curated/maintained dataset, versioned |
| No automated CI tests on deploy | CI pipeline running the test suite pre-deploy, incl. `sam deploy` on merge |
| Surcharge only handles first tier | Full surcharge tier logic + marginal relief |
| Optimizer suggests one lever at a time | Multi-variable optimization across several deduction types at once |

Note: Lambda **execution roles** are now scoped per section 3 — that's no
longer in the "shortcut" column, it's treated as correct-by-default even
under time pressure, since SAM makes it roughly free to do right.