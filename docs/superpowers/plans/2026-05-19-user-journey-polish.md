# User Journey Polish (Deferred Items) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick off four small follow-ups the final review of the prior plan ([2026-05-18 user-journey-improvements](2026-05-18-user-journey-improvements.md)) flagged but I deferred: deduplicate the `firstName` helper, harden the `tripUrl` construction, give the unauthed TripAuthGate a way out, and kill the brief picker flash before auto-resolve resolves.

**Architecture:** Four independent task groups. No schema or API changes. Each ships as a single commit and can land in any order. Three of them are 1-file touches; the firstName extraction touches three files.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7 (`import.meta.env.BASE_URL`), Wouter routing. Heritage palette via inline `style={{}}` HSL values per existing convention.

**Verification approach:** Same as the previous plan — no frontend test harness in this package. Per-task gate is `pnpm --filter @workspace/golf-scorecard run typecheck` plus the manual checks listed in each task. The end-to-end browser walk from the prior plan is the catch-all.

**Out of scope:**
- Adding a frontend test harness.
- The pre-existing trailing-whitespace nitpick in [landing.tsx hero paragraph](../../../artifacts/golf-scorecard/src/pages/landing.tsx) — pure formatting, not worth a commit unless touched anyway.
- Rewriting any pre-existing `window.location` URL construction outside trip-hub.tsx — there are other callsites in the codebase (e.g. older share patterns), but only the one in scope was flagged.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| [artifacts/golf-scorecard/src/lib/format.ts](../../../artifacts/golf-scorecard/src/lib/format.ts) | **Create** | Single home for tiny string/format helpers. First inhabitant: `firstName`. (Task 1) |
| [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx) | **Modify** | Replace local `firstName` definition with import. (Task 1) |
| [artifacts/golf-scorecard/src/pages/landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx) | **Modify** | Same — replace local definition with import. (Task 1) |
| [artifacts/golf-scorecard/src/pages/trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx) | **Modify** | Switch `tripUrl` construction to use `import.meta.env.BASE_URL`. (Task 2) |
| [artifacts/golf-scorecard/src/components/trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx) | **Modify** | Wire `SignInModal` `onClose` for the unauthed branch (Task 3); add loading guard when `players` is still pending (Task 4). |

The shared-util pattern matches what `back-nav.ts`, `auth.ts`, etc. already do in `src/lib/`. `lib/utils.ts` is reserved for shadcn's `cn()` (Tailwind class merge) and shouldn't accrete unrelated helpers.

---

## Task 1: Extract `firstName` to shared util

