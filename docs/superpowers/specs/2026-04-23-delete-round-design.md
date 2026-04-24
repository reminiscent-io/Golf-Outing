# Delete Round — Design

## Goal

Let a user delete a round from the round page's Setup tab, with a confirmation dialog, and route them back to the trip hub afterward.

## Background

The API already exposes `DELETE /trips/:tripId/rounds/:roundId` ([rounds.ts:117](../../../artifacts/api-server/src/routes/rounds.ts#L117)) and the generated client ships `useDeleteRound` ([api.ts:1310](../../../lib/api-client-react/src/generated/api.ts#L1310)). The schema has `onDelete: "cascade"` on both `scores.roundId` and `round_group_assignments.roundId`, so deleting a round cleans up its dependents automatically — no server changes needed.

## UI

In [round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx), the Setup tab currently ends with a single full-width "Save Setup" button at line 1021. Replace that button with a horizontal row:

- **Left:** icon-only trash button (`Trash2` from `lucide-react`), square, destructive styling (red-toned outline matching the existing palette). `aria-label="Delete round"`.
- **Right:** the existing "Save Setup" button, taking the remaining width (`flex-1`).

The trash button opens an `AlertDialog` (already available at [components/ui/alert-dialog.tsx](../../../artifacts/golf-scorecard/src/components/ui/alert-dialog.tsx)):

- **Title:** "Delete this round?"
- **Description:** "This will permanently delete the round and all scores. This can't be undone."
- **Cancel action:** "Cancel" (default focus)
- **Confirm action:** "Delete round" (destructive variant). Shows "Deleting…" while the mutation is pending, disabled during pending.

## Behavior

- Use `useDeleteRound` from `@workspace/api-client-react`.
- On success:
  - Invalidate the trip's rounds query so the trip hub list reflects the deletion (mirror the invalidation pattern already used by `handleSaveSetup` for the round query).
  - Navigate to `/trips/${tripId}` via Wouter's `useLocation` setter (already imported in this file).
- On error: keep the dialog open and surface the error using the same toast/inline pattern the page already uses for save errors (read the existing pattern during implementation; do not invent a new one).
- The trash button itself is disabled while either the save or delete mutation is pending, matching the existing `updateRound.isPending` guard.

## Non-goals

- No double-confirmation (no "type the round name to confirm"). The AlertDialog is enough friction for this app.
- No undo / soft delete.
- No bulk delete from the trip hub.
- No permission/role check beyond what already gates the round page (the existing `TripAuthGate` is sufficient for this app's threat model).

## Files touched

- [artifacts/golf-scorecard/src/pages/round.tsx](../../../artifacts/golf-scorecard/src/pages/round.tsx) — only file expected to change.
