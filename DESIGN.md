---
name: Golf Trip Live Scorecard
description: Heritage golf-club scorecard, rendered for a phone on the cart path
colors:
  forest-bg: "hsl(158 60% 11%)"
  forest-deep: "hsl(158 65% 9%)"
  forest-accent: "hsl(158 35% 20%)"
  cream-card: "hsl(42 45% 91%)"
  cream-fg: "hsl(42 45% 88%)"
  cream-border: "hsl(38 25% 78%)"
  paper-band: "hsl(42 35% 86%)"
  brass: "hsl(42 52% 59%)"
  brass-deep: "hsl(42 60% 48%)"
  brass-muted: "hsl(42 35% 65%)"
  brass-faint: "hsl(42 25% 60%)"
  brass-ink: "hsl(42 60% 32%)"
  ink: "hsl(38 30% 14%)"
  ink-soft: "hsl(38 20% 38%)"
  score-eagle: "hsl(42 60% 55%)"
  score-birdie: "hsl(148 45% 40%)"
  score-par: "hsl(42 20% 84%)"
  score-bogey: "hsl(30 40% 75%)"
  score-double: "hsl(0 45% 45%)"
  score-triple: "hsl(0 50% 38%)"
  score-quad: "hsl(0 55% 32%)"
  score-empty: "hsl(42 25% 78%)"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(2.6rem, 11vw, 4.25rem)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "normal"
  headline:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(1.85rem, 7vw, 2.5rem)"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "normal"
  title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "normal"
  card-title:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.04em"
  eyebrow:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.32em"
  stamp:
    fontFamily: "Manrope, system-ui, sans-serif"
    fontSize: "9px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.22em"
rounded:
  sm: "8px"
  md: "10px"
  lg: "12px"
  xl: "16px"
  hero: "14px"
  full: "9999px"
spacing:
  card-tight: "12px"
  card: "20px"
  row-gap: "16px"
  section-app: "40px"
  section-brand: "72px"
components:
  button-primary:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "14px 28px"
  button-primary-hover:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    padding: "14px 28px"
  button-default:
    backgroundColor: "{colors.brass}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    height: "36px"
  scorecard-card:
    backgroundColor: "{colors.cream-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "20px"
  eyebrow:
    textColor: "{colors.brass}"
    typography: "{typography.eyebrow}"
  score-cell-birdie:
    backgroundColor: "{colors.score-birdie}"
    textColor: "{colors.cream-card}"
    typography: "{typography.label}"
    width: "44px"
    height: "44px"
---

# Design System: Golf Trip Live Scorecard

## 1. Overview

**Creative North Star: "The Steward's Scorecard"**

The whole system points at one object: a cream paper scorecard a club steward hands you across the counter, brass clip still warm, dashed dividers printed crisp, every number set in tabular figures. Not a 1920s parody, not country-club costume. A working instrument that happens to be beautiful. Every screen is a version of that card resting on forest-green felt, lit by warm interior light, legible in cart-path sunlight and calm at a dim bar table.

The structural law underneath the metaphor is **dark shell, light surface**: a forest-green app frame holds cream "card" surfaces where the actual scoring happens. The shell carries the brand; the cards carry the work. Brass is the seam between them, the stamp and the clip, used at roughly 10% and never decoratively. Color strategy is **Committed**, not Restrained: forest and cream each carry 30 to 60% of any given screen, and the identity lives in that contrast, not in a lone accent.

This system explicitly rejects the PGA-Tour-broadcast aesthetic above all else: no chrome bevels, no 3D leaderboards, no hyper-real shadows, no sponsor-tower lockups, no gradient-fill team colors. It is flatter, quieter, more printed-paper than rendered-pixel. It also rejects the generic SaaS dashboard (sterile blue/white, hero-metric template, identical icon-card grids), casino and sportsbook loudness around the money surfaces, and the bright-green 18Birdies health-app palette with its confetti and dopamine. We track bets the group already agreed on; we do not promote action.

**Key Characteristics:**
- Two-surface architecture: forest shell, cream cards, brass seam.
- Printed-paper voice: dashed dividers, dotted-leader rows, UPPERCASE letter-spaced chrome, tabular numerals everywhere a number lives.
- Mobile-first, single-thumb, sun-legible. The shell caps at `max-w-lg` (512px) on every viewport.
- Live without alarming: silent refresh, a single pulsing brass-green dot, positions that slide rather than flash.
- Heritage as material, not theme: it should feel handed to you, not rendered for you.

## 2. Colors

A committed two-pole palette: deep forest green and warm cream, seamed with brass. Everything is tinted toward those three hues. There are no true grays and no pure black or white anywhere in the system. All tokens are defined once in [index.css](artifacts/golf-scorecard/src/index.css) as HSL components and consumed through Tailwind 4's `@theme inline` block; the HSL there is canonical, this document mirrors it.

