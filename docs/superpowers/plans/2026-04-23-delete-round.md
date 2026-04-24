# Delete Round Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trash icon at the bottom of the round Setup tab that deletes the round (with AlertDialog confirmation) and navigates back to the trip hub.

**Architecture:** Single-file frontend change in `artifacts/golf-scorecard/src/pages/round.tsx`. Use the existing generated `useDeleteRound` mutation, the existing AlertDialog primitive, and the existing Wouter `navigate` and TanStack Query `queryClient` instances already wired into the page. Server, schema, and OpenAPI spec require no changes — DELETE endpoint and FK cascades already exist.

**Tech Stack:** React 19, TanStack Query, Wouter, Radix AlertDialog (via shadcn), lucide-react icons, Tailwind 4.

**Spec:** [docs/superpowers/specs/2026-04-23-delete-round-design.md](../specs/2026-04-23-delete-round-design.md)

**Test approach:** This package has no automated test suite (no vitest/jest config, no `*.test.*` files exist). Verification is `pnpm run typecheck` plus manual UI testing in the dev server, matching how the rest of this codebase ships frontend work.

---

## Task 1: Wire up imports and the delete mutation

**Files:**
- Modify: [artifacts/golf-scorecard/src/pages/round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx) — imports (lines 4-19), mutation hook (after line 144)

- [ ] **Step 1: Add `useDeleteRound` and `getListRoundsQueryKey` to the api-client-react import**

In [round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx) lines 4-18, the import block currently is:

```tsx
import {
  useGetRound,
  useListPlayers,
  useGetScores,
  useGetRoundLeaderboard,
  useUpsertScore,
  useUpdateRound,
  getGetRoundQueryKey,
  getListPlayersQueryKey,
  getGetScoresQueryKey,
  getGetRoundLeaderboardQueryKey,
  getGetTripLeaderboardQueryKey,
  useListRoundGroups,
  getListRoundGroupsQueryKey,
} from "@workspace/api-client-react";
```

Add `useDeleteRound` and `getListRoundsQueryKey` to that import list:

```tsx
import {
  useGetRound,
  useListPlayers,
  useGetScores,
  useGetRoundLeaderboard,
  useUpsertScore,
  useUpdateRound,
  useDeleteRound,
  getGetRoundQueryKey,
  getListPlayersQueryKey,
  getGetScoresQueryKey,
  getGetRoundLeaderboardQueryKey,
  getGetTripLeaderboardQueryKey,
  getListRoundsQueryKey,
  useListRoundGroups,
  getListRoundGroupsQueryKey,
} from "@workspace/api-client-react";
```

- [ ] **Step 2: Add `Trash2` to the lucide-react import**

Line 19 is currently:

```tsx
import { ArrowLeft, Settings, Trophy, Grid3X3 } from "lucide-react";
```

Change to:

```tsx
import { ArrowLeft, Settings, Trophy, Grid3X3, Trash2 } from "lucide-react";
```

- [ ] **Step 3: Add AlertDialog imports**

Add a new import line after line 19 (after the lucide-react import):

```tsx
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
```

- [ ] **Step 4: Instantiate the delete mutation**

Line 144 currently is:

```tsx
  const updateRound = useUpdateRound();
```

Add the delete mutation immediately after it:

```tsx
  const updateRound = useUpdateRound();
  const deleteRound = useDeleteRound();
```

- [ ] **Step 5: Add the delete handler**

Find `handleSaveSetup` at line 313. Immediately after its closing brace at line 347, add a new `handleDeleteRound` function. It calls `deleteRound.mutate`, on success invalidates the trip's rounds list and navigates to the trip hub. No `onError` handler — match the page's existing pattern (`handleSaveSetup` also has none); the mutation's `isError` state will keep the trash button re-enabled and the dialog open if the request fails.

```tsx
  function handleDeleteRound() {
    deleteRound.mutate(
      { tripId, roundId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey(tripId) });
          queryClient.invalidateQueries({ queryKey: getGetTripLeaderboardQueryKey(tripId) });
          navigate(`/trips/${tripId}`);
        },
      }
    );
  }
```

(`navigate` comes from `useLocation()` at line 97; `queryClient`, `tripId`, and `roundId` are all already in scope.)

- [ ] **Step 6: Typecheck**

```
pnpm --filter @workspace/golf-scorecard run typecheck
```

Expected: passes with no errors.

- [ ] **Step 7: Commit**

```
git add artifacts/golf-scorecard/src/pages/round.tsx
git commit -m "Wire up delete-round mutation in round page"
```

---

## Task 2: Replace the Save Setup button with the trash + Save row

**Files:**
- Modify: [artifacts/golf-scorecard/src/pages/round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx) — lines 1021-1028

- [ ] **Step 1: Replace the standalone Save Setup button with a flex row containing the trash AlertDialog and the Save Setup button**

Lines 1021-1028 currently are:

```tsx
          <button
            onClick={handleSaveSetup}
            disabled={updateRound.isPending}
            className="w-full py-3 rounded-xl font-sans font-semibold text-sm transition-all hover:opacity-90"
            style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
          >
            {updateRound.isPending ? "Saving..." : "Save Setup"}
          </button>
```

