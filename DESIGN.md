# Design

## Visual Theme

**Heritage golf-club scorecard, rendered for a phone.** The fixed visual scene: a cream paper scorecard resting on a forest-green felt desk, lit by warm interior light, with brass detailing — a stamped tee marker, a clip, a club crest. The app is a working instrument: legible in sunlight on a cart path, calm in dim light at a bar table.

The theme is dark-shell, light-surface: a forest-green app frame holds cream "card" surfaces where the actual scoring happens. The shell carries the brand; the cards carry the work. This split is the single most important visual rule in the system — do not invert it (light shell with dark cards) or collapse it (cream-on-cream, forest-on-forest).

Color strategy: **Committed.** Forest green and cream each carry 30–60% of the surface depending on the screen; brass is the consistent accent (≈10%, never decorative). This is intentionally not Restrained — the brand identity comes from the cream/forest contrast, not from a single accent color.

Theme stance: a single bespoke theme (no light/dark toggle). The forest shell IS the dark mode; the cream cards IS the light mode. Both ship in every render.

## Color Palette

All tokens live in `artifacts/golf-scorecard/src/index.css` as HSL components consumed through Tailwind 4's `@theme inline` block. Values below mirror what's in `:root` — do not redefine them in components.

### Core hues (kept verbatim from the codebase)

| Role | HSL | Use |
|---|---|---|
| Forest BG | `158 60% 11%` | App shell background, headers, dark sections |
| Forest Deep | `158 65% 9%` | Footer, sidebar, lowest-elevation forest |
| Forest Accent | `158 35% 20%` | Inline accent surfaces inside the forest shell (empty-state icon wells, inactive tabs) |
| Cream Card | `42 45% 91%` | Primary "scorecard" surface — every working card |
| Cream FG | `42 45% 88%` | Body text on forest |
| Cream Border | `38 25% 78%` | Card borders, dotted/dashed dividers |
| Brass | `42 52% 59%` | Primary accent: CTAs, eyebrows, leader markers, score-eagle |
| Brass Deep | `42 60% 48%` | CTA inset highlight, ornament glyphs, focus rings |
| Brass Muted | `42 35% 65%` | Secondary text on forest |
| Brass Faint | `42 25% 60%` | Tertiary text, ornament hairlines |
| Ink | `38 30% 14%` | Body text on cream |
| Ink Soft | `38 20% 38%` | Secondary text on cream, hole/par labels |
| Birdie Green | `148 45% 40%` | Score-birdie cell, live-dot pulse |

### Semantic / score colors

These are golf semantics, not generic status colors. Do not repurpose.

| Token | HSL | Means |
|---|---|---|
| `.score-eagle` | `42 60% 55%` (brass-bright) | 2-under or better |
| `.score-birdie` | `148 45% 40%` (true green) | 1-under |
| `.score-par` | `42 20% 84%` (cream-neutral) | Even |
| `.score-bogey` | `30 40% 75%` (peach) | 1-over |
| `.score-double` | `0 45% 45%` (deep red) | 2-over or worse |
| `.score-empty` | `158 35% 20%` (forest accent) | Not yet entered |

### Chart palette

`--chart-1` through `--chart-5` are: brass, green, terracotta, slate-blue, deep red. Use only for round-over-round trend visualizations. Never substitute Tailwind's default palette.

### Color rules

- **Never `#000` or `#fff`.** Tint every neutral toward forest or cream — every existing token already does this.
- **Brass is reserved.** CTAs, brand ornaments, eagle scores, leader badges. If brass is showing up just to "add color", remove it.
- **Gray on color is banned.** Use cream-on-forest, ink-on-cream, brass-muted-on-forest. Never `text-gray-500` on a forest panel.
- **One accent per region.** A single brass moment per screen-section. Brass-on-brass-on-brass dilutes the stamp.

## Typography

### Fonts

- **Serif headings**: `Fraunces` (Google Fonts), weights 500–700, with italic. Used for h1–h3, leader names, large numerics in stamps, and editorial flourishes ("for your golf trip" in italic brass).
- **Sans body / UI**: `Manrope`, weights 400–800. Used for body copy, button labels, table cells, all small-print metadata.
- **Mono**: `Menlo` system fallback. Reserved for code-shaped data (rare in this product).
- Stack declared in `index.css` as `--app-font-sans`, `--app-font-serif`, `--app-font-mono` and consumed via `font-sans` / `font-serif` utilities.

### Type scale

Editorial-magazine scale, not flat. Body text caps at 65–75ch and most cards run tighter (mobile widths). Headings use clamp() with viewport scaling on landing and brand-shaped pages.

