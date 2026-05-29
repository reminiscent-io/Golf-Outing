// Offline-first score sync.
//
// Golf is played in places with patchy cell service. When a player taps in a
// score while offline (or on a flaky connection), we must never lose it. This
// module keeps a durable queue of pending score writes in localStorage and
// replays them against the API whenever connectivity returns.
//
// The server's score endpoints are idempotent upserts keyed by
// (round, player, hole) / (round, group, side, hole), so replaying a queued
// write any number of times is safe. We dedupe entries by that same key with
// last-write-wins semantics, so re-entering a hole simply overwrites the
// pending value rather than queueing a second write.
//
// The queue is the source of truth for *unsynced* entries: the round page
// overlays it on top of the server's data so the grid reflects what the player
// typed even across an offline page reload, and even before the write reaches
// the server.

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  upsertScore,
  upsertScrambleScore,
  getGetScoresQueryKey,
  getGetScrambleScoresQueryKey,
  getGetRoundLeaderboardQueryKey,
  getGetTripLeaderboardQueryKey,
  ApiError,
} from "@workspace/api-client-react";
import type { UpsertScrambleScoreBody } from "@workspace/api-client-react";

const STORAGE_KEY = "offline:scores:v1";
const RETRY_INTERVAL_MS = 20_000;

export type PendingScore = {
  type: "score";
  tripId: number;
  roundId: number;
  playerId: number;
  hole: number; // 1-18
  score: number | null;
  updatedAt: number;
};

export type PendingScramble = {
  type: "scramble";
  tripId: number;
  roundId: number;
  groupNumber: number;
  teamSide: UpsertScrambleScoreBody["teamSide"];
  hole: number; // 1-18
  score: number | null;
  updatedAt: number;
};

export type PendingEntry = PendingScore | PendingScramble;
type Queue = Record<string, PendingEntry>;

type Snapshot = {
  queue: Queue;
  online: boolean;
  pendingCount: number;
  syncing: boolean;
};

function scoreKey(tripId: number, roundId: number, playerId: number, hole: number): string {
  return `s:${tripId}:${roundId}:${playerId}:${hole}`;
}

function scrambleKey(
  tripId: number,
  roundId: number,
  groupNumber: number,
  teamSide: string,
  hole: number,
): string {
  return `m:${tripId}:${roundId}:${groupNumber}:${teamSide}:${hole}`;
}

function loadQueue(): Queue {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") return parsed as Queue;
  } catch {
    // Corrupt or unavailable storage — start fresh rather than crashing.
  }
  return {};
}

function persist(queue: Queue) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch {
    // Out of quota / private mode — the in-memory queue still works for this
    // session, we just can't survive a reload. Nothing else to do.
  }
}

// ---- Module-level store ----------------------------------------------------

let queue: Queue = typeof window !== "undefined" ? loadQueue() : {};
let online = typeof navigator !== "undefined" ? navigator.onLine : true;
let syncing = false;
let snapshot: Snapshot = computeSnapshot();
const listeners = new Set<() => void>();
const syncedCallbacks = new Set<() => void>();

function computeSnapshot(): Snapshot {
  return { queue, online, pendingCount: Object.keys(queue).length, syncing };
}

function emit() {
  snapshot = computeSnapshot();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Snapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: Snapshot = { queue: {}, online: true, pendingCount: 0, syncing: false };
function getServerSnapshot(): Snapshot {
  return SERVER_SNAPSHOT;
}

/** Register a callback fired after one or more queued writes successfully sync. */
export function onSynced(cb: () => void): () => void {
  syncedCallbacks.add(cb);
  return () => syncedCallbacks.delete(cb);
}

function removeIfUnchanged(key: string, updatedAt: number) {
  const current = queue[key];
  if (current && current.updatedAt === updatedAt) {
    const { [key]: _removed, ...rest } = queue;
    queue = rest;
  }
}

/**
 * Replay every queued write against the API. Safe to call repeatedly; a single
 * flush runs at a time. Network failures stop the run (we're offline) and leave
 * the remaining entries queued for the next attempt. Permanent client errors
 * (4xx that won't change on retry) drop the offending entry so it can't wedge
 * the queue forever.
 */
export async function flush(): Promise<void> {
  if (syncing) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  if (Object.keys(queue).length === 0) return;

  syncing = true;
  emit();
  let changed = false;
  try {
    // Replay in the order writes were made so the final state is deterministic.
    const ordered = Object.entries(queue).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key, entry] of ordered) {
      const current = queue[key];
      if (!current || current.updatedAt !== entry.updatedAt) continue; // superseded
      try {
        if (current.type === "score") {
          await upsertScore(current.tripId, current.roundId, {
            playerId: current.playerId,
            hole: current.hole,
            score: current.score,
          });
        } else {
          await upsertScrambleScore(current.tripId, current.roundId, {
            groupNumber: current.groupNumber,
            teamSide: current.teamSide,
            hole: current.hole,
            score: current.score,
          });
        }
        removeIfUnchanged(key, entry.updatedAt);
        changed = true;
      } catch (err) {
        if (err instanceof ApiError) {
          // 408 (timeout), 429 (rate limit) and 5xx are transient — keep the
          // entry and back off. 401/403 may resolve once auth is refreshed, so
          // keep those too. Any other 4xx means the write is malformed or no
          // longer valid; drop it so it can't block the rest of the queue.
          const retryable =
            err.status >= 500 ||
            err.status === 408 ||
            err.status === 429 ||
            err.status === 401 ||
            err.status === 403;
          if (retryable) break;
          removeIfUnchanged(key, entry.updatedAt);
          changed = true;
          continue;
        }
        // Network error (fetch threw) — we've lost connectivity. Stop and retry
        // later; everything still queued is preserved.
        break;
      }
    }
  } finally {
    syncing = false;
    if (changed) {
      persist(queue);
      syncedCallbacks.forEach((c) => c());
    }
    emit();
  }
}

