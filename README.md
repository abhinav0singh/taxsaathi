# TaxSaathi

A plain-language Indian income tax calculator and guidance tool for first-time
earners (students, freelancers, interns) who've never filed taxes before.

Built for the WeMakeDevs **First Commit** hackathon (Bharat Builds Tour),
Ship It track — September 17–20, 2026.

## What it does

- **Tax calculator**: compares Old vs New tax regime for FY 2026-27, given a
  user's income and deductions. Deterministic — no AI involved in the math.
- **AI guidance layer** (in progress): lets users describe their income in
  free text, and get plain-language explanations of their result, powered by
  AWS Bedrock.

## Architecture

API Gateway → Lambda → DynamoDB / Bedrock, frontend hosted on AWS Amplify.

## Project structure

- `calculator/` — core tax logic (pure functions, no AWS dependencies, unit tested)
- `lambda/` — API layer wrapping the calculator for deployment
- `frontend/` — user-facing web app

## Status

🚧 Under active development during the hackathon (Sept 17–20, 2026).

## AI tools used

Built with assistance from Claude (Anthropic), as permitted by the hackathon rules.