### Primary
- **Brass** (`hsl(42 52% 59%)`): The single accent. Primary CTAs, eyebrows, leader markers, eagle scores, the live-dot, ornament glyphs. This is the stamp on the card. On forest it sings; on cream it must step down (see Brass Ink).
- **Brass Deep** (`hsl(42 60% 48%)`): CTA inset highlight, ornament hairline gradients, focus rings, small trophy and flag glyphs on cream.
- **Brass Ink** (`hsl(42 60% 32%)`): The cream-safe brass. Eyebrows and labels printed on cream surfaces use this, not the bright Brass, because it clears WCAG AA on cream where `hsl(42 52% 59%)` does not. Forest-context brass and cream-context brass are two different jobs.
- **Brass Muted** (`hsl(42 35% 65%)`) / **Brass Faint** (`hsl(42 25% 60%)`): Secondary and tertiary text on forest, ornament hairlines. Never primary signal.

### Neutral
- **Forest BG** (`hsl(158 60% 11%)`): The app shell, headers, dark sections. The frame the cards sit in.
- **Forest Deep** (`hsl(158 65% 9%)`): Footer, sidebar, lowest-elevation forest.
- **Forest Accent** (`hsl(158 35% 20%)`): Inline accent wells inside the forest shell: empty-state icon wells, inactive tabs.
- **Cream Card** (`hsl(42 45% 91%)`): The primary scorecard surface. Every working card.
- **Cream FG** (`hsl(42 45% 88%)`): Body text on forest.
- **Paper Band** (`hsl(42 35% 86%)`): The slightly deeper cream band behind scorecard column headers, the printed header strip on the card.
- **Cream Border** (`hsl(38 25% 78%)`): Card borders, dashed and dotted dividers.
- **Ink** (`hsl(38 30% 14%)`): Body text on cream.
- **Ink Soft** (`hsl(38 20% 38%)`): Secondary text on cream, hole and par labels.

### Tertiary (golf semantics, never repurposed)
These are score colors, not status colors. Do not borrow Double red for a generic error, or Birdie green for a success toast.
- **Eagle** (`hsl(42 60% 55%)`): 2-under or better. Bright brass.
- **Birdie** (`hsl(148 45% 40%)`): 1-under. The only true green in the system. Also drives the live-dot pulse.
- **Par** (`hsl(42 20% 84%)`): Even. Cream-neutral.
- **Bogey** (`hsl(30 40% 75%)`): 1-over. Peach.
- **Double** (`hsl(0 45% 45%)`): 2-over or worse. Deep red.
- **Triple** (`hsl(0 50% 38%)`) / **Quad** (`hsl(0 55% 32%)`): Worse-than-double tiers, used only by the profile career card. No live-scorecard equivalent.
- **Empty** (`hsl(42 25% 78%)`): Not yet entered. A muted cream tint that sits quietly in the grid until a number lands.

### Chart palette
`chart-1` through `chart-5` are brass, green, terracotta, slate-blue, deep red (`hsl(42 52% 59%)`, `hsl(148 35% 45%)`, `hsl(25 60% 55%)`, `hsl(200 40% 50%)`, `hsl(0 45% 45%)`). Round-over-round trend visualizations only. Never substitute Tailwind's default palette.

### Named Rules
**The Two-Surface Rule.** Forest shell, cream card, always. Never invert it (light shell with dark cards). Never collapse it (cream-on-cream, forest-on-forest). A card on top of a card is forbidden. This single contrast is the brand.

**The Two-Brass Rule.** Bright Brass (`hsl(42 52% 59%)`) is forest-context only. On cream, brass steps to Brass Ink (`hsl(42 60% 32%)`) so labels stay AA-legible. Bright brass text on a cream card is a contrast bug, not a style choice.

**The Reserved-Brass Rule.** One brass moment per screen region. Brass is the stamp; brass-on-brass-on-brass dilutes it. If brass is showing up only to add color, remove it.

**The No-Gray Rule.** Gray on color is banned. Use cream-on-forest, ink-on-cream, brass-muted-on-forest. Never `text-gray-500` on a forest panel.

## 3. Typography

**Display Font:** Fraunces (Georgia, serif fallback)
**Body Font:** Manrope (system-ui, sans-serif fallback)
**Mono Font:** Menlo (system mono), rare, reserved for code-shaped data.

**Character:** Fraunces brings the editorial, optically-cut serif of a printed yardage book, set with real weight contrast and italic flourishes. Manrope handles every working surface: dense table cells, button labels, the UPPERCASE letter-spaced chrome that gives the printed-scorecard voice. The pairing reads as "club steward," not "1920s pastiche": authoritative, dry, never decorative.

