import { useState, type ReactNode } from "react";
import {
  useListPlayers,
  useCreatePlayer,
  useUpdatePlayer,
  useUpdateMe,
  useSaveTrip,
  getListPlayersQueryKey,
  getListMyTripsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTripIdentity, setTripIdentity } from "@/lib/trip-identity";
import { useAuthSession, updateSessionUser } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";

function parseHandicap(raw: string): number {
  const v = parseFloat(raw);
  if (isNaN(v)) return 18;
  return Math.round(v * 10) / 10;
}

function formatHandicap(h: number | null | undefined): string {
  if (h == null) return "";
  return (Math.round(h * 10) / 10).toFixed(1);
}

type Props = {
  tripId: number;
  children: ReactNode;
};

export function TripAuthGate({ tripId, children }: Props) {
  const session = useAuthSession();
  const identity = useTripIdentity(tripId);
  const queryClient = useQueryClient();

  const [selectedPlayerId, setSelectedPlayerId] = useState<number | "">("");
  const [showAddSelf, setShowAddSelf] = useState(false);
  const [newName, setNewName] = useState("");
  const [newHcp, setNewHcp] = useState(() => formatHandicap(session?.user.handicap));

  const createPlayer = useCreatePlayer();
  const updatePlayer = useUpdatePlayer();
  const updateMe = useUpdateMe();
  const saveTrip = useSaveTrip();
  const { data: players } = useListPlayers(tripId, {
    query: {
      queryKey: getListPlayersQueryKey(tripId),
      enabled: !!session,
    },
  });

  // Identity is set after sign-in (per-trip). Pass-through.
  if (identity) {
    return <>{children}</>;
  }

  // If not signed in, force the mandatory sign-in modal first.
  if (!session) {
    return (
      <div className="min-h-screen" style={{ background: "hsl(158 65% 9%)" }}>
        <SignInModal open onSignedIn={() => { /* state will re-render */ }} title="Sign in to join this trip" />
      </div>
    );
  }

  // Signed in but no per-trip identity yet — pick or add player.
  const noPlayers = players !== undefined && players.length === 0;

  function handleIdentitySubmit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedPlayerId === "" || !players) return;
    const player = players.find(p => p.id === selectedPlayerId);
    if (!player) return;
    // Claim the player row for this user if not already linked.
    if (player.userId == null) {
      updatePlayer.mutate(
        { tripId, playerId: player.id, data: {} },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(tripId) });
          },
        }
      );
    }
    setTripIdentity(tripId, { kind: "player", playerId: player.id, playerName: player.name });
  }

  function handleJustWatch() {
    // Auto-bookmark so the trip shows up in /me/trips later. Failure is non-fatal.
    saveTrip.mutate(
      { tripId },
      {
        onSettled: () => {
          queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() });
        },
      }
    );
    setTripIdentity(tripId, { kind: "observer" });
  }

  function handleAddSelf(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const handicap = parseHandicap(newHcp);
    createPlayer.mutate(
      { tripId, data: { name, handicap } },
      {
        onSuccess: (player) => {
          queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(tripId) });
          setTripIdentity(tripId, { kind: "player", playerId: player.id, playerName: player.name });
        },
      }
    );
    // Always sync the entered handicap back to the user's profile so future joins autofill it.
    if (session && handicap !== session.user.handicap) {
      updateMe.mutate(
        { data: { handicap } },
        {
          onSuccess: (user) => updateSessionUser({ handicap: user.handicap }),
        }
      );
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: "hsl(158 65% 9%)" }}>
      <div className="w-full max-w-sm rounded-xl p-6" style={{ background: "hsl(42 45% 91%)" }}>
        <h2 className="text-xl font-serif mb-1" style={{ color: "hsl(38 30% 14%)" }}>
          Who are you?
        </h2>
        <p className="text-xs font-sans mb-4" style={{ color: "hsl(38 20% 38%)" }}>
          Signed in as {session.user.fullName}.
        </p>

        {/* Player select — hidden when trip has no players yet */}
        {!noPlayers && !showAddSelf && (
          <form onSubmit={handleIdentitySubmit}>
            <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
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
              className="w-full py-2.5 rounded-lg font-sans font-semibold text-sm disabled:opacity-50"
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
            <button
              type="button"
              onClick={handleJustWatch}
              className="w-full mt-2 py-2 font-sans text-xs hover:opacity-80 transition-opacity"
              style={{ background: "transparent", color: "hsl(38 20% 38%)" }}
            >
              Just watching — don't add me as a player
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
            <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Your name in this trip
            </label>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder={session.user.fullName}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            />
            <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Handicap
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={54}
              placeholder="18"
              value={newHcp}
              onChange={e => setNewHcp(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-4"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createPlayer.isPending || !newName.trim()}
                className="flex-1 py-2.5 rounded-lg font-sans font-semibold text-sm disabled:opacity-50"
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
      </div>
    </div>
  );
}
