# TaxSaathi — Frontend Design Document

**Status:** Design direction locked (v2 — replaces the earlier Hubtown/dark
"tax terrain" concept entirely, see revision note). Not yet built. This is
Stage 6 — don't start building until backend stages (Lambda/API Gateway,
DynamoDB, Bedrock) are working, per docs/PRD.md priority order.

**Why this is worth real design effort, not just functional UI:** "Best
UI" is a named ₹1,00,000 prize category in this hackathon, open to either
track, judged on "design and usability" specifically — not just working
functionality. This doc exists to make sure that budget is spent well.

**Revision note (v2):** The original direction (dark navy, glowing 3D
terrain, Hubtown-style cinematic hero) has been replaced entirely with a
blueprint/architectural drawing aesthetic — light background, precise
technical linework, warm wood-tone accents, a rendered structure emerging
out of a schematic. This isn't a hero-only treatment layered onto the old
plan; it's the visual language for the whole site, hero through results.

## 1. The core idea

Reference: an architectural drawing where a solid, warm-wood building is
rendered emerging out of its own blueprint — fine dimension lines,
measurement circles, annotation marks still visible around and behind the
finished structure, as though the drawing and the built thing exist in
the same frame at once.

**Mapped onto TaxSaathi's actual content, not just borrowed for mood:**
- The blueprint's dimension lines and measurement circles become the tax
  slab boundaries — precise, measured, labeled, exactly like a drawing's
  annotations.
- The solid wood structure emerging from the schematic becomes the user's
  own computed result taking shape: they enter numbers, and the "building"
  resolves from wireframe into something solid and specific to them.
- The dramatic swooping roofline in the reference — the single most
  visually bold line in the whole drawing — is the natural visual stand-in
  for the New Regime rebate cliff-edge
  (`checkRebateCliffProximity`). It's the one structural element that
  isn't calm and orthogonal like the rest of the drawing, same as the
  cliff-edge is the one number in the tax code that behaves violently
  compared to everything around it.
- `analyzeDeductionHeadroom` and `analyzeSlabBoundary` can read as
  secondary annotations on the drawing — smaller dimension call-outs
  pointing at specific measurements, the way an architectural drawing
  labels a beam span or a door width.

## 2. One visual language, tapering density (not two separate modes)

Unlike the earlier hero-vs-functional split, this direction stays visually
consistent throughout — same palette, same linework, same materials — but
the *density* of detail tapers as the user moves from landing to task:

| | Hero / landing | Calculator input | Results view |
|---|---|---|---|
| **Linework density** | Full — visible grid, dimension lines, measurement circles, annotation text, drawing feels "alive" | Reduced — a few structural guide-lines, not a full schematic behind every field | Medium — enough blueprint detail to frame the result as "your building," without competing with the numbers |
| **What's solid vs. wireframe** | Mostly wireframe, structure only partially resolved | Fully solid UI, minimal wireframe texture in the background only | Structure resolves further as the user's specific numbers appear — the metaphor pays off here |
| **Job** | Establish the metaphor, make a strong first impression | Get out of the way, be genuinely easy to fill in | Show the user's own result as if it just finished being "built" for them |

Simplicity in the calculator input step is still non-negotiable — see
docs/PRD.md's target user, someone anxious and unfamiliar with tax
vocabulary. The blueprint aesthetic must never come at the cost of that;
it tapers specifically so the busiest step of the flow is the calmest step
visually.

## 3. Palette

- **Background:** off-white / light warm gray (`#f5f3ef` – `#faf9f6`
  range) — NOT stark white, should feel like drafting paper, not a blank
  screen
- **Linework (blueprint lines, dimension marks, annotations):** dark
  charcoal/graphite (`#2b2b2b` – `#3a3a3a` range), thin weight, precise
- **Primary structural accent (the "building," primary actions, resolved
  results):** warm wood tones — amber/ochre/burnt-orange
  (`#b5651d` – `#d98e3f` range)
- **Cliff-edge / warning accent:** a hotter, more saturated version of the
  same wood-tone family (`#c2410c` – `#e0631a` range) — stays in the same
  material family as the rest of the structure rather than introducing an
  unrelated warning color (e.g. red), so the cliff-edge reads as "the same
  building, at its most dramatic point" rather than "an error state"
- **Text:** near-black on the warm light background, high contrast

## 4. Scoped build approach

Full architectural CAD-style rendering is out of scope for a weekend
build — the reference image likely involved a real 3D architectural model
plus heavy post-processing. Scope this down deliberately:

**Keep:**
- SVG-based line-art for the blueprint layer (dimension lines, measurement
  circles, annotation marks) — SVG is cheap to draw precisely, animate
  (lines "drawing themselves in"), and restyle, and doesn't need a 3D
  engine at all
- One hero illustration built the same way — a structural silhouette
  (doesn't need to literally be a building; could be an abstracted
  slab-terrace shape, styled in the same wood-tone linework) that resolves
  from wireframe to solid on load or scroll
- The cliff-edge as one bold, distinct line in that illustration, in the
  hotter accent tone from section 3
- Subtle grid/dimension-line texture carried faintly into card backgrounds
  on the calculator and results views, so the material language stays
  present without adding visual noise

**Cut (explicitly, not by accident):**
- Real 3D rendering / Three.js — this reference doesn't need it the way
  the earlier terrain concept did; SVG line-art achieves the same feeling
  at a fraction of the build cost
- Photographic textures or realistic wood-grain imagery
- Any animation that delays the user reaching the actual calculator

## 5. Functional flow (calculator input + results)

- Income input: simple form, plain-language labels (matching
  docs/PRD.md's target user — no unexplained jargon like "80C" without a
  tooltip/inline explanation), faint blueprint-grid texture in the
  background only, per section 2's tapered density
- Results view: regime comparison shown clearly, with the three optimizer
  signals (`analyzeDeductionHeadroom`/`analyzeSlabBoundary`/
  `checkRebateCliffProximity`, via `analyzeOptimization`) surfaced as
  distinct labeled cards, styled like annotation call-outs on a drawing —
  not buried under the raw tax number, since PRD.md v2.1 identifies these
  as the actual differentiator
- Cliff-edge warning, if applicable: uses the hotter wood-tone accent from
  section 3, ideally echoing the same dramatic-line motif from the hero
- Free-text input + Q&A (Bedrock-powered): simple chat-style interface,
  same palette, no unnecessary ornamentation
- Mobile-responsive: required — judges may view on phone (see
  docs/TEST_PLAN.md section 6)

## 6. Build approach (for whoever builds this stage)

- Blueprint/linework layer: hand-built or generated SVG, styled via CSS
  variables so the palette in section 3 is centralized and consistent
- Functional flow: plain HTML/CSS (or whatever frontend framework is
  already in use) with the SVG linework layered in as background/accent
  elements — never blocking or competing with real form inputs
- Both hosted together on AWS Amplify per docs/SSD.md
- Test per docs/TEST_PLAN.md section 6, plus: confirm the calculator step
  reads as calm and simple even with the blueprint texture present — if
  it doesn't, cut density further rather than add more restraint
  instructions; simplicity here is not negotiable