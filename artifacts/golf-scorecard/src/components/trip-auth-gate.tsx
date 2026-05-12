import { useState, useEffect, type ReactNode } from "react";
import {
  useAuthenticateTrip,
  useListPlayers,
  useCreatePlayer,
  getListPlayersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTripIdentity, setTripIdentity } from "@/lib/trip-identity";

type Props = {
  tripId: number;
  children: ReactNode;
};

export function TripAuthGate({ tripId, children }: Props) {
  const identity = useTripIdentity(tripId);
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"probing" | "password" | "identity">("probing");
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | "">("");
  const [showAddSelf, setShowAddSelf] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHcp, setNewHcp] = useState("18");

  const authenticate = useAuthenticateTrip();
  const createPlayer = useCreatePlayer();
  const { data: players } = useListPlayers(tripId, {
    query: {
      queryKey: getListPlayersQueryKey(tripId),
      enabled: step === "identity",
    },
  });

  const noPlayers = step === "identity" && players !== undefined && players.length === 0;

  useEffect(() => {
    if (identity) return;
    authenticate.mutate(
      { tripId, data: { password: "" } },
      {
        onSuccess: () => setStep("identity"),
        onError: () => setStep("password"),
      }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, identity]);

  if (identity) {
    return <>{children}</>;
  }

  if (step === "probing") {
    return null;
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

  function handleAddSelf(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const handicap = parseInt(newHcp, 10);
    createPlayer.mutate(
      { tripId, data: { name, handicap: isNaN(handicap) ? 18 : handicap } },
      {
        onSuccess: (player) => {
          queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(tripId) });
          setTripIdentity(tripId, { playerId: player.id, playerName: player.name });
        },
      }
    );
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
              disabled={authenticate.isPending}
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
          <>
            {/* Player select — hidden when trip has no players yet */}
            {!noPlayers && !showAddSelf && (
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
                <button
                  type="button"
                  onClick={() => setShowAddSelf(true)}
                  className="w-full mt-3 py-2 rounded-lg font-sans text-sm"
                  style={{ background: "transparent", color: "hsl(38 20% 38%)", border: "1.5px dashed hsl(38 25% 72%)" }}
                >
                  I'm not in the list — add me
                </button>
              </form>
            )}

            {/* Inline player creation — shown when trip is empty or "add me" clicked */}
            {(noPlayers || showAddSelf) && (
              <form onSubmit={handleAddSelf}>
                {noPlayers && (
                  <p className="text-xs font-sans mb-4" style={{ color: "hsl(38 20% 38%)" }}>
                    This trip has no players yet. Add yourself to get started.
                  </p>
                )}
                <label className="block text-xs font-sans font-600 uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
                  Your name
                </label>
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
                <label className="block text-xs font-sans font-600 uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
                  Handicap
                </label>
                <input
                  type="number"
                  min={0}
                  max={54}
                  value={newHcp}
                  onChange={e => setNewHcp(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-4"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createPlayer.isPending || !newName.trim()}
                    className="flex-1 py-2.5 rounded-lg font-sans font-600 text-sm disabled:opacity-50"
                    style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
                  >
                    {createPlayer.isPending ? "Adding..." : "Join"}
                  </button>
                  {!noPlayers && (
                    <button
                      type="button"
                      onClick={() => setShowAddSelf(false)}
                      className="px-4 py-2.5 rounded-lg font-sans text-sm"
                      style={{ background: "hsl(42 20% 82%)", color: "hsl(38 30% 18%)" }}
                    >
                      Back
                    </button>
                  )}
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
