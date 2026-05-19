# Product

## Register

product

The bulk of design effort lives inside the app (trip hub, round entry grid, leaderboards, my-trips). Marketing-shaped surfaces (`/`, `/privacy`) follow the same visual system but lean brand. When working on the landing, treat that page as brand register and load `reference/brand.md` for that task only. Everything else is product.

## Users

Two audiences sharing one screen:

- **Buddy-trip golfers.** Recreational, 8–20 handicap, annual or quarterly group outing. They open the app on the cart path, between holes, with one hand on a beer. They care about banter, side-bets, and bragging rights more than precision. They will not RTFM.
- **Serious club golfers.** Weekly players, WHS-literate, comfortable with Course Handicap allocation, multi-tee groups, and Nassau press conventions. They want the math correct and the friction minimal.

The same UI has to read on both shoulders. The casual player should never see "Course Handicap" jargon shouting at them; the serious player should be able to verify that strokes dropped on the right holes without leaving the round.

Context of use: mobile-first, outdoor sunlight, single-thumb operation while standing on a tee box. Auto-refreshing leaderboards mean other players are passively watching your taps from anywhere in the group. The PWA shell installs to the home screen; offline tolerance is a goal, not a guarantee.

## Product Purpose

Live, shared, handicap-aware scoring for a group golf trip. Replaces the spreadsheet-by-the-grill, the WhatsApp running tally, and the "wait, what was Mike on 14?" conversation.

The product exists because no incumbent (GHIN, GolfShot, 18Birdies) is designed for a fixed group of friends playing multiple rounds across a weekend with Stableford / Skins / Nassau / Net Stroke settled cleanly at the bar. Success looks like: one player taps in a score, the rest of the trip sees the leaderboard move within ten seconds, and nobody opens a calculator at the end of the round.

## Brand Personality

**Heritage. Quietly witty. Intimate.**

- *Heritage*, not nostalgic. The visual language borrows from real scorecards, club typography, and printed yardage books: tabular numerals, dashed dividers, brass-stamp ornaments, cream-on-forest cards. It looks like something a club steward might hand you, not a 1920s parody.
- *Quietly witty*, not jokey. Microcopy has a dry voice ("The bar tab math is finally easy", "Three steps. Then go play."). Never gags, never emoji, never exclamation points.
- *Intimate*, not corporate. The app addresses the trip, not a user base. "Your group", "the four guys you actually play with", "Tee it up". No "Welcome back, valued member" energy.

Tone is the voice of the most particular friend in your foursome: knows the rules cold, doesn't lecture about them.

## Anti-references

The single strongest anti-reference is **PGA-Tour-broadcast-graphics aesthetic**: chrome bevels, 3D leaderboards, hyper-real shadows, broadcast chyron lower-thirds, sponsor-tower logo lockups, gradient-fill team-color treatments. The app must never feel like the score bug on a Sunday telecast. When in doubt: flatter, quieter, more printed-paper than rendered-pixel.

Secondary anti-references:

- **Generic SaaS dashboard.** Sterile blue/white shadcn-default, kanban-shaped feature tiles, hero-metric template (big number + small label + gradient accent), gradient text, identical icon-card grids.
- **Casino / sportsbook.** Felt-green table textures, bookie-odds typography, neon accents, gambling-app loudness around the Nassau / Skins surfaces. We track money the group already agreed on, we do not promote action.
- **Country-club kitsch.** Blackletter type, hand-drawn crests, plaid backgrounds, leather textures, anything that reads as costume-heritage rather than actual heritage.
- **18Birdies / GolfShot consumer-app aesthetic.** Bright green health-app palette, cartoony swing-coach iconography, dopamine confetti, social-feed cards. We are not gamifying golf for an algorithm.

## Design Principles

1. **The scorecard is the product.** Everything else (auth, trip setup, settings) is connective tissue. When a design decision conflicts with the round-entry experience, the round wins. Tabular numerals, hole-grid alignment, and score-color semantics are non-negotiable.
2. **Read on both shoulders.** Every screen should answer the casual question in the first glance and the serious question in the second. Course Handicap and stroke allocation live inside the round, not stripped from it; jargon never leads the headline.
3. **Printed, not rendered.** Lean on the language of paper scorecards: dashed dividers, cream surfaces, brass ornaments, dotted-leader rows, optical typography. Avoid CSS effects that scream "web app" (drop shadows on everything, gradient overlays, glass blurs).
4. **Live without alarming.** Leaderboards refresh silently. A subtle pulsing dot signals liveness; positions slide rather than flash. Never red-flash a position change, never sound-alert a score, never modal-interrupt a player on the tee.
5. **The group is the unit.** Default copy, share affordances, and ownership states address the trip, not the individual. "Your group", "the trip", "everyone". Sign-in is a means to attach a person to their player slot, not the headline.

## Accessibility & Inclusion

- **Target WCAG 2.2 AA** on all in-app surfaces. Brass on forest and cream-on-forest pairings already pass; verify any new combination before shipping. Score-color cells must not be the only signal — pair every birdie/bogey color with a number and (where space allows) a glyph.
- **Outdoor-sun legibility** is the harder bar than the spec. Test screens at full brightness in direct sunlight with polarized sunglasses; if a color drops out, raise contrast even when AA already passes.
- **One-handed thumb reach.** Primary actions on every screen must be tappable with the thumb of the hand holding the phone. The score grid lives in the bottom two-thirds of the viewport on phone widths.
- **Touch targets ≥ 44×44pt** on every interactive cell, including the 18-hole grid.
- **`prefers-reduced-motion`** is respected for the rise-fade entry animation and the live-dot ping. Position transitions on the leaderboard reduce to instant snaps.
- **iOS auto-zoom prevention.** Form inputs use ≥16px font on phone widths (already enforced in `index.css`); never override this when adding new inputs.
- **No reliance on hover.** All hover affordances must have a touch equivalent (long-press menus, inline reveal, or explicit secondary buttons).