### Hierarchy
- **Display** (Fraunces 600, `clamp(2.6rem, 11vw, 4.25rem)`, line-height 1): Landing hero h1 only.
- **Headline** (Fraunces 500, `clamp(1.85rem, 7vw, 2.5rem)`): Section h2 on brand surfaces.
- **Title** (Fraunces 500–600, `1.875rem` / text-3xl): In-app page titles (My Trips, Trip Hub).
- **Card Title** (Fraunces 600, `17px`): Feature and card headings.
- **Body** (Manrope 400, `13–15px`, line-height ~1.55): Body copy and descriptions. Capped at 65–75ch; most cards run tighter at mobile widths.
- **Label** (Manrope 500–600, `14px` / text-sm, letter-spacing 0.04em): Buttons, tabs, UI labels.
- **Eyebrow** (Manrope 700, `10px`, letter-spacing 0.32em, UPPERCASE, brass): Section-introducing micro-labels.
- **Stamp** (Manrope 700, `8–9px`, letter-spacing 0.18–0.28em, UPPERCASE): Scorecard chrome, OUT / HOLE / PAR / THRU.
- **Tabular** (`tabular-nums`, always): Every score, total, and handicap. Non-negotiable.

### Named Rules
**The Serif-Heading Rule.** All h1/h2/h3 are Fraunces, enforced globally in the base layer (`h1, h2, h3 { font-family: var(--app-font-serif) }`). Never override a heading to sans.

**The Chrome-Caps Rule.** The printed-scorecard voice is achieved with UPPERCASE Manrope at 8–10px and letter-spacing 0.18–0.32em. This is a system pattern, not a one-off. When a label wants to feel stamped onto the card, this is how.

**The Italic-Brass Rule.** Serif italic in brass on forest, at section-headline scale only ("for your golf trip", "Then go play."). This is the one emotional flourish. Never apply it to UI labels or body copy.

**The No-Gradient-Text Rule.** `background-clip: text` over a gradient is forbidden. Brass on forest is already the most expressive treatment available; emphasis comes from weight, size, and italic, never from a gradient fill.

## 4. Elevation

This is a printed-paper system: it prefers borders to shadows. Depth comes first from the two-surface contrast (cream lifting off forest) and from dashed and dotted dividers, not from drop shadows. A four-step shadow scale exists for the rare cases that need it, but the default posture is flat.

### Shadow Vocabulary
- **Subtle** (`box-shadow: 0 1px 3px rgba(0,0,0,0.3)`): Resting lift on a forest-context element if it genuinely needs separation.
- **Default** (`box-shadow: 0 2px 6px rgba(0,0,0,0.3)`): Standard small card lift.
- **Medium** (`box-shadow: 0 4px 12px rgba(0,0,0,0.35)`): Popovers, raised menus.
- **Large** (`box-shadow: 0 8px 24px rgba(0,0,0,0.4)`): Dialogs, the sign-in modal.

State elevation on interactive surfaces is handled by the `hover-elevate` / `active-elevate` utilities in index.css, which tint a `::after` overlay (`--elevate-1: rgba(0,0,0,.03)`, `--elevate-2: rgba(0,0,0,.08)`) rather than animating a shadow.

### Named Rules
**The Borders-Over-Shadows Rule.** Reach for a dashed cream border or the paper-band header strip before reaching for a shadow. Printed paper has edges, not glows. Only the brass CTA's expressive drop is allowed; everything else stays flat.

**The Flat-Card Rule.** Cards sit flat on the forest at rest. The cream-on-forest contrast is the elevation. Stacking shadows on every card reads as web-app, not scorecard.

## 5. Components

### Buttons
- **Shape:** Pills for the primary action (`rounded-full`); 10px radius (`rounded-md`) for shadcn-default buttons.
- **Primary (brass pill):** Background Brass, text Ink, `padding: 14px 28px` (px-7 py-3.5), Manrope 600 text-sm, letter-spacing 0.04em. Layered shadow: `0 1px 0 brass-deep inset, 0 14px 30px -12px hsla(42,60%,50%,0.55), 0 2px 0 hsla(0,0%,0%,0.18)`. The system's primary action, one per screen, identical on landing and in-app empty states.
- **Hover / Active:** Hover lifts `-translate-y-0.5` with no color change; active returns to `translate-y-0`. Transform only, never a color flash.
- **Default (shadcn):** `bg-primary` (brass), `text-primary-foreground` (ink), `border border-primary-border`, `min-h-9 px-4 py-2`. In-app secondary actions; style overrides consume tokens, never new colors.

### Cards / Containers
- **Corner Style:** `rounded-2xl` (16px) for standard cards; the bespoke `rounded-[14px]` for the hero scorecard.
- **Background:** Cream Card (`hsl(42 45% 91%)`) on the forest shell.
- **Shadow Strategy:** Flat by default (see Elevation). Cream-on-forest contrast is the lift.
- **Border:** Cream Border (`hsl(38 25% 78%)`), often dashed or as a dotted-leader divider inside the card.
- **Internal Padding:** `px-4 py-3` (tight) to `px-5 py-5` (standard); the 18-hole grid runs denser (`py-2`, `mx-px`).

