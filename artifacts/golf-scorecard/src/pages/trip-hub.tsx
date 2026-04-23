import { useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTrip,
  useListPlayers,
  useListRounds,
  useGetTripLeaderboard,
  useCreatePlayer,
  useUpdatePlayer,
  useDeletePlayer,
  useCreateRound,
  useDeleteRound,
  getListPlayersQueryKey,
  getListRoundsQueryKey,
  getGetTripLeaderboardQueryKey,
} from "@workspace/api-client-react";
import {
  ArrowLeft, Plus, Trash2, ChevronRight, Trophy, Flag,
  Users, Calendar, Edit3, Check, X
} from "lucide-react";

type Tab = "leaderboard" | "rounds" | "players";

function parseHandicap(raw: string): number {
  const v = parseFloat(raw);
  if (isNaN(v)) return 18;
  return Math.round(v * 10) / 10;
}

function formatHandicap(h: number): string {
  return (Math.round(h * 10) / 10).toFixed(1);
}

export default function TripHubPage() {
  const { tripId: tripIdStr } = useParams<{ tripId: string }>();
  const tripId = Number(tripIdStr);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("rounds");

  const { data: trip, isLoading: tripLoading } = useGetTrip(tripId, { query: { enabled: !!tripId } });
  const { data: players } = useListPlayers(tripId, { query: { enabled: !!tripId } });
  const { data: rounds } = useListRounds(tripId, { query: { enabled: !!tripId } });
  const { data: leaderboard, isLoading: lbLoading } = useGetTripLeaderboard(tripId, {
    query: {
      enabled: !!tripId && tab === "leaderboard",
      refetchInterval: 10000,
    },
  });

  const createPlayer = useCreatePlayer();
  const updatePlayer = useUpdatePlayer();
  const deletePlayer = useDeletePlayer();
  const createRound = useCreateRound();
  const deleteRound = useDeleteRound();

  // Player form state
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [newPlayerHcp, setNewPlayerHcp] = useState("18");
  const [editingPlayerId, setEditingPlayerId] = useState<number | null>(null);
  const [editPlayerName, setEditPlayerName] = useState("");
  const [editPlayerHcp, setEditPlayerHcp] = useState("");

  // Round form state
  const [showAddRound, setShowAddRound] = useState(false);
  const [newRoundName, setNewRoundName] = useState("");
  const [newRoundCourse, setNewRoundCourse] = useState("");
  const [newRoundDate, setNewRoundDate] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [newRoundTeeBox, setNewRoundTeeBox] = useState("");
  const [newRoundRating, setNewRoundRating] = useState("");
  const [newRoundSlope, setNewRoundSlope] = useState("");

  function handleAddPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!newPlayerName.trim()) return;
    createPlayer.mutate(
      { tripId, data: { name: newPlayerName.trim(), handicap: parseHandicap(newPlayerHcp) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(tripId) });
          queryClient.invalidateQueries({ queryKey: getGetTripLeaderboardQueryKey(tripId) });
          setShowAddPlayer(false);
          setNewPlayerName("");
          setNewPlayerHcp("18");
        },
      }
    );
  }

  function handleUpdatePlayer(playerId: number) {
    updatePlayer.mutate(
      { tripId, playerId, data: { name: editPlayerName, handicap: parseHandicap(editPlayerHcp) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(tripId) });
          setEditingPlayerId(null);
        },
      }
    );
  }

  function handleDeletePlayer(playerId: number) {
    if (!confirm("Remove this player?")) return;
    deletePlayer.mutate(
      { tripId, playerId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPlayersQueryKey(tripId) }) }
    );
  }

  function handleAddRound(e: React.FormEvent) {
    e.preventDefault();
    if (!newRoundName.trim()) return;
    const ratingNum = parseFloat(newRoundRating);
    const slopeNum = parseInt(newRoundSlope);
    createRound.mutate(
      {
        tripId,
        data: {
          name: newRoundName.trim(),
          course: newRoundCourse || null,
          date: newRoundDate || null,
          teeBox: newRoundTeeBox.trim() || null,
          courseRating: isNaN(ratingNum) ? null : ratingNum,
          courseSlope: isNaN(slopeNum) ? null : slopeNum,
        },
      },
      {
        onSuccess: (round) => {
          queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey(tripId) });
          setShowAddRound(false);
          setNewRoundName("");
          setNewRoundCourse("");
          setNewRoundDate("");
          setShowAdvanced(false);
          setNewRoundTeeBox("");
          setNewRoundRating("");
          setNewRoundSlope("");
          navigate(`/trips/${tripId}/rounds/${round.id}`);
        },
      }
    );
  }

  function handleDeleteRound(roundId: number, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Delete this round?")) return;
    deleteRound.mutate(
      { tripId, roundId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListRoundsQueryKey(tripId) }) }
    );
  }

  const TABS: { id: Tab; label: string; icon: typeof Trophy }[] = [
    { id: "rounds", label: "Rounds", icon: Flag },
    { id: "leaderboard", label: "Leaderboard", icon: Trophy },
    { id: "players", label: "Players", icon: Users },
  ];

  if (tripLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="px-4 pt-8 pb-5" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            All Trips
          </button>
          <h1 className="text-2xl font-serif" style={{ color: "hsl(42 52% 59%)" }}>
            {trip?.name}
          </h1>
          <div className="flex items-center gap-3 mt-1 text-xs font-sans" style={{ color: "hsl(42 20% 55%)" }}>
            <span>{players?.length ?? 0} players</span>
            <span>·</span>
            <span>{rounds?.length ?? 0} rounds</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-0 z-10" style={{ background: "hsl(158 60% 13%)", borderBottom: "1px solid hsl(158 40% 18%)" }}>
        <div className="max-w-2xl mx-auto px-4 flex gap-0">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-3 text-xs font-sans font-semibold uppercase tracking-widest transition-all"
              style={{
                color: tab === t.id ? "hsl(42 52% 59%)" : "hsl(42 20% 55%)",
                borderBottom: tab === t.id ? "2px solid hsl(42 52% 59%)" : "2px solid transparent",
              }}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-5">

        {/* ROUNDS TAB */}
        {tab === "rounds" && (
          <div className="space-y-3">
            {!showAddRound && (
              <button
                onClick={() => setShowAddRound(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-sans font-semibold transition-all hover:opacity-90"
                style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
              >
                <Plus size={16} />
                New Round
              </button>
            )}
            {showAddRound && (
              <form onSubmit={handleAddRound} className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)" }}>
                <div className="space-y-3 mb-3">
                  <div>
                    <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Round Name *</label>
                    <input
                      autoFocus
                      value={newRoundName}
                      onChange={e => setNewRoundName(e.target.value)}
                      placeholder="Round 1"
                      className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                      style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Course</label>
                      <input
                        value={newRoundCourse}
                        onChange={e => setNewRoundCourse(e.target.value)}
                        placeholder="Pebble Beach"
                        className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                        style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Date</label>
                      <input
                        type="date"
                        value={newRoundDate}
                        onChange={e => setNewRoundDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                        style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-sans font-semibold uppercase tracking-widest"
                    style={{ background: "white", border: "1.5px solid hsl(38 25% 72%)", color: "hsl(38 20% 38%)" }}
                  >
                    <span>Advanced · Tee box, Rating, Slope</span>
                    <span style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>&#8250;</span>
                  </button>
                  {showAdvanced && (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Tee Box</label>
                        <input
                          value={newRoundTeeBox}
                          onChange={e => setNewRoundTeeBox(e.target.value)}
                          placeholder="Blue"
                          className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                          style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Rating</label>
                        <input
                          type="number" step="0.1" min="55" max="80"
                          value={newRoundRating}
                          onChange={e => setNewRoundRating(e.target.value)}
                          placeholder="71.4"
                          className="w-full px-3 py-2 rounded-lg text-sm font-sans text-center outline-none"
                          style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Slope</label>
                        <input
                          type="number" min="55" max="155"
                          value={newRoundSlope}
                          onChange={e => setNewRoundSlope(e.target.value)}
                          placeholder="113"
                          className="w-full px-3 py-2 rounded-lg text-sm font-sans text-center outline-none"
                          style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                        />
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createRound.isPending}
                    className="flex-1 py-2.5 rounded-lg text-sm font-sans font-semibold"
                    style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
                  >
                    {createRound.isPending ? "Creating..." : "Create Round"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddRound(false)}
                    className="px-4 py-2.5 rounded-lg text-sm font-sans"
                    style={{ background: "hsl(42 20% 82%)", color: "hsl(38 30% 18%)" }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {rounds && rounds.length > 0 ? (
              rounds.map(round => (
                <div
                  key={round.id}
                  onClick={() => navigate(`/trips/${tripId}/rounds/${round.id}`)}
                  className="rounded-xl px-5 py-4 cursor-pointer flex items-center justify-between group transition-all hover:scale-[1.005]"
                  style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg p-2" style={{ background: "hsl(158 35% 20%)" }}>
                      <Flag size={15} style={{ color: "hsl(42 52% 59%)" }} />
                    </div>
                    <div>
                      <div className="font-sans font-semibold text-sm" style={{ color: "hsl(38 30% 14%)" }}>
                        {round.name}
                      </div>
                      <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: "hsl(38 20% 38%)" }}>
                        {round.course && <span>{round.course}</span>}
                        {round.course && round.date && <span>·</span>}
                        {round.date && <span>{round.date}</span>}
                        {!round.course && !round.date && <span>No course set</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={e => handleDeleteRound(round.id, e)}
                      className="p-1.5 rounded-lg opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all"
                      style={{ color: "hsl(0 45% 45%)" }}
                    >
                      <Trash2 size={14} />
                    </button>
                    <ChevronRight size={18} style={{ color: "hsl(38 20% 50%)" }} />
                  </div>
                </div>
              ))
            ) : (
              !showAddRound && (
                <div className="text-center py-12">
                  <p className="text-sm font-sans" style={{ color: "hsl(42 20% 55%)" }}>No rounds yet.</p>
                </div>
              )
            )}
          </div>
        )}

        {/* LEADERBOARD TAB */}
        {tab === "leaderboard" && (
          <div>
            {lbLoading ? (
              <div className="space-y-2">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: "hsl(158 40% 15%)" }} />
                ))}
              </div>
            ) : leaderboard && leaderboard.players.length > 0 ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-serif text-lg" style={{ color: "hsl(42 45% 80%)" }}>Trip Standings</h2>
                  <div className="text-xs font-sans" style={{ color: "hsl(42 20% 55%)" }}>
                    Auto-updates every 10s
                  </div>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(158 40% 22%)" }}>
                  {/* Header row */}
                  <div className="px-4 py-2.5 grid grid-cols-[2fr,1fr,1fr,1fr,1fr] text-xs font-sans font-semibold uppercase tracking-widest"
                    style={{ background: "hsl(158 50% 14%)", color: "hsl(42 20% 55%)" }}>
                    <span>Player</span>
                    <span className="text-right">Stableford</span>
                    <span className="text-right">Net</span>
                    <span className="text-right">Skins</span>
                    <span className="text-right">Rounds</span>
                  </div>
                  {/* Sort by stableford descending */}
                  {[...leaderboard.players]
                    .sort((a, b) => (b.totalStableford ?? 0) - (a.totalStableford ?? 0))
                    .map((p, idx) => (
                      <div
                        key={p.playerId}
                        className="px-4 py-3.5 grid grid-cols-[2fr,1fr,1fr,1fr,1fr] items-center"
                        style={{
                          background: idx === 0 ? "hsl(42 30% 88%)" : idx % 2 === 0 ? "hsl(42 20% 93%)" : "hsl(42 15% 90%)",
                          borderTop: "1px solid hsl(38 25% 78%)",
                        }}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-xs font-sans font-semibold w-5 text-center" style={{ color: "hsl(38 20% 50%)" }}>{idx + 1}</span>
                          <div>
                            <div className="font-sans font-semibold text-sm" style={{ color: "hsl(38 30% 14%)" }}>{p.playerName}</div>
                            <div className="text-xs" style={{ color: "hsl(38 20% 38%)" }}>HCP {formatHandicap(p.handicap)}</div>
                          </div>
                        </div>
                        <div className="text-right font-serif text-sm font-semibold" style={{ color: idx === 0 ? "hsl(158 45% 30%)" : "hsl(38 30% 18%)" }}>
                          {p.totalStableford ?? "—"}
                        </div>
                        <div className="text-right font-serif text-sm" style={{ color: "hsl(38 30% 25%)" }}>
                          {p.totalNet != null ? (p.totalNet >= 0 ? `+${p.totalNet}` : p.totalNet) : "—"}
                        </div>
                        <div className="text-right font-serif text-sm" style={{ color: "hsl(38 30% 25%)" }}>
                          {p.totalSkinsWon}
                        </div>
                        <div className="text-right font-serif text-sm" style={{ color: "hsl(38 20% 38%)" }}>
                          {p.roundsPlayed}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-sm font-sans" style={{ color: "hsl(42 20% 55%)" }}>
                  No scores yet. Start entering scores in a round.
                </p>
              </div>
            )}
          </div>
        )}

        {/* PLAYERS TAB */}
        {tab === "players" && (
          <div className="space-y-2">
            {!showAddPlayer && (
              <button
                onClick={() => setShowAddPlayer(true)}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-sans font-semibold transition-all hover:opacity-90"
                style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
              >
                <Plus size={16} />
                Add Player
              </button>
            )}
            {showAddPlayer && (
              <form onSubmit={handleAddPlayer} className="rounded-xl p-4 mb-2" style={{ background: "hsl(42 45% 91%)" }}>
                <div className="flex gap-2 mb-3">
                  <div className="flex-1">
                    <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Name *</label>
                    <input
                      autoFocus
                      value={newPlayerName}
                      onChange={e => setNewPlayerName(e.target.value)}
                      placeholder="Player name"
                      className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                      style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                    />
                  </div>
                  <div className="w-20">
                    <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>HCP</label>
                    <input
                      type="number"
                      min="0"
                      max="54"
                      step="0.1"
                      value={newPlayerHcp}
                      onChange={e => setNewPlayerHcp(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-sm font-sans text-center outline-none"
                      style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createPlayer.isPending}
                    className="flex-1 py-2.5 rounded-lg text-sm font-sans font-semibold"
                    style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
                  >
                    Add
                  </button>
                  <button type="button" onClick={() => setShowAddPlayer(false)} className="px-4 py-2.5 rounded-lg text-sm font-sans"
                    style={{ background: "hsl(42 20% 82%)", color: "hsl(38 30% 18%)" }}>
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {players && players.length > 0 ? players.map(p => (
              <div key={p.id} className="rounded-xl px-4 py-3.5 flex items-center justify-between"
                style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
                {editingPlayerId === p.id ? (
                  <div className="flex-1 flex items-center gap-2">
                    <input
                      value={editPlayerName}
                      onChange={e => setEditPlayerName(e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded-lg text-sm font-sans outline-none"
                      style={{ background: "white", border: "1.5px solid hsl(38 25% 72%)", color: "hsl(38 30% 14%)" }}
                    />
                    <input
                      type="number"
                      min="0" max="54" step="0.1"
                      value={editPlayerHcp}
                      onChange={e => setEditPlayerHcp(e.target.value)}
                      className="w-16 px-2 py-1.5 rounded-lg text-sm font-sans text-center outline-none"
                      style={{ background: "white", border: "1.5px solid hsl(38 25% 72%)", color: "hsl(38 30% 14%)" }}
                    />
                    <button onClick={() => handleUpdatePlayer(p.id)} className="p-1.5 rounded-lg" style={{ color: "hsl(148 45% 40%)" }}>
                      <Check size={15} />
                    </button>
                    <button onClick={() => setEditingPlayerId(null)} className="p-1.5 rounded-lg" style={{ color: "hsl(38 20% 50%)" }}>
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center font-serif font-semibold text-sm"
                        style={{ background: "hsl(158 35% 20%)", color: "hsl(42 52% 59%)" }}>
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="font-sans font-semibold text-sm" style={{ color: "hsl(38 30% 14%)" }}>{p.name}</div>
                        <div className="text-xs" style={{ color: "hsl(38 20% 38%)" }}>HCP {formatHandicap(p.handicap)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setEditingPlayerId(p.id); setEditPlayerName(p.name); setEditPlayerHcp(formatHandicap(p.handicap)); }}
                        className="p-1.5 rounded-lg" style={{ color: "hsl(38 20% 50%)" }}>
                        <Edit3 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeletePlayer(p.id)}
                        className="p-1.5 rounded-lg" style={{ color: "hsl(0 45% 45%)" }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            )) : (
              !showAddPlayer && (
                <div className="text-center py-12">
                  <p className="text-sm font-sans" style={{ color: "hsl(42 20% 55%)" }}>No players yet. Add some above.</p>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