| Step | Size | Weight | Use |
|---|---|---|---|
| Display | `clamp(2.6rem, 11vw, 4.25rem)` Fraunces 600 | Hero h1 (landing only) |
| Section | `clamp(1.85rem, 7vw, 2.5rem)` Fraunces 500 | Section h2 |
| Page title | `text-3xl` (1.875rem) Fraunces 500–600 | In-app page h1 (My Trips, Trip Hub) |
| Card title | `text-[17px]` Fraunces 600 | Feature/card headings |
| Body | `text-[13–15px]` Manrope 400 | Body copy and descriptions |
| UI | `text-sm` Manrope 500–600 | Buttons, labels, tabs |
| Eyebrow | `text-[10px]` Manrope 700, `letter-spacing: 0.32em`, UPPERCASE, brass | Section eyebrows |
| Stamp label | `text-[8–9px]` Manrope 700, `letter-spacing: 0.18–0.28em`, UPPERCASE | Scorecard chrome ("OUT", "HOLE", "PAR", "THRU") |
| Tabular | `tabular-nums` on every score, total, handicap | Always |

### Typography rules

- **Headings are serif.** Globally enforced via `h1, h2, h3 { font-family: var(--app-font-serif); }` in the base layer. Do not override.
- **Scorecard chrome is monospaced-feel via letter-spacing.** UPPERCASE Manrope at 8–10px with `letter-spacing: 0.18–0.32em` is how the printed-scorecard voice is achieved. Treat this as a system pattern, not a one-off.
- **Italic brass for emotional emphasis.** The "for your golf trip" / "Then go play." pattern: serif italic in brass on a forest background, only at section-headline scale. Never apply to UI labels.
- **No gradient text.** Banned by the shared design laws and unnecessary here — brass on forest is already the most expressive treatment in the system.
- **No em dashes.** Banned by the shared design laws. Use commas, colons, or periods.

## Layout & Spacing

### Container & breakpoints

- The in-app shell caps at `max-w-lg` (32rem / 512px). This is deliberate: the product is mobile-first and the landing also constrains to phone width to preserve the scorecard metaphor on desktop. Do not widen without a strong reason.
- Tailwind default breakpoints (`sm`, `md`, `lg`, `xl`, `2xl`). Mobile (`< 640px`) is the design baseline; desktop adapts up, not down.
- Horizontal page padding: `px-6` on phone, `px-6` preserved on desktop within the `max-w-lg` shell.

### Spacing scale

Standard Tailwind 4 scale (`--spacing: 0.25rem`). Section rhythms in use:

- Inside a card: `px-4 py-3` to `px-5 py-5`. The 18-hole grid uses fractional padding (`py-2`, `mx-px`) for density.
- Between rows in a list: `space-y-3` (close) or `space-y-4` (breathing).
- Between sections on a page: `py-14` to `py-20` on brand surfaces; `py-6` to `py-10` on in-app pages.
- Hero block to next content: `mt-8` to `mt-12`.

Vary the spacing per rhythm — same padding everywhere is monotony. The landing already does this; preserve it.

### Grid patterns

- **18-hole scorecard grid**: `grid-template-columns: 60px repeat(9, minmax(0, 1fr)) 44px` (label / 9 holes / total). This is the system's most important grid; reuse it for any scorecard-shaped display.
- **Trip rows / leaderboard rows**: vertical stack of rounded cards with internal flex rows (avatar/name on left, score/chevron on right).
- **Two-column forms** (course info): `grid-cols-2 gap-3` on phone; never more columns on mobile.

### Surfaces & elevation

- **Forest shell + cream card** is the canonical two-surface pattern. Cards on top of cards are banned (per shared design laws).
- **`hover-elevate` / `active-elevate` utilities** in `index.css` apply a subtle background tint via `::after` on interactive surfaces. Use these instead of inventing new hover backgrounds.
- **Shadow scale** is defined as four steps (`--shadow-sm` through `--shadow-lg`) with `rgba(0,0,0,0.3–0.4)`. Apply sparingly — printed-paper aesthetic prefers borders to drop shadows.
- **Border radius scale**: `--radius: 0.75rem` (12px) is the base, with `--radius-sm/md/lg/xl` derived. CTAs use `rounded-full`. Cards use `rounded-2xl` (16px) or the bespoke `rounded-[14px]` for the hero scorecard.

## Components

### Primary CTA (brass pill)

```
background: BRASS (hsl(42 52% 59%))
color: INK
shape: rounded-full
padding: px-7 py-3.5
font: Manrope 600, text-sm, letter-spacing 0.04em
shadow: inset 0 1px 0 BRASS_DEEP, drop 0 14px 30px -12px brass-shadow, bottom 0 2px 0 black-18%
hover: -translate-y-0.5 (no color change)
active: translate-y-0
```

This is the system's primary action. One per screen. Reused identically on landing and in-app empty states.

### Scorecard card