### Inputs / Fields
- **Style:** Cream-tinted background, `hsl(38 25% 72%)` input stroke, base radius. Form inputs use ≥16px font on phone widths (enforced in index.css) to prevent iOS auto-zoom; never override this.
- **Focus:** Brass ring (`--ring: hsl(42 60% 60%)`), `focus-visible:ring-1`.
- **Two-column forms** (course info): `grid-cols-2 gap-3` on phone; never more columns on mobile.

### Navigation
- **Style:** Forest shell, sticky to top. Cream-FG and brass-muted labels; the active tab carries a brass marker, inactive tabs sit on Forest Accent. No hover-only affordances: every hover has a touch equivalent.

### Eyebrow
Manrope 600/700, 10px, letter-spacing 0.32em, UPPERCASE, brass (Brass Ink on cream). The section-introducing micro-label above every h2 on brand surfaces; sparingly inside the app (page headers only).

### Live Indicator
A pulsing 1.5px brass-green dot: a static inner dot with a `ping 1.6s cubic-bezier(0,0,0.2,1)` overlay sibling at opacity 0.75. The pulse is the entire signal. Never accompany with text shouting "LIVE" except in the scorecard header, where the printed metaphor justifies it.

### Score Cells
Use the `.score-eagle / .score-birdie / .score-par / .score-bogey / .score-double / .score-empty` classes from index.css. The 44×44pt cells compose into the 18-hole grid (`60px repeat(9, minmax(0,1fr)) 44px`). Never invent new score-color treatments. Every score color is paired with a number, so color is never the only signal.

### Signature: The Scorecard Card
The canonical pattern, documented in `landing.tsx::HeroScorecard`: cream surface, dashed-divider header, hole-number row, par row, player rows, paper-band column headers, a footer with the leader, and a brass corner stamp ("THRU 7"). When building any new score-shaped display, start from this structure, not from a fresh card.

### Ornament
A decorative trio: brass hairline (gradient to Brass Faint), a `✦` glyph, brass hairline. A landing and brand divider only. Do not use inside the app.

## 6. Do's and Don'ts

### Do:
- **Do** keep the forest shell / cream card / brass seam split on every screen. It is the brand.
- **Do** use tabular numerals on every score, total, and handicap, and align the 18-hole grid to `60px repeat(9, minmax(0,1fr)) 44px`.
- **Do** step brass down to Brass Ink (`hsl(42 60% 32%)`) for any label or eyebrow printed on cream, and verify AA before shipping.
- **Do** pair every score color with a number (and a glyph where space allows) so color is never the only signal.
- **Do** prefer dashed cream borders and the paper-band header strip over drop shadows.
- **Do** let leaderboards refresh silently, signalled only by the single pulsing brass-green dot. Positions slide; they do not flash.
- **Do** keep primary actions in the thumb-reachable bottom two-thirds, touch targets ≥44×44pt, body inputs ≥16px on phone.
- **Do** respect `prefers-reduced-motion`: the `society-rise` entry (720ms, cubic-bezier(0.22,1,0.36,1)) skips to its end state and the live dot reduces to static.
- **Do** address the group, not the user ("Your group", "the trip", "everyone"). Title Case for page titles and CTAs, sentence case for body and helper text.

### Don't:
- **Don't** build Tour-broadcast chrome: no 3D leaderboards, beveled position numbers, sponsor-tower lockups, or gradient-fill team colors. This is the primary anti-reference.
- **Don't** ship the hero-metric template (big number plus small label plus supporting stats plus gradient accent), forbidden even on the landing.
- **Don't** use identical icon-title-text card grids. Vary rhythm deliberately, as the four-feature row does with italic roman numerals.
- **Don't** reach for casino or sportsbook loudness on the Skins/Nassau/money surfaces: no felt-green textures, neon, or bookie-odds typography. We track agreed bets, we do not promote action.
- **Don't** use the bright-green health-app palette. The only true green is Birdie (`hsl(148 45% 40%)`), reserved for score cells and the live dot. Never a CTA, never a section background.
- **Don't** use a side-stripe colored border (`border-left` or `border-right` greater than 1px as an accent). It is banned and clashes with the cream-paper metaphor.
- **Don't** use gradient text, decorative glassmorphism, em dashes, exclamation points, or emoji.
- **Don't** invert or collapse the two-surface rule, nest a card inside a card, or stack shadows on every card.
- **Don't** add confetti, fireworks, or balloon celebrations on score entry or position changes. Live without alarming.
- **Don't** ship generic shadcn neutral grays. Replace them with the tinted-neutral tokens before merging.
