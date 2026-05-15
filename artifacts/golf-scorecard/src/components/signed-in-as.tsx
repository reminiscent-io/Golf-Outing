import { useTripIdentity, clearTripIdentity } from "@/lib/trip-identity";

export function SignedInAs({ tripId }: { tripId: number }) {
  const identity = useTripIdentity(tripId);
  if (!identity) return null;
  const label = identity.kind === "player" ? identity.playerName : "Observing";
  return (
    <div className="text-xs font-sans flex items-center gap-2" style={{ color: "hsl(42 25% 60%)" }}>
      <span>Signed in as <strong style={{ color: "hsl(42 52% 59%)" }}>{label}</strong></span>
      <span>·</span>
      <button
        onClick={() => clearTripIdentity(tripId)}
        className="underline hover:opacity-80"
        style={{ color: "hsl(42 35% 65%)" }}
      >
        switch
      </button>
    </div>
  );
}
