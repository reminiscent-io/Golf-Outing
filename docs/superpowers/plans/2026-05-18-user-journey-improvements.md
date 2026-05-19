# User Journey Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce friction across the five highest-impact moments in the user journey: re-entering a trip you already belong to, leaving a deep route (profile/404), getting marketing instead of your trips on the homepage, sharing a trip with non-technical friends, and the confusing dual-purpose `/trips` route.

**Architecture:** Five independent task groups, each shippable on its own commit. No schema changes, no API changes, no new dependencies. Most work is in [artifacts/golf-scorecard/src/](../../../artifacts/golf-scorecard/src/). One new component for the share modal; one new page for trip creation; targeted edits everywhere else.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind 4, shadcn/ui (existing `Dialog`/`AlertDialog`/`Toaster`), Wouter routing, TanStack Query, lucide-react icons. Heritage palette via inline `style={{}}` HSL values per existing convention.

**Verification approach:** This package has no frontend tests and no `vitest.config.*` — same as the [2026-05-15 trips-page plan](2026-05-15-trips-page-priority-fixes.md). Each task's verification gate is `pnpm --filter @workspace/golf-scorecard run typecheck` plus a scripted manual browser walkthrough. The five task groups are independent and can ship in any order, though the order below is sequenced by impact-per-line-of-change.

**Out of scope (filed as follow-ups):**
- Adding a frontend test harness — would balloon scope. The scoring server tests in [scoring.test.ts](../../../artifacts/api-server/src/lib/scoring.test.ts) stay the only test surface.
- "Switch player" UX inside a trip for the rare case of one user being multiple players in one trip. The auto-resolve in Task 1 will pick the first match; a switcher is a separate UX problem.
- Server-side rate-limiting on `useListTrips` (the public list endpoint that Task 5 stops exposing in the UI). The endpoint still exists; locking it down is a backend concern.
- Public share landing page for non-signed-in viewers — locked off by [observer-mode-requires-auth memory](../../../.claude/projects/-Users-reminiscent-Golf-Outing/memory/observer-mode-requires-auth.md). The share funnel still routes through SignInModal.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| [artifacts/golf-scorecard/src/components/trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx) | **Modify** | Add a `useEffect` that auto-resolves identity when a player row is already linked to the signed-in user (Task 1). |
| [artifacts/golf-scorecard/src/pages/profile.tsx](../../../artifacts/golf-scorecard/src/pages/profile.tsx) | **Modify** | Back button uses `history.back()` with `/` fallback (Task 2). |
| [artifacts/golf-scorecard/src/pages/not-found.tsx](../../../artifacts/golf-scorecard/src/pages/not-found.tsx) | **Modify** | Same back-button treatment (Task 2). |
| [artifacts/golf-scorecard/src/lib/back-nav.ts](../../../artifacts/golf-scorecard/src/lib/back-nav.ts) | **Create** | Tiny `goBackOr(fallback, navigate)` helper shared by profile + not-found (Task 2). |
| [artifacts/golf-scorecard/src/pages/landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx) | **Modify** | When signed in, render a "Jump back in" card with the most-recent trip above the hero (Task 3). |
| [artifacts/golf-scorecard/src/components/share-trip-modal.tsx](../../../artifacts/golf-scorecard/src/components/share-trip-modal.tsx) | **Create** | shadcn `Dialog` with copy-link, prefilled SMS template, native share fallback (Task 4). |
| [artifacts/golf-scorecard/src/pages/trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx) | **Modify** | Replace inline `handleShare` with `ShareTripModal` open state (Task 4). |
| [artifacts/golf-scorecard/src/pages/trips-new.tsx](../../../artifacts/golf-scorecard/src/pages/trips-new.tsx) | **Create** | Dedicated `/trips/new` create-only page lifted out of `trips.tsx` (Task 5). |
| [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) | **Replace** | Becomes a redirect-only stub: signed-in → `/me/trips`, signed-out → `/` (Task 5). |
| [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx) | **Modify** | Register `/trips/new` before `/trips/:tripId` in the Switch (Task 5). |
| [artifacts/golf-scorecard/src/pages/my-trips.tsx](../../../artifacts/golf-scorecard/src/pages/my-trips.tsx) | **Modify** | Update two CTAs from `/trips?new=1` to `/trips/new` (Task 5). |

