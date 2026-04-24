import { useState, type ReactNode } from "react";
import { useAuthenticateTrip, useListPlayers, getListPlayersQueryKey } from "@workspace/api-client-react";
import { useTripIdentity, setTripIdentity } from "@/lib/trip-identity";

type Props = {
  tripId: number;
  children: ReactNode;
};

export function TripAuthGate({ tripId, children }: Props) {
  const identity = useTripIdentity(tripId);
  const [step, setStep] = useState<"password" | "identity">("password");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | "">("");

  const authenticate = useAuthenticateTrip();
  const { data: players } = useListPlayers(tripId, {
    query: {
      queryKey: getListPlayersQueryKey(tripId),
      enabled: step === "identity",
    },
  });

  if (identity) {
    return <>{children}</>;
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    authenticate.mutate(
      { tripId, data: { password } },
      {
        onSuccess: () => setStep("identity"),
        onError: () => setPasswordError("Wrong password. Try again."),
      }
    );
  }

  function handleIdentitySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedPlayerId === "" || !players) return;
    const player = players.find(p => p.id === selectedPlayerId);
    if (!player) return;
    setTripIdentity(tripId, { playerId: player.id, playerName: player.name });
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "hsl(158 65% 9%)" }}>
      <div className="w-full max-w-sm rounded-xl p-6" style={{ background: "hsl(42 45% 91%)" }}>
        <h2 className="text-xl font-serif mb-4" style={{ color: "hsl(38 30% 14%)" }}>
          {step === "password" ? "Trip access" : "Who are you?"}
        </h2>

        {step === "password" && (
          <form onSubmit={handlePasswordSubmit}>
            <label className="block text-xs font-sans font-600 uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Password
            </label>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            />
            {passwordError && (
              <div className="text-xs font-sans mb-3" style={{ color: "hsl(0 55% 40%)" }}>{passwordError}</div>
            )}
            <button
              type="submit"
              disabled={authenticate.isPending}
              className="w-full py-2.5 rounded-lg font-sans font-600 text-sm"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {authenticate.isPending ? "Checking..." : "Continue"}
            </button>
          </form>
        )}

        {step === "identity" && (
          <form onSubmit={handleIdentitySubmit}>
            <label className="block text-xs font-sans font-600 uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Select your name
            </label>
            <select
              autoFocus
              value={selectedPlayerId}
              onChange={e => setSelectedPlayerId(e.target.value === "" ? "" : Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            >
              <option value="">— choose —</option>
              {(players ?? []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button
              type="submit"
              disabled={selectedPlayerId === ""}
              className="w-full py-2.5 rounded-lg font-sans font-600 text-sm disabled:opacity-50"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              Enter
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
