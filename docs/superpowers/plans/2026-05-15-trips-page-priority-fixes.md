# /trips Page Priority Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the four priority design issues identified in the `/trips` page critique: silent save action, sub-44px tap targets, label-less saved state, and hostile native delete confirmation.

**Architecture:** Three focused changes to `artifacts/golf-scorecard/src/pages/trips.tsx`, plus one new component (`delete-trip-dialog.tsx`) that wraps the existing shadcn `AlertDialog` in the heritage palette. All wiring is local — no schema, API, or routing changes. The shadcn `Toaster` is already mounted in `App.tsx:124` and `useToast` is unused so far; we'll be its first consumer.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind 4, shadcn/ui (already-installed `Toaster` + `AlertDialog`), Wouter routing, TanStack Query, lucide-react icons. Heritage palette via inline `style={{}}` HSL values (existing convention in this file).

**Verification approach:** This package has no frontend tests and no `vitest.config.*`. Adding a test harness would balloon scope and is out of plan. Each task's verification gate is `pnpm --filter @workspace/golf-scorecard run typecheck` plus a scripted manual browser walkthrough. If frontend tests are wanted later, that's a separate plan.

**Out of scope (filed as follow-ups):**
- [P2] Header density collapse (the redundant Trophy + h1 + tagline + CTA stack). Deferred — not regression-causing, and a real fix needs design choices outside this plan.
- Cascade summary in delete dialog ("This will also delete N rounds and M scores"). Requires either a new API or extra round/score queries — defer until the base modal ships.
- Tokenizing the heritage palette out of inline `style={{}}`. Code-quality cleanup, not a critique finding.
- Empty-state parity with `/me/trips` and the `useEffect [].deps` race in [trips.tsx:60-71](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L60-L71). Worth doing, not priority.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| [artifacts/golf-scorecard/src/components/delete-trip-dialog.tsx](../../../artifacts/golf-scorecard/src/components/delete-trip-dialog.tsx) | **Create** | Heritage-styled wrapper around `AlertDialog` for trip deletion. Owns its own open state via `trip` prop being non-null. |
| [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) | **Modify** | Wire `useToast` for save/unsave/delete feedback. Replace icon-only Save with labeled chip ≥44px tap target. Replace `window.confirm` + opacity-0 Delete with always-visible button that opens the new dialog. |

Each task below is one shippable commit. Tasks are ordered so each can ship independently if the engineer needs to stop early.

---

## Task 1: Save success toast with "View" action

**Goal:** When a user taps Save (or Unsave), a toast confirms the action. The Save toast carries a "View" action button that navigates to `/me/trips`. Failures show an error toast.

**Files:**
- Modify: [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) (imports + `handleSaveToggle`)

- [ ] **Step 1: Add toast imports**

In [trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx), at the top with the other `@/` imports (after the `SignInModal` import on line 16), add:

```tsx
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
```

- [ ] **Step 2: Pull `toast` from the hook in the component body**

In `TripsPage` (currently around [trips.tsx:18-22](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L18-L22)), add a hook call right after the existing hook calls. The block should look like:

```tsx
export default function TripsPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const { toast } = useToast();
  const { data: trips, isLoading } = useListTrips();
  const createTrip = useCreateTrip();
  const deleteTrip = useDeleteTrip();
  // ... unchanged ...
```

- [ ] **Step 3: Replace `handleSaveToggle` with toast-driven version**

Replace the current `handleSaveToggle` (lines [40-55](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L40-L55)) with:

```tsx
function handleSaveToggle(tripId: number, tripName: string, e: React.MouseEvent) {
  e.stopPropagation();
  if (!session) {
    setSignInOpen(true);
    return;
  }
  const via = myTripsByTripId.get(tripId);
  const isSaved = via === "saved" || via === "both";
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() });

  if (isSaved) {
    unsaveTrip.mutate(
      { tripId },
      {
        onSuccess: () => {
          invalidate();
          toast({ description: `Removed "${tripName}" from My Trips` });
        },
        onError: () => {
          toast({
            variant: "destructive",
            description: "Couldn't remove that trip. Try again?",
          });
        },
      }
    );
  } else {
    saveTrip.mutate(
      { tripId },
      {
        onSuccess: () => {
          invalidate();
          toast({
            description: `Saved "${tripName}" to My Trips`,
            action: (
              <ToastAction altText="View My Trips" onClick={() => navigate("/me/trips")}>
                View
              </ToastAction>
            ),
          });
        },
        onError: () => {
          toast({
            variant: "destructive",
            description: "Couldn't save that trip. Try again?",
          });
        },
      }
    );
  }
}
```