---

## Task 1: Auto-resolve trip identity when user→player link exists

**Goal:** A signed-in user who is already linked to a player in this trip (via `players.user_id`) is admitted without the "Who are you?" picker. The picker only shows when no match exists.

**Files:**
- Modify: [artifacts/golf-scorecard/src/components/trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx)

**Context for engineer:** The gate today ([trip-auth-gate.tsx:32-65](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx#L32-L65)) reads three values:
- `identity` — per-trip localStorage entry (set by `setTripIdentity`).
- `session` — global auth session from `useAuthSession()`.
- `players` — `useListPlayers(tripId)` result.

The `Player` type has `userId?: number | null` ([api.schemas.ts:99-107](../../../lib/api-client-react/src/generated/api.schemas.ts#L99-L107)). The user's id is at `session.user.id`. If we find a player with matching `userId`, we should write to `localStorage` via `setTripIdentity` and short-circuit.

- [ ] **Step 1: Add the auto-resolve effect**

Open [trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx). Add a `useEffect` import (the file currently only imports `useState`). Replace line 1:

```tsx
import { useEffect, useState, type ReactNode } from "react";
```

Then, immediately after the `useListPlayers` call (currently ending at [trip-auth-gate.tsx:51](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx#L51)), add the effect. The block should look like:

```tsx
  const { data: players } = useListPlayers(tripId, {
    query: {
      queryKey: getListPlayersQueryKey(tripId),
      enabled: !!session,
    },
  });

  // Auto-resolve identity when the signed-in user already has a player row in
  // this trip. Avoids forcing the "Who are you?" picker on every re-entry.
  useEffect(() => {
    if (identity) return;
    if (!session) return;
    if (!players) return;
    const mine = players.find(p => p.userId === session.user.id);
    if (!mine) return;
    setTripIdentity(tripId, { kind: "player", playerId: mine.id, playerName: mine.name });
  }, [identity, session, players, tripId]);
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes with no errors.

- [ ] **Step 3: Manual verification**

Start the dev stack (`pnpm --filter @workspace/api-server run dev` + `pnpm --filter @workspace/golf-scorecard run dev`). Then in a browser:

1. Sign in. Create a trip. Add yourself as a player (this links `userId`).
2. Clear `localStorage` key `auth:trip:{id}` via DevTools.
3. Navigate to `/trips/{id}`.
4. **Expected:** the "Who are you?" picker does NOT appear — TripHub loads directly.
5. As a control: clear `auth:trip:{id}` again, then in DevTools temporarily set the matching player's `userId` to `null` via DB or by creating a fresh trip where you haven't been linked. The picker SHOULD appear.

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/components/trip-auth-gate.tsx
git commit -m "Auto-resolve trip identity from user→player link"
```

---

## Task 2: Profile and NotFound back buttons use history

**Goal:** Clicking the back button on `/profile` or `/404` returns to wherever the user came from, instead of hard-routing to `/` and dropping them out of context. Falls back to `/` when there's no prior entry (e.g. direct link or fresh tab).

**Files:**
- Create: [artifacts/golf-scorecard/src/lib/back-nav.ts](../../../artifacts/golf-scorecard/src/lib/back-nav.ts)
- Modify: [artifacts/golf-scorecard/src/pages/profile.tsx](../../../artifacts/golf-scorecard/src/pages/profile.tsx)
- Modify: [artifacts/golf-scorecard/src/pages/not-found.tsx](../../../artifacts/golf-scorecard/src/pages/not-found.tsx)

- [ ] **Step 1: Create the helper**

Create [artifacts/golf-scorecard/src/lib/back-nav.ts](../../../artifacts/golf-scorecard/src/lib/back-nav.ts) with this exact content:

```ts
/**
 * Pop the browser history. Falls back to `fallback` when there's no entry to
 * pop (direct link, fresh tab, or app entry). The fallback uses Wouter's
 * `navigate` so it stays inside the SPA.
 */
export function goBackOr(
  fallback: string,
  navigate: (to: string) => void,
): void {
  if (typeof window !== "undefined" && window.history.length > 1) {
    window.history.back();
    return;
  }
  navigate(fallback);
}
```

- [ ] **Step 2: Wire it into profile.tsx**

In [profile.tsx](../../../artifacts/golf-scorecard/src/pages/profile.tsx), add the import near the other `@/` imports (after line 6):

```tsx
import { goBackOr } from "@/lib/back-nav";
```

Then replace the `onClick={() => navigate("/")}` at [profile.tsx:63](../../../artifacts/golf-scorecard/src/pages/profile.tsx#L63) with:

```tsx
            onClick={() => goBackOr("/", navigate)}
```

- [ ] **Step 3: Wire it into not-found.tsx**

In [not-found.tsx](../../../artifacts/golf-scorecard/src/pages/not-found.tsx), replace the entire file with:

```tsx
import { useLocation } from "wouter";
import { goBackOr } from "@/lib/back-nav";

export default function NotFound() {
  const [, navigate] = useLocation();
  return (
    <div className="min-h-dvh bg-background flex items-center justify-center">
      <div className="text-center">
        <div className="text-6xl mb-4 font-serif" style={{ color: "hsl(42 52% 59%)" }}>404</div>
        <p className="font-sans mb-6" style={{ color: "hsl(42 25% 60%)" }}>Page not found</p>
        <button
          onClick={() => goBackOr("/", navigate)}
          className="px-6 py-2.5 rounded-xl font-sans font-semibold text-sm"
          style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
        >
          Go Back
        </button>
      </div>
    </div>
  );
}
```

Note the button label changes from "Go Home" to "Go Back" — the action is now pop-history, not hard-route.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

- [ ] **Step 5: Manual verification**

1. From a trip's TripHub, click the avatar in the navbar (goes to `/profile`). Click the back arrow. **Expected:** returns to the TripHub.
2. Hard-load `/profile` in a fresh tab (paste URL). Click back arrow. **Expected:** navigates to `/`.
3. Navigate to any nonexistent route like `/garbage`. Click "Go Back". **Expected:** returns to the previous page.
4. Hard-load `/garbage` in a fresh tab. Click "Go Back". **Expected:** navigates to `/`.

- [ ] **Step 6: Commit**

```bash
git add artifacts/golf-scorecard/src/lib/back-nav.ts artifacts/golf-scorecard/src/pages/profile.tsx artifacts/golf-scorecard/src/pages/not-found.tsx
git commit -m "Profile and 404 back buttons pop history instead of routing home"
```

---

## Task 3: Signed-in landing renders a "Jump back in" card

**Goal:** When a signed-in user lands on `/`, the hero is replaced with a compact card showing their most recent trip and a "Continue" button. Marketing content stays below for sharing. Signed-out behavior is unchanged.

**Files:**
- Modify: [artifacts/golf-scorecard/src/pages/landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx)

**Context for engineer:** The landing page hero starts around [landing.tsx:295](../../../artifacts/golf-scorecard/src/pages/landing.tsx#L295) and ends at [landing.tsx:383](../../../artifacts/golf-scorecard/src/pages/landing.tsx#L383). It already reads `session`. We're going to add a sibling section above the hero that's only rendered when `session` is truthy. The marketing sections below stay intact (returning users often want to invite a friend and link to features).

`useListMyTrips()` is already available from `@workspace/api-client-react` — see [my-trips.tsx:2](../../../artifacts/golf-scorecard/src/pages/my-trips.tsx#L2) for the import shape. Each entry is a `UserTripAssociation` with `.trip` (has `id`, `name`, `createdAt`) and `.via`.

- [ ] **Step 1: Add the import for the my-trips hook**

In [landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx), look at the imports — there's currently no API hook import. Add this near the top, alongside the existing `useState`/`useLocation` imports:

```tsx
import { useListMyTrips, getListMyTripsQueryKey } from "@workspace/api-client-react";
```

- [ ] **Step 2: Add the hook call in `LandingPage`**

Inside `LandingPage` (starts at [landing.tsx:272](../../../artifacts/golf-scorecard/src/pages/landing.tsx#L272)), after the existing `useAuthSession()` call, add:

```tsx
  const { data: myTrips } = useListMyTrips({
    query: {
      queryKey: getListMyTripsQueryKey(),
      enabled: !!session,
    },
  });
  const mostRecent = (myTrips ?? [])[0] ?? null;
```

The API returns entries already sorted by recency on the server side (see [my-trips.tsx:67-77](../../../artifacts/golf-scorecard/src/pages/my-trips.tsx#L67-L77) which renders them in order without sorting). If that assumption is wrong at runtime, the user just sees a different valid trip — non-fatal.

- [ ] **Step 3: Add the "Jump back in" section above the hero**

Find the hero section opening tag (`<section className="relative overflow-hidden"` at [landing.tsx:296](../../../artifacts/golf-scorecard/src/pages/landing.tsx#L296)). Immediately BEFORE that `<section>`, add:

```tsx
      {session && mostRecent && (
        <section
          style={{
            background: `linear-gradient(180deg, hsl(158 50% 16%) 0%, ${FOREST_BG} 100%)`,
          }}
        >
          <div className="max-w-lg mx-auto px-6 pt-10 pb-6">
            <Eyebrow>Welcome back, {firstName(session.user.fullName)}</Eyebrow>
            <button
              type="button"
              onClick={() => navigate(`/trips/${mostRecent.trip.id}`)}
              className="mt-4 w-full text-left rounded-xl px-5 py-4 transition-transform hover:-translate-y-0.5 active:translate-y-0"
              style={{
                background: "hsl(42 45% 91%)",
                border: "1px solid hsl(38 25% 78%)",
              }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div
                    className="font-sans text-[10px] font-semibold uppercase tracking-widest mb-1"
                    style={{ color: "hsl(38 20% 38%)" }}
                  >
                    Continue trip
                  </div>
                  <div
                    className="font-serif text-lg font-semibold truncate"
                    style={{ color: "hsl(38 30% 14%)" }}
                  >
                    {mostRecent.trip.name}
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "hsl(38 20% 50%)" }} />
              </div>
            </button>
            <button
              type="button"
              onClick={() => navigate("/me/trips")}
              className="mt-3 font-sans text-xs hover:opacity-80 transition-opacity"
              style={{ color: BRASS_MUTED, letterSpacing: "0.06em" }}
            >
              See all my trips →
            </button>
          </div>
        </section>
      )}
```

The `firstName` helper lives in [App.tsx:66-70](../../../artifacts/golf-scorecard/src/App.tsx#L66-L70) but is not exported. Either re-implement it inline at the top of `landing.tsx` (DRY violation, but the function is two lines) or export it from App.tsx. Choose **inline re-implementation** to keep the change scoped:

Add this helper near the top of [landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx) (right under the imports, above the first const declaration):

```tsx
function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(0, space);
}
```

You'll also need `ChevronRight` from lucide. Find the existing lucide import line in `landing.tsx` and add `ChevronRight` to the named imports.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

- [ ] **Step 5: Manual verification**

1. Sign out (or use an incognito window). Navigate to `/`. **Expected:** hero looks unchanged — no "Welcome back" card.
2. Sign in with an account that has at least one trip. Navigate to `/`. **Expected:** a "Welcome back, {firstName}" card appears above the hero with the most recent trip. Clicking the card navigates to that trip. "See all my trips" link navigates to `/me/trips`.
3. Sign in with an account that has zero trips (use a fresh phone number). Navigate to `/`. **Expected:** no card — hero shown as before. The signed-in user with no trips still gets the hero CTA which routes them to `/me/trips` (which is empty-state and prompts trip creation).

- [ ] **Step 6: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/landing.tsx
git commit -m "Add Jump back in card on landing for signed-in users"
```

---

## Task 4: Explicit Share/Invite modal in TripHub

**Goal:** Clicking "Share" on a TripHub opens a modal with the link visible, a copy button, a prefilled SMS template, and a native-share button. Today's behavior either fires `navigator.share` (where supported) or silently copies — both are invisible and offer no message hint.

**Files:**
- Create: [artifacts/golf-scorecard/src/components/share-trip-modal.tsx](../../../artifacts/golf-scorecard/src/components/share-trip-modal.tsx)
- Modify: [artifacts/golf-scorecard/src/pages/trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx)

**Context for engineer:** The current handler at [trip-hub.tsx:78-92](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L78-L92) constructs the URL and either calls `navigator.share` or copies to clipboard. The `shareToast` state at [trip-hub.tsx:62](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L62) feeds an inline toast at [trip-hub.tsx:379](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L379). Both go away; the modal becomes the surface.

The shadcn `Dialog` is already in `components/ui/` — see [game-info-modal.tsx](../../../artifacts/golf-scorecard/src/components/game-info-modal.tsx) for an in-repo example of its use.

- [ ] **Step 1: Create the modal component**

Create [artifacts/golf-scorecard/src/components/share-trip-modal.tsx](../../../artifacts/golf-scorecard/src/components/share-trip-modal.tsx) with this exact content:

```tsx
import { useState } from "react";
import { Copy, Check, MessageSquare, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onClose: () => void;
  tripName: string;
  tripUrl: string;
};

const BRASS = "hsl(42 52% 59%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";

export function ShareTripModal({ open, onClose, tripName, tripUrl }: Props) {
  const [copied, setCopied] = useState(false);

  const smsBody = `Join my golf trip "${tripName}" — live scoring + leaderboard: ${tripUrl}`;
  const smsHref = `sms:?&body=${encodeURIComponent(smsBody)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(tripUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — leave the URL visible so user can long-press to copy.
    }
  }

  function handleNativeShare() {
    if (typeof navigator.share !== "function") return;
    void navigator.share({ url: tripUrl, text: smsBody, title: tripName }).catch(() => {});
  }

  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md" style={{ background: "hsl(42 45% 91%)" }}>
        <DialogHeader>
          <DialogTitle className="font-serif" style={{ color: INK }}>
            Invite to {tripName}
          </DialogTitle>
        </DialogHeader>

        <p className="font-sans text-xs" style={{ color: INK_SOFT }}>
          Anyone with the link can sign in and join as a player, or just watch the leaderboard.
        </p>

        {/* Link + copy */}
        <div className="flex items-center gap-2 rounded-lg p-2" style={{ background: "white", border: "1px solid hsl(38 25% 78%)" }}>
          <input
            readOnly
            value={tripUrl}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 px-2 py-1.5 font-mono text-xs outline-none bg-transparent"
            style={{ color: INK }}
          />
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy link"
            className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-md font-sans text-xs font-semibold"
            style={{ background: copied ? FOREST_ACCENT : BRASS, color: copied ? BRASS : INK }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Action row */}
        <div className="flex flex-col gap-2 mt-2">
          <a
            href={smsHref}
            className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg font-sans font-semibold text-sm"
            style={{ background: FOREST_ACCENT, color: BRASS }}
          >
            <MessageSquare size={14} />
            Send by text
          </a>
          {hasNativeShare && (
            <button
              type="button"
              onClick={handleNativeShare}
              className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg font-sans font-semibold text-sm"
              style={{ background: "transparent", color: INK_SOFT, border: "1px dashed hsl(38 25% 72%)" }}
            >
              <Share2 size={14} />
              More share options
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Wire it into TripHub**

In [trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx), add the import near the other `@/components/` imports (around line 37-38):

```tsx
import { ShareTripModal } from "@/components/share-trip-modal";
```

Replace the `shareToast` state declaration at [trip-hub.tsx:62](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L62):

```tsx
  const [shareOpen, setShareOpen] = useState(false);
```

Replace the entire `handleShare` function ([trip-hub.tsx:78-92](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L78-L92)) with a single derivation + simple opener:

```tsx
  const tripUrl = `${window.location.origin}${window.location.pathname.split("/trips/")[0] || ""}/trips/${tripId}`;

  function handleShare() {
    setShareOpen(true);
  }
```

Then find the inline shareToast render block (starts at [trip-hub.tsx:379](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L379) — search for `{shareToast &&`) and **delete it entirely**, including the closing `)}` on the line after the toast div. This block exists only to render the old "Link copied" message; the modal replaces that surface.

Finally, mount the modal at the end of the return — just before the closing tag of the outermost `<div className="min-h-dvh bg-background">`. Place it adjacent to where the existing `<SignInModal>` is mounted (search for `<SignInModal` inside trip-hub.tsx). Add:

```tsx
      <ShareTripModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        tripName={trip?.name ?? "this trip"}
        tripUrl={tripUrl}
      />
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

- [ ] **Step 4: Manual verification**

1. Open any trip's TripHub. Click "Share". **Expected:** modal opens showing trip name in the title, the full URL in a readonly input, a "Copy" button, a "Send by text" link, and (on Chrome mobile/Safari) a "More share options" button.
2. Click "Copy". **Expected:** button shows "Copied" for ~2 seconds; pasting elsewhere yields the URL.
3. Click "Send by text". **Expected:** on mobile, the SMS composer opens with the prefilled body. On desktop, the browser may prompt to open Messages or ignore — either is acceptable.
4. Close the modal (click outside or press Esc). **Expected:** modal closes cleanly, no error in console.
5. Confirm the old toast no longer appears anywhere on the page.

- [ ] **Step 5: Commit**

```bash
git add artifacts/golf-scorecard/src/components/share-trip-modal.tsx artifacts/golf-scorecard/src/pages/trip-hub.tsx
git commit -m "Replace inline share handler with dedicated Share/Invite modal"
```

---

## Task 5: Move trip creation to `/trips/new`, redirect `/trips`

**Goal:** Replace the dual-purpose `/trips` page (create + public browse) with `/trips/new` (create-only) and a redirect stub at `/trips`. Stops anonymous enumeration of all trips, and removes the naming clash with `/me/trips`.

**Files:**
- Create: [artifacts/golf-scorecard/src/pages/trips-new.tsx](../../../artifacts/golf-scorecard/src/pages/trips-new.tsx)
- Replace: [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) (rewrite as redirect stub)
- Modify: [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx)
- Modify: [artifacts/golf-scorecard/src/pages/my-trips.tsx](../../../artifacts/golf-scorecard/src/pages/my-trips.tsx)
- Modify: [artifacts/golf-scorecard/src/pages/landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx)

**Context for engineer:** Today `/trips` lists every trip in the database via `useListTrips()` ([trips.tsx:30](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L30)) — visible to anonymous visitors. The page ALSO contains the create flow. We're splitting them. Trip CREATION uses `useCreateTrip` which on success navigates to `/trips/{id}`. Trip-Hub's back arrow currently routes to `/trips` ([trip-hub.tsx:333](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L333)) — after this task it should route to `/me/trips` instead.

The Wouter `Switch` ([App.tsx:204-213](../../../artifacts/golf-scorecard/src/App.tsx#L204-L213)) picks the first matching `Route`. Because `/trips/:tripId` would match `/trips/new`, the static `/trips/new` route MUST come BEFORE `/trips/:tripId`.

- [ ] **Step 1: Create `/trips/new` page**

Create [artifacts/golf-scorecard/src/pages/trips-new.tsx](../../../artifacts/golf-scorecard/src/pages/trips-new.tsx) with this exact content:

```tsx
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTrip,
  getListMyTripsQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, Trophy } from "lucide-react";
import { useAuthSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";
import { goBackOr } from "@/lib/back-nav";

function defaultRoundName(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function NewTripPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const createTrip = useCreateTrip();
  const [tripName, setTripName] = useState(defaultRoundName());
  const [signInOpen, setSignInOpen] = useState(!session);

  // Keep the modal open as long as the user isn't signed in. The modal is
  // mandatory: closing it sends them home.
  useEffect(() => {
    if (!session) setSignInOpen(true);
  }, [session]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { setSignInOpen(true); return; }
    if (!tripName.trim()) return;
    createTrip.mutate(
      { data: { name: tripName.trim() } },
      {
        onSuccess: (trip) => {
          queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() });
          navigate(`/trips/${trip.id}`);
        },
      }
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => goBackOr("/me/trips", navigate)}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <div className="flex items-center gap-3 mb-1">
            <Trophy className="text-primary" size={28} strokeWidth={1.5} />
            <h1 className="text-3xl font-serif text-primary">New Trip</h1>
          </div>
          <p className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>
            Name your trip — you'll add players inside.
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {session && (
          <form
            onSubmit={handleCreate}
            className="rounded-xl p-4"
            style={{ background: "hsl(42 45% 91%)" }}
          >
            <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Trip Name
            </label>
            <input
              autoFocus
              value={tripName}
              onChange={e => setTripName(e.target.value)}
              onFocus={e => e.currentTarget.select()}
              placeholder="The Family Cup 2025..."
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{
                background: "white",
                color: "hsl(38 30% 14%)",
                border: "1.5px solid hsl(38 25% 72%)",
              }}
            />
            <button
              type="submit"
              disabled={createTrip.isPending || !tripName.trim()}
              className="w-full py-2.5 rounded-lg font-sans font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {createTrip.isPending ? "Creating..." : "Create Trip"}
            </button>
          </form>
        )}

        <SignInModal
          open={signInOpen}
          onClose={() => navigate("/")}
          onSignedIn={() => setSignInOpen(false)}
          title="Sign in to create a trip"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Replace `/trips` with a redirect stub**

Replace the entire contents of [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) with:

```tsx
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuthSession } from "@/lib/auth";

export default function TripsPage() {
  const [, navigate] = useLocation();
  const session = useAuthSession();

  useEffect(() => {
    navigate(session ? "/me/trips" : "/", { replace: true });
  }, [session, navigate]);

  return null;
}
```

This route now exists only for backwards compatibility — old links route forward.

- [ ] **Step 3: Register `/trips/new` in App.tsx, ordered correctly**

In [App.tsx](../../../artifacts/golf-scorecard/src/App.tsx), add the import near the other page imports (around line 13):

```tsx
import NewTripPage from "@/pages/trips-new";
```

Then update the `Switch` block ([App.tsx:204-213](../../../artifacts/golf-scorecard/src/App.tsx#L204-L213)). Replace it entirely with this ordering (the static `/trips/new` MUST come before `/trips/:tripId`):

```tsx
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/trips" component={TripsPage} />
        <Route path="/trips/new" component={NewTripPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/me/trips" component={MyTripsPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/trips/:tripId" component={GatedTripHub} />
        <Route path="/trips/:tripId/rounds/:roundId" component={GatedRound} />
        <Route component={NotFound} />
      </Switch>
```

- [ ] **Step 4: Update my-trips.tsx CTAs**

In [my-trips.tsx](../../../artifacts/golf-scorecard/src/pages/my-trips.tsx), there are two `navigate("/trips?new=1")` calls — at [my-trips.tsx:43](../../../artifacts/golf-scorecard/src/pages/my-trips.tsx#L43) and [my-trips.tsx:90](../../../artifacts/golf-scorecard/src/pages/my-trips.tsx#L90). Change BOTH to:

```tsx
              onClick={() => navigate("/trips/new")}
```

- [ ] **Step 5: Update landing.tsx CTA**

In [landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx), in the `handlePrimaryCTA` function ([landing.tsx:277-283](../../../artifacts/golf-scorecard/src/pages/landing.tsx#L277-L283)), change the signed-out branch from `/trips` to `/trips/new`:

```tsx
  function handlePrimaryCTA() {
    if (session) {
      navigate("/me/trips");
    } else {
      navigate("/trips/new");
    }
  }
```

- [ ] **Step 6: Update trip-hub.tsx back-arrow destination**

In [trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx) at [line 333](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L333), the back arrow currently navigates to `/trips`. Change it to `/me/trips`:

```tsx
            onClick={() => navigate("/me/trips")}
```

Also update the label text on the next line from `All Trips` to `My Trips`.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes. Any unused-import errors in the rewritten `trips.tsx` mean the stub still imports something stale — re-paste from Step 2.

- [ ] **Step 8: Manual verification**

1. Signed out, hard-load `/trips`. **Expected:** redirects to `/`.
2. Signed in, hard-load `/trips`. **Expected:** redirects to `/me/trips`.
3. Signed in, navigate to `/trips/new`. **Expected:** trip name form, no list of other trips. Submit it — creates the trip and navigates to `/trips/{id}`.
4. Signed out, navigate to `/trips/new`. **Expected:** SignInModal blocks the form. Close the modal — redirects to `/`. Sign in instead — the form appears.
5. From `/me/trips`, click "New" or "Create a Round" empty-state CTA. **Expected:** routes to `/trips/new`, NOT `/trips?new=1`.
6. From `/`, click hero CTA when signed out. **Expected:** routes to `/trips/new`. When signed in: routes to `/me/trips`.
7. Open a trip, click back arrow. **Expected:** routes to `/me/trips`, labeled "My Trips".
8. Open DevTools network tab on `/me/trips` and confirm `useListTrips` is no longer called from anywhere in the UI flow (it's still in the API; we just stopped surfacing it).

- [ ] **Step 9: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/trips.tsx artifacts/golf-scorecard/src/pages/trips-new.tsx artifacts/golf-scorecard/src/App.tsx artifacts/golf-scorecard/src/pages/my-trips.tsx artifacts/golf-scorecard/src/pages/landing.tsx artifacts/golf-scorecard/src/pages/trip-hub.tsx
git commit -m "Split /trips into /trips/new (create) and a redirect stub"
```

---

## Final verification

After all five task groups have shipped:

- [ ] **Full typecheck across the workspace**

Run: `pnpm run typecheck`
Expected: passes for every package.

- [ ] **End-to-end manual walk**

1. Incognito → `/` → sign in modal → sign up new account.
2. Sign-in form drops you on `/me/trips` (empty state).
3. Click "Create a Round" → `/trips/new` → enter name → land on `/trips/{id}` → TripHub.
4. The "Who are you?" picker auto-resolves because creating the trip linked you as a player.
5. Click Share → modal opens with link + SMS + native-share.
6. Click back arrow → `/me/trips`.
7. Click avatar → `/profile` → click back → returns to `/me/trips`.
8. Manually visit `/garbage` → 404 page → "Go Back" returns to `/profile`.
9. Sign out → on `/` you see the marketing hero, no "Welcome back" card.
10. Sign back in → on `/` you see the "Welcome back" card with the trip from step 3.
