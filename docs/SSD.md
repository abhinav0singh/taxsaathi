# TaxSaathi — System Design Document (SSD)

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
    +--> calculator logic (in-process, no external call — pure JS)
    |
    +--> DynamoDB (curated tax explainer snippets — read-only lookup)
    |
    +--> Bedrock (LLM calls: free-text parsing, guided explanation)
```

## 2. Why each piece, and what it replaces

| Piece | Why this, not the alternative |
|---|---|
| **Lambda** (not a long-running server / EC2) | We only need code to run in response to a request, briefly. A server would sit idle (and cost money) between requests. Lambda only runs — and only costs — when called. Tradeoff: "cold starts" (first call after idle is slower) — acceptable for a demo. |
| **API Gateway** (in front of Lambda) | Lambda functions aren't directly reachable over HTTP by default. API Gateway is the piece that turns "an HTTP request from a browser" into "an invocation of a specific Lambda function," and handles routing, request validation, and CORS (letting our frontend's domain call this API from the browser). |
| **DynamoDB** (not a SQL database) | Our explainer data is small, simple key-value lookups ("what is 80C" -> explanation text) with no complex joins or relational structure. DynamoDB is serverless (no database server to manage), scales automatically, and fits this simple access pattern better than standing up and managing a relational DB for a hackathon. |
| **Bedrock** (not a hardcoded ruleset) | Two jobs need language understanding, not just rules: (1) parsing a user's free-text income description into structured fields — infinite ways to phrase "I freelance and made about 8 lakhs" — and (2) explaining tax concepts in context of the user's specific numbers, which benefits from natural phrasing rather than templated strings. A hardcoded parser would need to anticipate every phrasing; an LLM generalizes. |
| **Amplify Hosting** (not S3 static website alone) | Amplify gives us CI/CD from a git repo (push to deploy), HTTPS, and a working URL with minimal manual config — faster to a working demo than manually configuring an S3 bucket + CloudFront for a static site. |

## 3. Lambda function breakdown

- `calculate` — wraps `calculator.js` directly. Input: income + deductions.
  Output: full comparison object. No external calls — fast, deterministic.
- `parseIncome` — takes free text, calls Bedrock, returns structured fields
  (income amount, salaried vs freelance, existing deductions if mentioned).
- `explain` — takes a user question + their calculated result, looks up
  relevant snippet(s) from DynamoDB, calls Bedrock to phrase an answer
  grounded in both the snippet and the user's numbers.

## 4. Data model (DynamoDB)

Single table, `TaxExplainers`:

| Attribute | Type | Notes |
|---|---|---|
| `topic` (partition key) | String | e.g. `"80C"`, `"87A_rebate"`, `"new_vs_old_regime"` |
| `explanation` | String | Plain-language explainer text, written by us ahead of time |
| `keywords` | String list | Alternate phrasings, to help retrieval-lite matching |

Retrieval-lite means: we do simple keyword matching against `keywords`, not
vector embeddings / full RAG. Deliberate scope cut for hackathon time — a
production version would use embeddings for more robust matching.

## 5. Request flow example (end to end)

1. User types "I'm a freelancer, made about 9 lakhs this year, no investments" into frontend.
2. Frontend POSTs the text to API Gateway → `parseIncome` Lambda.
3. `parseIncome` calls Bedrock, gets back `{income: 900000, salaried: false, deductions80c: 0}`.
4. Frontend POSTs that structured data to API Gateway → `calculate` Lambda.
5. `calculate` runs `compareRegimes()` (pure JS, no external calls), returns the comparison.
6. Frontend displays the result. User asks "why is the new regime better for me?"
7. Frontend POSTs the question + result to API Gateway → `explain` Lambda.
8. `explain` looks up relevant DynamoDB snippet(s), calls Bedrock with the snippet + user's numbers as context, returns a grounded plain-language answer.

## 6. What's a hackathon shortcut vs. "doing it properly"

| Shortcut here | Production version |
|---|---|
| IAM user with AdministratorAccess | Scoped least-privilege roles per Lambda |
| No auth/login | Cognito user pools, per-user history |
| Retrieval-lite keyword match | Real vector search (e.g. OpenSearch, embeddings) |
| Single DynamoDB table, hand-written data | Larger curated/maintained dataset, versioned |
| No automated CI tests on deploy | CI pipeline running the test suite pre-deploy |
| Surcharge only handles first tier | Full surcharge tier logic + marginal relief |