Note the new `tripName` parameter — we need it for the toast text.

- [ ] **Step 4: Update the save button's `onClick` to pass the trip name**

In the trip card rendering block (currently around [trips.tsx:217](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L217)), change:

```tsx
onClick={e => handleSaveToggle(trip.id, e)}
```

to:

```tsx
onClick={e => handleSaveToggle(trip.id, trip.name, e)}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: clean exit, no errors.

If `useToast` or `ToastAction` is missing, verify the imports resolve to [`src/hooks/use-toast.ts`](../../../artifacts/golf-scorecard/src/hooks/use-toast.ts) and [`src/components/ui/toast.tsx`](../../../artifacts/golf-scorecard/src/components/ui/toast.tsx). Both exist — no install needed.

- [ ] **Step 6: Manual verification**

Start the API server and the scorecard app (separate terminals — both need `PORT` and the API needs `DATABASE_URL`):

```bash
PORT=8081 pnpm --filter @workspace/api-server run dev
PORT=8080 pnpm --filter @workspace/golf-scorecard run dev
```

Open http://localhost:8080/trips. Sign in if needed (dev OTP code is `000000` when Twilio env is unset). Verify all four cases:

1. **Save success:** Tap an unsaved trip's bookmark → toast appears with `Saved "<trip name>" to My Trips` and a "View" button → tapping View navigates to `/me/trips` and the trip is in the list.
2. **Unsave success:** From a saved trip, tap the bookmark again → toast appears with `Removed "<trip name>" from My Trips`. No View action.
3. **Save failure:** With devtools open, throttle to "Offline" or block `POST /api/me/saved-trips`, tap save → destructive toast appears: `Couldn't save that trip. Try again?`. The bookmark icon does NOT flip to the saved state.
4. **Sign-in gate still works:** Sign out, tap bookmark → SignInModal opens, no toast fires.

If the toast looks visually off-brand (it inherits `bg-background` from shadcn defaults), note this and address in Task 4 polish — do not block this task on it.