**Goal:** Replace the two identical local definitions with one shared import. The function was defined at [App.tsx:67-70](../../../artifacts/golf-scorecard/src/App.tsx#L67-L70) and again at [landing.tsx:7-11](../../../artifacts/golf-scorecard/src/pages/landing.tsx#L7-L11). Currently character-for-character identical.

**Files:**
- Create: [artifacts/golf-scorecard/src/lib/format.ts](../../../artifacts/golf-scorecard/src/lib/format.ts)
- Modify: [artifacts/golf-scorecard/src/App.tsx](../../../artifacts/golf-scorecard/src/App.tsx)
- Modify: [artifacts/golf-scorecard/src/pages/landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx)

- [ ] **Step 1: Create the shared helper**

Create [artifacts/golf-scorecard/src/lib/format.ts](../../../artifacts/golf-scorecard/src/lib/format.ts) with this exact content:

```ts
/**
 * Return the first whitespace-delimited token of a person's full name.
 * Empty / whitespace-only input returns the empty string.
 */
export function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(0, space);
}
```

- [ ] **Step 2: Update App.tsx — import and delete the local copy**

In [App.tsx](../../../artifacts/golf-scorecard/src/App.tsx), add the import near the other `@/` imports (alongside `useAuthSession`, around line 16):

```tsx
import { firstName } from "@/lib/format";
```

Then delete the local definition at [App.tsx:66-70](../../../artifacts/golf-scorecard/src/App.tsx#L66-L70):

```tsx
function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(0, space);
}
```

The single call site at [App.tsx:157](../../../artifacts/golf-scorecard/src/App.tsx#L157) (`{firstName(session.user.fullName)}`) keeps working since the imported version has the same signature.

- [ ] **Step 3: Update landing.tsx — import and delete the local copy**

In [landing.tsx](../../../artifacts/golf-scorecard/src/pages/landing.tsx), add the import near the other `@/lib/` imports (after the `useAuthSession` import, around line 6):

```tsx
import { firstName } from "@/lib/format";
```

Then delete the local definition at [landing.tsx:7-11](../../../artifacts/golf-scorecard/src/pages/landing.tsx#L7-L11) (the block `function firstName(fullName: string): string { ... }`). The call site at [landing.tsx:316](../../../artifacts/golf-scorecard/src/pages/landing.tsx#L316) keeps working.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

If it fails because the imports are flagged as unused, double-check you didn't accidentally delete the call sites; only the function definitions should be removed.

- [ ] **Step 5: Commit**

```bash
git add artifacts/golf-scorecard/src/lib/format.ts artifacts/golf-scorecard/src/App.tsx artifacts/golf-scorecard/src/pages/landing.tsx
git commit -m "Extract firstName helper to lib/format"
```

---

## Task 2: Harden `tripUrl` construction using `BASE_URL`

**Goal:** Use `import.meta.env.BASE_URL` instead of `window.location.pathname.split("/trips/")[0]` so the share URL is correct under any deploy base path and doesn't rely on the current pathname containing `/trips/`.

**Files:**
- Modify: [artifacts/golf-scorecard/src/pages/trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx)

**Context:** The current line at [trip-hub.tsx:79](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L79):

```tsx
  const tripUrl = `${window.location.origin}${window.location.pathname.split("/trips/")[0] || ""}/trips/${tripId}`;
```

This was a verbatim port of the older `handleShare` body. It breaks if the current URL doesn't already contain `/trips/`, e.g. if the share modal is ever opened from a different surface. The same base-path computation already exists at [App.tsx:227](../../../artifacts/golf-scorecard/src/App.tsx#L227) (`base={import.meta.env.BASE_URL.replace(/\/$/, "")}`) — we use the same idiom here.

- [ ] **Step 1: Replace the line**

In [trip-hub.tsx](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx), replace the single line at line 79:

```tsx
  const tripUrl = `${window.location.origin}${window.location.pathname.split("/trips/")[0] || ""}/trips/${tripId}`;
```

with:

```tsx
  const tripUrl = `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/trips/${tripId}`;
```

Nothing else in the file needs to change — the symbol `tripUrl` is still in scope for `handleShare` and the `<ShareTripModal tripUrl={tripUrl} />` mount below.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

- [ ] **Step 3: Manual smoke**

In a browser dev session, open any trip's TripHub, click Share, and confirm the URL inside the modal reads `http(s)://<host>/trips/<id>` (no doubled `/trips/`, no truncation). On Replit's base path (if you have access to a non-`/` deploy base) confirm the path includes the base prefix exactly once.

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/trip-hub.tsx
git commit -m "Use BASE_URL for tripUrl construction in TripHub"
```

---

## Task 3: Give unauthed visitors an escape from TripAuthGate's SignInModal

**Goal:** When a signed-out visitor lands on a trip link (`/trips/:tripId`) and dismisses the mandatory SignInModal, currently they're stuck on a blank dark-green screen with no controls. Wire `onClose` so dismissal navigates back to `/`. Matches the pattern already in [trips-new.tsx:103](../../../artifacts/golf-scorecard/src/pages/trips-new.tsx#L103).

**Files:**
- Modify: [artifacts/golf-scorecard/src/components/trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx)

**Context:** The unauthed branch at [trip-auth-gate.tsx:69-76](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx#L69-L76):

```tsx
  // If not signed in, force the mandatory sign-in modal first.
  if (!session) {
    return (
      <div className="min-h-screen" style={{ background: "hsl(158 65% 9%)" }}>
        <SignInModal open onSignedIn={() => { /* state will re-render */ }} title="Sign in to join this trip" />
      </div>
    );
  }
```

`SignInModal` accepts an `onClose?` prop. Today it's omitted, so the modal still has its own close affordance (Esc / backdrop / X) which closes the modal but leaves the user on the blank background. We add `onClose` that navigates home.

- [ ] **Step 1: Add the `useLocation` import**

The file currently does not import from `wouter`. Open [trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx) and add the import alongside the existing `@/components/` and `@/lib/` imports (near the top, after the existing imports):

```tsx
import { useLocation } from "wouter";
```

- [ ] **Step 2: Wire `navigate` into the component**

In `TripAuthGate` (starts around line 32), add a single line right after the existing `useState` hooks (after the `setNewHcp` declaration around line 40):

```tsx
  const [, navigate] = useLocation();
```

The placement matters: the destructure must run unconditionally before any early returns so it doesn't break hook ordering. Adding it adjacent to the other unconditional `useState` lines satisfies that.

- [ ] **Step 3: Pass `onClose` in the SignInModal mount**

Replace this block at [trip-auth-gate.tsx:69-76](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx#L69-L76):

```tsx
  // If not signed in, force the mandatory sign-in modal first.
  if (!session) {
    return (
      <div className="min-h-screen" style={{ background: "hsl(158 65% 9%)" }}>
        <SignInModal open onSignedIn={() => { /* state will re-render */ }} title="Sign in to join this trip" />
      </div>
    );
  }
```

with:

```tsx
  // If not signed in, force the sign-in modal. Dismissal exits to /.
  if (!session) {
    return (
      <div className="min-h-screen" style={{ background: "hsl(158 65% 9%)" }}>
        <SignInModal
          open
          onClose={() => navigate("/")}
          onSignedIn={() => { /* state will re-render */ }}
          title="Sign in to join this trip"
        />
      </div>
    );
  }
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

- [ ] **Step 5: Manual smoke**

1. Sign out (or open an incognito window).
2. Paste a trip URL like `http://localhost:<port>/trips/1`.
3. The SignInModal appears.
4. Click the X / press Esc / click the backdrop.
5. **Expected:** the route changes to `/` and the marketing landing renders. Previously the user would have been stranded on a blank green screen.

- [ ] **Step 6: Commit**

```bash
git add artifacts/golf-scorecard/src/components/trip-auth-gate.tsx
git commit -m "Exit TripAuthGate sign-in modal to / on dismissal"
```

---

## Task 4: Kill the picker-flash before auto-resolve

**Goal:** When a signed-in user enters a trip where they're already linked by `userId`, today's auto-resolve effect (added in the prior plan, Task 1) eventually short-circuits to the children — but for the brief window between mount and `useListPlayers` resolving, the "Who are you?" picker renders with an empty `<select>`. Add a guard so we render a tiny loading frame while `players` is pending.

**Files:**
- Modify: [artifacts/golf-scorecard/src/components/trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx)

**Context:** The current control flow after Task 3 lands:
1. `if (identity) return children` — auto-resolve case completes here on second render.
2. `if (!session) return <SignInModal>` — unauthed path.
3. Otherwise → render the picker form.

Between mount and `useListPlayers` resolution, `players === undefined`, so we fall through to (3) and render the picker with no options. The fix is a fourth guard between (2) and (3): if signed in but `players` hasn't resolved, render a minimal loading frame that matches the rest of the gate's chrome. The pattern matches [trip-hub.tsx:319-325](../../../artifacts/golf-scorecard/src/pages/trip-hub.tsx#L319-L325):

```tsx
  if (tripLoading) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>Loading...</div>
      </div>
    );
  }
```

**Tradeoff (documented for the implementer):** Adding the guard means users who would have seen the picker now wait an extra ~200-300ms staring at "Loading…" instead of an empty `<select>`. This is the right call because (a) the empty `<select>` is more confusing than a loader, and (b) the auto-resolve case is the common one for returning users — and that case currently shows a misleading "Who are you?" prompt to someone whose identity is about to be resolved. Don't try to optimize for the no-match case — clarity matters more.

- [ ] **Step 1: Add the loading guard**

Insert the following block in [trip-auth-gate.tsx](../../../artifacts/golf-scorecard/src/components/trip-auth-gate.tsx) AFTER the `if (!session) { ... }` block and BEFORE `// Signed in but no per-trip identity yet — pick or add player.` (around current line 77).

Note: After Task 3, the `if (!session)` block now spans multiple lines; the new guard goes immediately after its closing `}`.

```tsx
  // Wait for the players list to resolve before deciding what to show.
  // The auto-resolve effect needs `players` to know whether a userId link exists;
  // without this guard, the picker briefly renders with an empty <select>.
  if (!players) {
    return (
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>Loading...</div>
      </div>
    );
  }

  // Signed in but no per-trip identity yet — pick or add player.
  const noPlayers = players !== undefined && players.length === 0;
```

After this edit, the `noPlayers` line's `players !== undefined` check is technically redundant (the new guard guarantees `players` is defined). Simplify it to:

```tsx
  const noPlayers = players.length === 0;
```

…and the engineer should verify there are no other references to `players` that still defensively check for `undefined` (a quick search for `players ===` / `players ??` / `players ?.` in this file will confirm — there shouldn't be any after this edit).

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: passes.

- [ ] **Step 3: Manual smoke**

1. Sign in as a user who already has a `userId`-linked player in a trip.
2. Clear `localStorage` key `auth:trip:{tripId}` via DevTools.
3. Throttle the network to "Slow 3G" in DevTools to make the players query take a visible amount of time.
4. Navigate to `/trips/{tripId}`.
5. **Expected:** you briefly see "Loading…" on a dark green background, then the trip hub renders. You do NOT see the "Who are you?" picker.
6. Untoggle throttling. Repeat with a trip where you have no linked player. **Expected:** brief "Loading…", then the picker (with populated options).

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/components/trip-auth-gate.tsx
git commit -m "Loading guard in TripAuthGate to avoid picker flash"
```

---

## Final verification

After all four tasks have shipped:

- [ ] **Full workspace typecheck**

Run: `pnpm run typecheck`
Expected: passes for every package.

- [ ] **Smoke walkthrough**

1. Signed out, paste a trip URL — modal appears, Esc dismisses cleanly to `/`. (Task 3)
2. Signed in with a linked player, throttle network, enter the trip — see "Loading…", then trip hub. No picker flash. (Task 4)
3. Open any trip, Share — modal shows a clean URL with the correct base path. (Task 2)
4. Sign in and visit `/` — "Welcome back, {firstName}" card appears with the same first-name behavior as the navbar. (Task 1 — visual confirmation that the deduplicated helper still works.)
