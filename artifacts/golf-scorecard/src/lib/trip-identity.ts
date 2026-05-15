import { useEffect, useState } from "react";

export type TripIdentity =
  | { kind: "player"; playerId: number; playerName: string }
  | { kind: "observer" };

const key = (tripId: number) => `auth:trip:${tripId}`;

function readIdentity(tripId: number): TripIdentity | null {
  try {
    const raw = localStorage.getItem(key(tripId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.kind === "observer") return { kind: "observer" };
    // Legacy entries (and new "player" entries): both carry playerId + playerName.
    if (
      typeof parsed.playerId === "number" &&
      typeof parsed.playerName === "string"
    ) {
      return { kind: "player", playerId: parsed.playerId, playerName: parsed.playerName };
    }
    return null;
  } catch {
    return null;
  }
}

export function setTripIdentity(tripId: number, identity: TripIdentity): void {
  localStorage.setItem(key(tripId), JSON.stringify(identity));
  // Trigger storage listeners in the current tab
  window.dispatchEvent(new StorageEvent("storage", { key: key(tripId) }));
}

export function clearTripIdentity(tripId: number): void {
  localStorage.removeItem(key(tripId));
  window.dispatchEvent(new StorageEvent("storage", { key: key(tripId) }));
}

export function useTripIdentity(tripId: number): TripIdentity | null {
  const [identity, setIdentity] = useState<TripIdentity | null>(() => readIdentity(tripId));

  useEffect(() => {
    setIdentity(readIdentity(tripId));
    function onStorage(e: StorageEvent) {
      if (e.key === null || e.key === key(tripId)) {
        setIdentity(readIdentity(tripId));
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [tripId]);

  return identity;
}