Replace that block with:

```tsx
          <div className="flex items-center gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  type="button"
                  aria-label="Delete round"
                  disabled={updateRound.isPending || deleteRound.isPending}
                  className="shrink-0 p-3 rounded-xl border transition-all hover:bg-red-50 disabled:opacity-50"
                  style={{ borderColor: "hsl(0 60% 55%)", color: "hsl(0 60% 45%)" }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this round?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the round and all scores. This can&apos;t be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleteRound.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteRound}
                    disabled={deleteRound.isPending}
                    className="bg-red-600 hover:bg-red-700 text-white"
                  >
                    {deleteRound.isPending ? "Deleting..." : "Delete round"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <button
              onClick={handleSaveSetup}
              disabled={updateRound.isPending || deleteRound.isPending}
              className="flex-1 py-3 rounded-xl font-sans font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {updateRound.isPending ? "Saving..." : "Save Setup"}
            </button>
          </div>
```

Notes for the implementer:
- `asChild` lets the `AlertDialogTrigger` forward its props to your custom `<button>` instead of rendering an extra wrapper.
- `&apos;` is required inside JSX strings for the apostrophe in "can't" to satisfy the default React lint rule used in this repo. If you prefer, you can swap to a template-literal expression: `{"This can't be undone."}`.
- The trash button uses red borders/text inline rather than Tailwind utility classes for the destructive color — matching the inline-`style` palette pattern used by every other custom-styled button on this page (see Save Setup itself). The hover state and `AlertDialogAction` button can use Tailwind reds because they're not part of the page's bespoke palette.

- [ ] **Step 2: Typecheck**

```
pnpm --filter @workspace/golf-scorecard run typecheck
```

Expected: passes with no errors.

- [ ] **Step 3: Commit**

```
git add artifacts/golf-scorecard/src/pages/round.tsx
git commit -m "Add delete-round trash button and confirmation dialog to Setup tab"
```

---

## Task 3: Manual UI verification

**Files:** None — this is a verification task.

The frontend has no automated test suite, so this task replaces the usual TDD loop. Do not skip it.

- [ ] **Step 1: Start the API server**

In one terminal:

```
pnpm --filter @workspace/api-server run dev
```

Expected: server logs that it's listening on `$PORT`.

- [ ] **Step 2: Start the scorecard dev server**

In a second terminal:

```
pnpm --filter @workspace/golf-scorecard run dev
```

Expected: Vite serves the app on `$PORT`.

- [ ] **Step 3: Verify the trash button renders**

In the browser:
1. Open a trip and pick a round.
2. Switch to the **Setup** tab.
3. Scroll to the bottom.

Expected: a red-bordered square trash button sits to the **left** of the Save Setup button. The Save Setup button fills the rest of the row width. Both buttons are vertically centered with each other.

- [ ] **Step 4: Verify Cancel works**

Click the trash icon. Expected: AlertDialog opens with title "Delete this round?" and the description from the spec. Click **Cancel**. Expected: dialog closes, you're still on the Setup tab, the round still exists.

- [ ] **Step 5: Verify confirm deletes and navigates**

Click the trash icon again, then **Delete round**. Expected:
1. The "Delete round" button briefly shows "Deleting…" and is disabled.
2. The browser navigates to `/trips/<tripId>`.
3. On the trip hub, the round you just deleted is no longer in the rounds list (this verifies the `getListRoundsQueryKey` invalidation worked — if the round still appears, the cache invalidation key is wrong).

- [ ] **Step 6: Verify cascade — pick a round that has scores entered**

Repeat steps 3-5 on a different round that has at least one score recorded. Expected: deletion succeeds (no FK violation in the server logs), confirming the `onDelete: "cascade"` on `scores.roundId` and `round_group_assignments.roundId` does its job. If the API server logs a 500 with a foreign-key error, stop and investigate before proceeding.

- [ ] **Step 7: Verify the Save Setup button still works**

Open another round, change a value on the Setup tab (e.g., toggle a game on/off), and click **Save Setup**. Expected: it saves as before — the layout change must not have regressed it.

---

## Self-review

**Spec coverage:**
- Trash icon, left side, bottom of Setup tab → Task 2.
- AlertDialog confirmation with the exact title and description from the spec → Task 2.
- Cancel default + destructive Delete with "Deleting…" pending state → Task 2.
- `useDeleteRound` mutation, invalidate trip rounds query, navigate to `/trips/:tripId` → Task 1 step 5.
- No double-confirmation, no soft delete → reflected by the simple AlertDialog in Task 2.
- Only file touched: `round.tsx` → confirmed.

**Placeholder scan:** No TBDs, every code block is complete, every command has expected output, file paths are exact.

**Type consistency:** `handleDeleteRound`, `deleteRound` (mutation), `useDeleteRound`, `getListRoundsQueryKey`, `getGetTripLeaderboardQueryKey`, `Trash2`, and all AlertDialog primitives are used with the same names everywhere they appear.