The cream surface with dashed-divider header, hole-number row, par row, player rows, footer with leader. This is documented in `landing.tsx::HeroScorecard` and is the canonical pattern. When building any new score-shaped display, start from this structure.

### Eyebrow

```
font: Manrope 600, 10px, letter-spacing 0.32em, UPPERCASE, brass
```

Section-introducing micro-label. Used above every h2 on brand surfaces. Sparingly inside the app (page-headers only).

### Ornament

A small decorative trio: brass hairline left, ✦ glyph, brass hairline right. Used as section dividers on brand surfaces. Do not use inside the app — it's a landing-page ornament.

### Live indicator

A pulsing 1.5px brass-green dot using `animation: ping 1.6s` with a static inner dot. Used wherever auto-refresh is happening. The pulse is the entire signal — never accompany with text shouting "LIVE" except in the scorecard header where the printed metaphor justifies it.

### Score cells

Use the `.score-eagle / .score-birdie / .score-par / .score-bogey / .score-double / .score-empty` classes from `index.css`. The 18-hole grid composes these cells; do not invent new score color treatments.

### Shadcn components

Full shadcn/ui (new-york style) library is installed in `artifacts/golf-scorecard/src/components/ui/`. Use these as the base for any form / dialog / dropdown / tabs primitive. Style overrides should consume the design tokens, not introduce new colors. Bespoke styling (inline `style={{ background: BRASS, ... }}`) is acceptable for brand-leaning surfaces like the landing; in-app, prefer composing tokens via Tailwind utilities.

### Icons

`lucide-react`. Strokewidth 1.6–2 for decorative icons (e.g. flag, trophy), 2–2.25 for UI affordances (arrows, chevrons, plus). Size 11–22px depending on context. Never mix icon libraries.

## Motion

- **Page entry**: `society-rise` keyframe — opacity 0 + translateY(8px) → 1 + 0, 720ms with cubic-bezier `(0.22, 1, 0.36, 1)` (ease-out-quart family). Stagger via `animationDelay`. This is the system's only "arrival" animation.
- **Hover lift on CTAs**: `-translate-y-0.5` over default transition. No scale, no color flash.
- **Live dot**: Tailwind's `animate-ping` at 1.6s, applied to an overlay sibling not the dot itself.
- **No bounce, no elastic.** Banned by shared design laws.
- **No animating layout properties.** Use transform and opacity only. `gridTemplateColumns` and `width` transitions are banned.
- **Respect `prefers-reduced-motion`.** The rise animation should skip to its end state; the live dot pulse should reduce to a static dot.

## Imagery & Iconography

- **No photography in the app shell.** The metaphor is paper-and-brass, not photo-realism. The only image is the favicon / PWA icon.
- **No illustrations.** A flag icon, a trophy icon, a brass ✦ glyph carry all the ornament needed.
- **Brass corner stamps** (the "THRU 7" badge on the hero scorecard) are the system's one indulgent decoration — use sparingly on marketing surfaces only.

## Voice & Copy

- **Title Case for page titles and CTAs.** "My Trips", "Start a trip", "Create a Round".
- **Sentence case for body and helper text.** "You haven't joined or saved any trips yet."
- **No exclamation points. No emoji. No em dashes.** Voice is the dry, confident friend, not the over-eager assistant.
- **Address the group, not the user.** "Your group", "the trip", "everyone watching the leaderboard". Avoid "Welcome back", "valued member", "you crushed it" energy.
- **Microcopy can be witty, never goofy.** "The bar tab math is finally easy." / "Tee it up. The card's already drawn." / "Three steps. Then go play."

## Anti-patterns (do not ship)

These are absolute bans for this project, on top of the shared `impeccable` laws:

- **Tour-broadcast chrome.** Hyper-3D leaderboards, beveled position numbers, sponsor-tower logo lockups, gradient-fill team colors. The primary anti-reference.
- **Hero-metric template.** Big number + small label + supporting stats + gradient accent. Forbidden even on the landing.
- **Identical card grids.** The four-feature row uses italic roman numerals deliberately so each row reads slightly differently. Do not collapse to icon-title-text grids.
- **Side-stripe colored borders.** Banned by shared laws and would clash with the cream-card paper metaphor anyway.
- **Modal-first design.** We use modals for sign-in only. Score entry, course info, player editing all happen inline or on dedicated pages.
- **Confetti / celebration animations.** No score-entered fireworks, no leaderboard-changes balloon. Live without alarming (Principle 4 in PRODUCT.md).
- **Bright green health-app palette.** The only true green in the system is birdie-green (`148 45% 40%`), reserved for score cells and the live dot. Never as a CTA, never as a section background.
- **Generic shadcn baseline.** Default neutral grays from shadcn templates must be replaced with tinted-neutral tokens before shipping.