/** Queue (or overwrite) a stroke-play score write and kick off a sync attempt. */
export function enqueueScore(input: {
  tripId: number;
  roundId: number;
  playerId: number;
  hole: number;
  score: number | null;
}) {
  const key = scoreKey(input.tripId, input.roundId, input.playerId, input.hole);
  queue = { ...queue, [key]: { ...input, type: "score", updatedAt: Date.now() } };
  persist(queue);
  emit();
  void flush();
}

/** Queue (or overwrite) a scramble team score write and kick off a sync attempt. */
export function enqueueScramble(input: {
  tripId: number;
  roundId: number;
  groupNumber: number;
  teamSide: UpsertScrambleScoreBody["teamSide"];
  hole: number;
  score: number | null;
}) {
  const key = scrambleKey(input.tripId, input.roundId, input.groupNumber, input.teamSide, input.hole);
  queue = { ...queue, [key]: { ...input, type: "scramble", updatedAt: Date.now() } };
  persist(queue);
  emit();
  void flush();
}

// Wire up connectivity listeners and a periodic retry once, at module load.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    online = true;
    emit();
    void flush();
  });
  window.addEventListener("offline", () => {
    online = false;
    emit();
  });
  // Catch transient failures that navigator.onLine misses (e.g. connected to a
  // captive WiFi with no real internet): periodically retry while anything is
  // pending.
  setInterval(() => {
    if (Object.keys(queue).length > 0) void flush();
  }, RETRY_INTERVAL_MS);
  // Replay anything left over from a previous session.
  void flush();
}

// ---- React hook ------------------------------------------------------------

export type RoundPendingScores = Map<number, Map<number, number | null>>; // playerId -> holeIdx(0-based) -> score
export type RoundPendingScramble = Map<string, Map<number, number | null>>; // "group:side" -> holeIdx -> score

export type OfflineSync = {
  /** Browser connectivity (navigator.onLine). */
  online: boolean;
  /** A sync attempt is currently in flight. */
  syncing: boolean;
  /** Unsynced writes for this round. */
  pendingCount: number;
  /** Unsynced stroke-play scores, overlaid on server data by the grid. */
  pendingScores: RoundPendingScores;
  /** Unsynced scramble scores, overlaid on server data by the grid. */
  pendingScramble: RoundPendingScramble;
  enqueueScore: (input: { playerId: number; hole: number; score: number | null }) => void;
  enqueueScramble: (input: {
    groupNumber: number;
    teamSide: UpsertScrambleScoreBody["teamSide"];
    hole: number;
    score: number | null;
  }) => void;
};

/**
 * Subscribe a round page to the offline queue. Returns the pending overlays for
 * this round plus enqueue helpers, and keeps the React Query cache fresh by
 * invalidating score/leaderboard queries whenever queued writes land.
 */
export function useOfflineSync(tripId: number, roundId: number): OfflineSync {
  const queryClient = useQueryClient();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    const off = onSynced(() => {
      queryClient.invalidateQueries({ queryKey: getGetScoresQueryKey(tripId, roundId) });
      queryClient.invalidateQueries({ queryKey: getGetScrambleScoresQueryKey(tripId, roundId) });
      queryClient.invalidateQueries({ queryKey: getGetRoundLeaderboardQueryKey(tripId, roundId) });
      queryClient.invalidateQueries({ queryKey: getGetTripLeaderboardQueryKey(tripId) });
    });
    // Try to drain anything pending for this round as soon as we mount.
    void flush();
    return off;
  }, [queryClient, tripId, roundId]);

  const pendingScores: RoundPendingScores = new Map();
  const pendingScramble: RoundPendingScramble = new Map();
  let pendingCount = 0;
  for (const entry of Object.values(snap.queue)) {
    if (entry.tripId !== tripId || entry.roundId !== roundId) continue;
    pendingCount++;
    if (entry.type === "score") {
      let m = pendingScores.get(entry.playerId);
      if (!m) {
        m = new Map();
        pendingScores.set(entry.playerId, m);
      }
      m.set(entry.hole - 1, entry.score);
    } else {
      const k = `${entry.groupNumber}:${entry.teamSide}`;
      let m = pendingScramble.get(k);
      if (!m) {
        m = new Map();
        pendingScramble.set(k, m);
      }
      m.set(entry.hole - 1, entry.score);
    }
  }

  const enqueueScoreCb = useCallback(
    (input: { playerId: number; hole: number; score: number | null }) =>
      enqueueScore({ tripId, roundId, ...input }),
    [tripId, roundId],
  );
  const enqueueScrambleCb = useCallback(
    (input: {
      groupNumber: number;
      teamSide: UpsertScrambleScoreBody["teamSide"];
      hole: number;
      score: number | null;
    }) => enqueueScramble({ tripId, roundId, ...input }),
    [tripId, roundId],
  );

  return {
    online: snap.online,
    syncing: snap.syncing,
    pendingCount,
    pendingScores,
    pendingScramble,
    enqueueScore: enqueueScoreCb,
    enqueueScramble: enqueueScrambleCb,
  };
}