- [ ] **Step 7: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/trips.tsx
git commit -m "Add toast feedback for save/unsave on /trips with link to My Trips"
```

---

## Task 2: Save button as labeled chip with 44px tap target

**Goal:** Replace the icon-only 28px save button with a labeled chip that meets the 44px minimum touch target. The chip shows `Bookmark + Save` when unsaved and `BookmarkCheck + Saved` when saved, so state is encoded by icon AND label, not just inverted color.

**Files:**
- Modify: [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) (the `{showSave && (...)}` block)

- [ ] **Step 1: Replace the save button block**

In the trip card render (currently [trips.tsx:215-229](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L215-L229)), replace the entire `{showSave && (...)}` block with:

```tsx
{showSave && (
  <button
    onClick={e => handleSaveToggle(trip.id, trip.name, e)}
    disabled={saveTrip.isPending || unsaveTrip.isPending}
    aria-label={isSaved ? "Remove from My Trips" : "Save to My Trips"}
    aria-pressed={isSaved}
    className="inline-flex items-center gap-1.5 px-2.5 py-2 min-h-[44px] rounded-lg text-xs font-sans font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
    style={{
      background: isSaved ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
      color: isSaved ? "hsl(38 30% 12%)" : "hsl(42 52% 59%)",
    }}
  >
    {isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
    <span>{isSaved ? "Saved" : "Save"}</span>
  </button>
)}
```

What changed:
- `min-h-[44px]` enforces the iOS/Android touch-target floor while letting the chip stay visually compact.
- Added a `<span>` with the literal `Save` / `Saved` label — state no longer relies on color alone.
- Added `aria-pressed={isSaved}` for assistive-tech state announcement.
- Removed the `title` tooltip — the visible label replaces it.
- Padding bumped from `p-1.5` to `px-2.5 py-2` to fit the label without crowding.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: clean exit.

- [ ] **Step 3: Manual verification**

With the dev servers from Task 1 still running, reload http://localhost:8080/trips:

1. **Touch target:** In Chrome devtools, switch to mobile emulation (e.g. iPhone 14 Pro). Hover the save chip — the inspector should report a height ≥44px.
2. **Labels render correctly:** Find an unsaved trip — chip reads `Save`. Tap it — chip should immediately read `Saved` after the mutation lands.
3. **Color reads as a state, not a press:** With at least one saved and one unsaved trip visible, the brass `Saved` chips and forest `Save` chips should be obviously different at a glance, with the label confirming which is which.
4. **No layout regression:** The trip card row should not wrap to two lines on a 375px-wide viewport. If it does, the Delete + Chevron cluster on the right needs trimming — defer to Task 3.
5. **Screen reader:** With VoiceOver / NVDA, focus the chip — should announce `Save to My Trips, button, not pressed` (or `Remove from My Trips, button, pressed`).

- [ ] **Step 4: Commit**

```bash
git add artifacts/golf-scorecard/src/pages/trips.tsx
git commit -m "Promote /trips save button to labeled chip with 44px tap target"
```

---

## Task 3: Heritage-styled delete confirmation dialog

**Goal:** Replace the `window.confirm("Delete this trip?")` call with a heritage-styled `AlertDialog` that names the trip being deleted and warns about cascading data loss. Make Delete always visible (drop the `opacity-0` mobile-invisibility trap) but visually subordinate to Save.

**Files:**
- Create: [artifacts/golf-scorecard/src/components/delete-trip-dialog.tsx](../../../artifacts/golf-scorecard/src/components/delete-trip-dialog.tsx)
- Modify: [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) (imports, state, `handleDelete`, delete button render)

- [ ] **Step 1: Create the dialog component**

Create [artifacts/golf-scorecard/src/components/delete-trip-dialog.tsx](../../../artifacts/golf-scorecard/src/components/delete-trip-dialog.tsx) with:

```tsx
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Trip = { id: number; name: string };

type Props = {
  trip: Trip | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (tripId: number) => void;
};

export function DeleteTripDialog({ trip, pending, onCancel, onConfirm }: Props) {
  const open = trip !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && !pending) onCancel();
      }}
    >
      <AlertDialogContent
        className="border-0 shadow-2xl"
        style={{ background: "hsl(42 45% 91%)", color: "hsl(38 30% 14%)" }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle
            className="font-serif text-xl"
            style={{ color: "hsl(38 30% 14%)" }}
          >
            Delete "{trip?.name ?? ""}"?
          </AlertDialogTitle>
          <AlertDialogDescription
            className="font-sans text-sm"
            style={{ color: "hsl(38 20% 38%)" }}
          >
            This permanently deletes the trip along with every round, score, and
            player record attached to it. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-4 py-2.5 rounded-lg font-sans text-sm font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: "hsl(42 20% 82%)", color: "hsl(38 30% 18%)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => trip && onConfirm(trip.id)}
            disabled={pending || !trip}
            className="px-4 py-2.5 rounded-lg font-sans text-sm font-semibold transition-opacity hover:opacity-85 disabled:opacity-60"
            style={{ background: "hsl(0 55% 38%)", color: "hsl(42 45% 95%)" }}
          >
            {pending ? "Deleting..." : "Delete trip"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Notes:
- We deliberately skip `AlertDialogAction` / `AlertDialogCancel` and use plain buttons. Those wrappers force `buttonVariants()` styles that conflict with the heritage palette; the underlying Radix `AlertDialog.Root` still owns the focus-trap and Escape-to-close behavior.
- `border-0` removes the shadcn default border so the cream background reads cleanly.
- The `hsl(0 55% 38%)` danger red is a deeper, less-shrill red than the original [trips.tsx:233](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L233) `hsl(0 45% 45%)` — high contrast against the cream surface and visually weighted as "do not tap by accident".
- `onOpenChange` ignores close attempts while a delete is in flight to prevent dismissing mid-mutation.

- [ ] **Step 2: Wire the dialog into trips.tsx — imports**

In [trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx), add to the `@/` imports:

```tsx
import { DeleteTripDialog } from "@/components/delete-trip-dialog";
```

- [ ] **Step 3: Replace the delete state and handler**

Add a state hook below the existing `signInOpen` state (currently around [trips.tsx:27](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L27)):

```tsx
const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
```

Replace the existing `handleDelete` (currently [trips.tsx:89-96](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L89-L96)) with:

```tsx
function handleDeleteClick(trip: { id: number; name: string }, e: React.MouseEvent) {
  e.stopPropagation();
  setDeleteTarget(trip);
}

function handleDeleteConfirm(id: number) {
  deleteTrip.mutate(
    { tripId: id },
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() });
        setDeleteTarget(null);
        toast({ description: "Trip deleted" });
      },
      onError: () => {
        toast({
          variant: "destructive",
          description: "Couldn't delete that trip. Try again?",
        });
      },
    }
  );
}
```

Note we also invalidate `getListMyTripsQueryKey()` here — deleting a trip you'd previously saved should remove it from `/me/trips` too.

- [ ] **Step 4: Replace the delete button render and add the dialog**

In the trip card render, replace the current Delete button (currently [trips.tsx:230-236](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L230-L236)) with:

```tsx
<button
  onClick={e => handleDeleteClick({ id: trip.id, name: trip.name }, e)}
  aria-label={`Delete ${trip.name}`}
  className="p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg transition-opacity hover:opacity-100"
  style={{ color: "hsl(0 45% 45%)", opacity: 0.55 }}
>
  <Trash2 size={16} />
</button>
```

What changed:
- Always visible (no more `opacity-0 group-hover:opacity-60`). Kept visually subordinate via `opacity: 0.55`, so it doesn't compete with Save.
- 44×44 minimum tap area.
- Triggers a state-driven dialog instead of `window.confirm`.
- Removed the `group-hover` plumbing — no longer needed. The parent `group` className on the card can stay; nothing else uses it but it's harmless.

Then, just before the closing `</div>` of the page's main wrapper (currently the `<div className="max-w-lg mx-auto px-6 py-6">`, right before its closing `</div>` near [trips.tsx:266](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L266)), mount the dialog:

```tsx
<DeleteTripDialog
  trip={deleteTarget}
  pending={deleteTrip.isPending}
  onCancel={() => setDeleteTarget(null)}
  onConfirm={handleDeleteConfirm}
/>
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @workspace/golf-scorecard run typecheck`
Expected: clean exit.

- [ ] **Step 6: Manual verification**

With dev servers running:

1. **Dialog opens with correct content:** Tap Delete on a trip → dialog opens centered, cream background, serif title `Delete "<trip name>"?`, sans-serif description warning about cascading deletion, brass-ink Cancel + deep red Delete trip buttons.
2. **Cancel paths:** Tap Cancel → dialog closes, no mutation. Tap the dimmed backdrop → closes. Press Escape → closes. None of these should fire a delete.
3. **Confirm deletes:** Create a throwaway trip (use the New Trip button), then delete it via the dialog → trip disappears from the list, success toast appears: `Trip deleted`.
4. **Pending state:** Throttle network or add a server delay, tap Delete trip → button text becomes `Deleting...`, both buttons disable, backdrop/Escape no longer dismiss. After the mutation lands, dialog closes.
5. **Error path:** Block `DELETE /api/trips/<id>` in devtools, attempt delete → destructive toast `Couldn't delete that trip. Try again?`, dialog stays open so user can retry or cancel.
6. **Cross-page invalidation:** Save a trip first, then delete it from `/trips` → navigate to `/me/trips`, the deleted trip should be gone (no stale cache).
7. **Mobile reachability:** In iPhone emulation, the Delete button is plainly visible at ~55% opacity, large enough to tap, and obviously different from the brass Save chip.

- [ ] **Step 7: Commit**

```bash
git add artifacts/golf-scorecard/src/components/delete-trip-dialog.tsx artifacts/golf-scorecard/src/pages/trips.tsx
git commit -m "Replace window.confirm delete with heritage AlertDialog and toast feedback"
```

---

## Task 4: Polish and final verification

**Goal:** Sweep the file for nits surfaced during the work, then run the whole-page check.

**Files:**
- Modify (possibly): [artifacts/golf-scorecard/src/pages/trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx)

- [ ] **Step 1: Audit toast theming**

Open `/trips` in the browser, fire each kind of toast (save, unsave, save error, delete success, delete error). The shadcn `Toaster` defaults to `bg-background`, which under the heritage palette resolves via `next-themes`. Verify:

- Toasts are readable on the heritage background.
- The "View" action button is visible and tappable.
- Destructive toasts are obviously red/warning.

If any of those fail, override the toast styles by passing a `className` to each `toast()` call (e.g. `className: "bg-[hsl(38_30%_14%)] text-[hsl(42_45%_91%)] border-[hsl(42_52%_59%)]"`). Don't change the global `Toaster` config — keep this scoped to /trips for now.

- [ ] **Step 2: Verify the full /trips matrix**

Walk through every state on a 375px viewport:

| State | Expected |
|---|---|
| Signed-out, no trips | New Trip CTA visible. No save/delete chips on cards. |
| Signed-out, trips exist | Tapping bookmark on a card opens SignInModal. |
| Signed-in, trips exist | Save chip + Delete button on every non-player card. Player cards show no Save (only Delete). |
| Signed-in, in middle of save mutation | Save chip is `disabled` (50% opacity), no double-fire. |
| Loading | Three forest-tile skeleton rows. |
| Empty | "No trips yet" placeholder. |

- [ ] **Step 3: Final typecheck and build**

```bash
pnpm --filter @workspace/golf-scorecard run typecheck
pnpm --filter @workspace/golf-scorecard run build
```

Both should exit clean. The `build` is the meaningful gate — Vite will catch import-resolution issues that `tsc --noEmit` doesn't always surface.

- [ ] **Step 4: Confirm the orphaned `group` className**

Search [trips.tsx](../../../artifacts/golf-scorecard/src/pages/trips.tsx) for the card's `group` className (originally on the trip card div around [trips.tsx:198](../../../artifacts/golf-scorecard/src/pages/trips.tsx#L198)). Since Task 3 removed the `group-hover` consumer, the `group` class is now load-bearing for nothing. Delete it from the card's className.

- [ ] **Step 5: Commit any polish edits**

If Step 1 added toast styling, or Step 4 removed the `group` class, commit them:

```bash
git add artifacts/golf-scorecard/src/pages/trips.tsx
git commit -m "Polish toast styling and remove unused group className on /trips"
```

If neither step required edits, skip this commit.

- [ ] **Step 6: Re-run the critique to verify score movement**

```
$impeccable critique artifacts/golf-scorecard/src/pages/trips.tsx
```

Expected score deltas (relative to the 17/40 baseline):
- Visibility of System Status: 1 → 3 (toast feedback wired)
- User Control and Freedom: 2 → 3 (custom dialog with proper escape paths)
- Error Prevention: 1 → 3 (no more 28px destructive button next to a 28px benign one)
- Recognition Rather Than Recall: 2 → 3 (labeled save chip, named trip in delete dialog)
- Error Recovery: 0 → 2 (error toasts replace silent re-enable)
- Help and Documentation: 1 → 2 (visible labels are inline help)

Target: 17/40 → ~26-28/40 (Above-average band). If the score doesn't move at least +6, something in the implementation diverged from the plan — investigate before merging.

---

## Self-Review

Spec coverage check against the four critique priorities:

- [P0] Save success has no feedback / no path to `/me/trips` → **Task 1** (toast with View action). NavBar "My Trips" link already exists, so the path was reachable; the silence was the actual failure.
- [P0] Save (28px) + Delete (28px, opacity-0) tap targets → **Task 2** (Save chip ≥44px) + **Task 3** (Delete ≥44px, always visible).
- [P1] Saved-state communicated only by icon swap + inverted color → **Task 2** (label `Save` / `Saved` added; aria-pressed too).
- [P1] Native `window.confirm` for cascading destructive action → **Task 3** (heritage AlertDialog with named trip and warning copy).

No unaddressed priority issues. P2 (header density) is explicitly out-of-scope and filed in the header.

Type consistency check: `Trip` type used in `delete-trip-dialog.tsx` is a structural `{ id: number; name: string }` — matches what `trips.tsx` passes. `handleSaveToggle` signature changed from `(tripId, e)` to `(tripId, tripName, e)` — only one call site, updated in Task 1 Step 4. `handleDelete` was renamed to `handleDeleteClick`/`handleDeleteConfirm`; the only call site is the delete button, updated in Task 3 Step 4. No dangling references.

Placeholder scan: no TBDs, no "implement later", every code step shows full code.
