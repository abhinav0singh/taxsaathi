# TaxSaathi — Frontend Design Document

**Status:** Design direction locked, not yet built. This is Stage 6 —
don't start building this until backend stages (Lambda/API Gateway,
DynamoDB, Bedrock) are working, per docs/PRD.md priority order. Captured
now so the idea isn't lost between stages.

**Why this is worth real design effort, not just functional UI:** "Best
UI" is a named ₹1,00,000 prize category in this hackathon, open to either
track, judged on "design and usability" specifically — not just working
functionality. This doc exists to make sure that budget is spent well,
not just spent.

## 1. The core idea

Reference: Hubtown Limited's homepage (hubtown.co.in) — dark midnight
background, glowing blue/teal 3D form, minimal cinematic text reveal.

**Directly reused for TaxSaathi's differentiator, not just aesthetic
borrowing:** the visual metaphor of a 3D "terrain" is repurposed to
literally show tax slabs as terraces, with the user's income as a glowing
marker moving across them. The New Regime rebate cliff-edge —
`checkRebateCliffProximity` in `calculator.js` — becomes an actual visible
drop-off in the terrain, lit in amber. This isn't decoration: it's the
same insight the backend computes, made spatial. A judge should be able
to *see* why the cliff-edge matters within seconds, without reading text.

## 2. The critical split: cinematic hero vs. simple functional flow

These are explicitly two different design modes, not one continuous
style, because they have different jobs:

| | Hero / landing moment | Functional flow (input → results) |
|---|---|---|
| **Job** | Make a strong first impression, explain the metaphor | Get the user a correct answer, fast, with zero friction |
| **Style** | Full cinematic treatment | Clean, flat, minimal — same palette, no 3D competing for attention |
| **Complexity budget** | Where the design effort goes | Should feel almost boring by comparison — that's correct, not a failure |

A first-time earner filing taxes for the first time is often anxious.
Once they're past the hero moment and into "enter your income," the UI
needs to get out of the way, not keep performing. Simplicity in the
functional flow is not a downgrade from the hero — it's the actual point
of the product (see docs/PRD.md's target user).

## 3. Palette (carried through both modes, for consistency)

- **Background:** dark midnight navy (`#0a0e1a` – `#0f1729` range)
- **Primary accent (slabs, markers, primary actions):** blue/teal glow
  (`#3b82f6` – `#14b8a6` range)
- **Warning / cliff-edge accent:** amber (`#f59e0b` – `#f97316` range) —
  reserved specifically for cliff-edge and risk moments, so it stays
  meaningful and doesn't get diluted by decorative use elsewhere
- **Text:** near-white on dark, high contrast, no low-contrast gray-on-gray
  (accessibility matters more than mood here — first-time filers are
  already working hard to understand the content)

## 4. Scoped-down Three.js concept (hero section only)

Hubtown's site has real estate marketing budget behind it — full
mountain/water landscape, ambient audio, scroll-linked camera movement.
TaxSaathi's version is deliberately scoped down to keep 80% of the visual
impact at a fraction of the build time:

**Keep:**
- A single dark 3D scene: tax slabs rendered as glowing horizontal
  terraces (stacked, not a full landscape)
- User's income as a glowing marker, positioned along the terraces based
  on their actual taxable income
- The rebate cliff-edge as one dramatically-lit amber drop-off — this is
  the one element worth real Three.js effort, since it's the product's
  actual differentiator made visible
- A short, confident headline in the Hubtown style (e.g. "See exactly
  where your tax stands" or similar — final copy TBD at build time)

**Cut (explicitly, not by accident — flag if asked why these are missing):**
- Ambient audio / sound toggle
- Full mountain/water backdrop
- Scroll-linked camera movement or multi-section scroll narrative
- Any animation that delays the user reaching the actual calculator

## 5. Functional flow (post-hero)

- Income input: simple form, plain-language labels (matching
  docs/PRD.md's target user — no unexplained jargon like "80C" without a
  tooltip/inline explanation)
- Results view: regime comparison shown clearly (numbers, not buried),
  with the three optimizer signals
  (`analyzeDeductionHeadroom`/`analyzeSlabBoundary`/
  `checkRebateCliffProximity`, via `analyzeOptimization`) surfaced as
  distinct, clearly-labeled cards — not buried under the raw tax number,
  since PRD.md v2.1 identifies these as the actual differentiator
- Cliff-edge warning, if applicable: reuses the amber accent from the
  hero, so the visual language stays consistent — this is the one place
  outside the hero where a small glow/terrain echo is worth keeping, since
  it reinforces the same insight rather than adding new decoration
- Free-text input + Q&A (Bedrock-powered, once that stage exists): simple
  chat-style interface, no unnecessary ornamentation
- Mobile-responsive: required — judges may view on phone (see
  docs/TEST_PLAN.md section 6)

## 6. Build approach (for whoever builds this stage)

- Hero: Three.js, self-contained, single scene, no external asset
  dependencies beyond what's needed for the terrain/lighting
- Functional flow: plain HTML/CSS (or the frontend framework already in
  use for the rest of the app) — deliberately NOT Three.js, to keep this
  section fast and simple to build/maintain, per section 2's split
- Both hosted together on AWS Amplify per docs/SSD.md
- Test per docs/TEST_PLAN.md section 6, plus: confirm the hero doesn't
  block or meaningfully delay reaching the functional calculator — a
  judge with 3 minutes of video and limited patience needs to reach real
  functionality quickly
