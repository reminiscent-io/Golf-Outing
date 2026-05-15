import { useEffect, useState } from "react";
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
  useListMyTrips,
  useSaveTrip,
  useUnsaveTrip,
  getGetTripQueryKey,
  getListPlayersQueryKey,
  getListRoundsQueryKey,
  getGetTripLeaderboardQueryKey,
  getListMyTripsQueryKey,
} from "@workspace/api-client-react";
import {
  ArrowLeft, Plus, Trash2, ChevronRight, Trophy, Flag,
  Users, Calendar, Edit3, Check, X, Share2, Bookmark, BookmarkCheck
} from "lucide-react";
import { useAuthSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";
import {
  searchCourses,
  getCourseDetail,
  type CourseSearchResult,
  type CourseDetail,
  type CourseTee,
} from "@/lib/course-lookup";
import { SignedInAs } from "@/components/signed-in-as";
import { GameInfoButton } from "@/components/game-info-modal";

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
  const session = useAuthSession();
  const [signInOpen, setSignInOpen] = useState(false);
  const [shareToast, setShareToast] = useState<string | null>(null);

  // My-trips data lets us show the right Save/Unsave state.
  const { data: myTrips } = useListMyTrips({
    query: {
      queryKey: getListMyTripsQueryKey(),
      enabled: !!session,
    },
  });
  const myEntry = myTrips?.find(t => t.trip.id === tripId);
  const hasPlayer = myEntry?.via === "player" || myEntry?.via === "both";
  const hasSaved = myEntry?.via === "saved" || myEntry?.via === "both";

  const saveTrip = useSaveTrip();
  const unsaveTrip = useUnsaveTrip();

  function handleShare() {
    const url = `${window.location.origin}${window.location.pathname.split("/trips/")[0] || ""}/trips/${tripId}`;
    if (typeof navigator.share === "function") {
      void navigator.share({ url, text: "Join my golf trip", title: "Golf Outing" }).catch(() => {});
      return;
    }
    try {
      void navigator.clipboard.writeText(url);
      setShareToast("Link copied");
      setTimeout(() => setShareToast(null), 2000);
    } catch {
      setShareToast(url);
      setTimeout(() => setShareToast(null), 4000);
    }
  }

  function handleSaveToggle() {
    if (!session) { setSignInOpen(true); return; }
    if (hasSaved) {
      unsaveTrip.mutate({ tripId }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() }),
      });
    } else {
      saveTrip.mutate({ tripId }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() }),
      });
    }
  }

  const { data: trip, isLoading: tripLoading } = useGetTrip(tripId, {
    query: { queryKey: getGetTripQueryKey(tripId), enabled: !!tripId },
  });
  const { data: players } = useListPlayers(tripId, {
    query: { queryKey: getListPlayersQueryKey(tripId), enabled: !!tripId },
  });
  const { data: rounds } = useListRounds(tripId, {
    query: { queryKey: getListRoundsQueryKey(tripId), enabled: !!tripId },
  });
  const { data: leaderboard, isLoading: lbLoading } = useGetTripLeaderboard(tripId, {
    query: {
      queryKey: getGetTripLeaderboardQueryKey(tripId),
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
  // Course lookup state (drives the Advanced panel's auto-fill).
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<CourseSearchResult[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<CourseDetail | null>(null);
  const [selectedTeeId, setSelectedTeeId] = useState<string>("");
  const [lookupPar, setLookupPar] = useState<number[] | null>(null);
  const [lookupHcp, setLookupHcp] = useState<number[] | null>(null);

  // Debounced autocomplete search. Runs after the user pauses typing.
  useEffect(() => {
    const q = lookupQuery.trim();
    if (q.length < 3) {
      setLookupResults([]);
      setLookupError(null);
      setLookupLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLookupLoading(true);
      setLookupError(null);
      searchCourses(q, ctrl.signal)
        .then(r => setLookupResults(r.results))
        .catch(err => {
          if (ctrl.signal.aborted) return;
          setLookupError(err?.message ?? "Search failed");
          setLookupResults([]);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLookupLoading(false);
        });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [lookupQuery]);

  function applyTee(tee: CourseTee) {
    setNewRoundTeeBox(tee.name);
    setNewRoundRating(tee.rating != null ? String(tee.rating) : "");
    setNewRoundSlope(tee.slope != null ? String(tee.slope) : "");
    setLookupPar(tee.par);
    setLookupHcp(tee.holeHcp);
    setSelectedTeeId(tee.id);
  }

  async function pickCourse(result: CourseSearchResult) {
    setLookupResults([]);
    setLookupQuery(result.clubName);
    setLookupError(null);
    setLookupLoading(true);
    try {
      const detail = await getCourseDetail(result.id);
      setSelectedCourse(detail);
      setSelectedTeeId("");
      if (detail.tees.length === 1) applyTee(detail.tees[0]);
    } catch (err) {
      setLookupError((err as Error)?.message ?? "Failed to load course");
    } finally {
      setLookupLoading(false);
    }
  }

  function clearLookup() {
    setLookupQuery("");
    setLookupResults([]);
    setSelectedCourse(null);
    setSelectedTeeId("");
    setLookupPar(null);
    setLookupHcp(null);
    setLookupError(null);
  }

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
    const effectiveCourse = newRoundCourse.trim() || selectedCourse?.clubName || "";
    const defaultName = effectiveCourse && newRoundDate
      ? `${effectiveCourse} - ${newRoundDate}`
      : effectiveCourse || newRoundDate || "";
    const finalName = newRoundName.trim() || defaultName;
    if (!finalName) return;
    const ratingNum = parseFloat(newRoundRating);
    const slopeNum = parseInt(newRoundSlope);
    createRound.mutate(
      {
        tripId,
        data: {
          name: finalName,
          course: effectiveCourse || null,
          date: newRoundDate || null,
          teeBox: newRoundTeeBox.trim() || null,
          courseRating: isNaN(ratingNum) ? null : ratingNum,
          courseSlope: isNaN(slopeNum) ? null : slopeNum,
          ...(lookupPar ? { par: lookupPar } : {}),
          ...(lookupHcp ? { holeHcp: lookupHcp } : {}),
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
          clearLookup();
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
      <div className="min-h-dvh bg-background flex items-center justify-center">
        <div className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <div className="px-4 pt-8 pb-5" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-2xl mx-auto">
          <button
            onClick={() => navigate("/trips")}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            All Trips
          </button>
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-2xl font-serif" style={{ color: "hsl(42 52% 59%)" }}>
              {trip?.name}
            </h1>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleShare}
                title="Share trip link"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-sans hover:opacity-80"
                style={{ background: "hsl(158 35% 20%)", color: "hsl(42 52% 59%)" }}
              >
                <Share2 size={12} />
                Share
              </button>
              {session && !hasPlayer && (
                <button
                  onClick={handleSaveToggle}
                  disabled={saveTrip.isPending || unsaveTrip.isPending}
                  title={hasSaved ? "Saved to your account" : "Save to your account"}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-sans hover:opacity-80"
                  style={{
                    background: hasSaved ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
                    color: hasSaved ? "hsl(38 30% 12%)" : "hsl(42 52% 59%)",
                  }}
                >
                  {hasSaved ? <BookmarkCheck size={12} /> : <Bookmark size={12} />}
                  {hasSaved ? "Saved" : "Save"}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs font-sans" style={{ color: "hsl(42 20% 55%)" }}>
            <span>{players?.length ?? 0} players</span>
            <span>·</span>
            <span>{rounds?.length ?? 0} rounds</span>
          </div>
          <div className="mt-2">
            <SignedInAs tripId={tripId} />
          </div>
          {shareToast && (
            <div
              className="mt-2 inline-block px-3 py-1 rounded text-xs font-sans"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {shareToast}
            </div>
          )}
          <SignInModal
            open={signInOpen}
            onClose={() => setSignInOpen(false)}
            onSignedIn={() => setSignInOpen(false)}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="sticky top-0 z-10 sticky-safe-top" style={{ background: "hsl(158 60% 13%)", borderBottom: "1px solid hsl(158 40% 18%)" }}>
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
                onClick={() => {
                  if (!session) { setSignInOpen(true); return; }
                  setShowAddRound(true);
                }}
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
                  {/* Course lookup — primary, drives default round name */}
                  <div>
                    <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>
                      Course
                    </label>
                    <div className="relative">
                      <input
                        autoFocus
                        value={lookupQuery}
                        onChange={e => { setLookupQuery(e.target.value); setSelectedCourse(null); setSelectedTeeId(""); }}
                        placeholder="Start typing a club or course name…"
                        className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                        style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                      />
                      {lookupLoading && (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-sans" style={{ color: "hsl(38 20% 45%)" }}>…</span>
                      )}
                      {!selectedCourse && lookupResults.length > 0 && (
                        <div className="absolute z-20 mt-1 w-full rounded-lg overflow-hidden max-h-60 overflow-y-auto"
                          style={{ background: "white", border: "1.5px solid hsl(38 25% 72%)", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
                          {lookupResults.map(r => (
                            <button
                              type="button"
                              key={r.id}
                              onClick={() => pickCourse(r)}
                              className="w-full text-left px-3 py-2.5 text-sm font-sans hover:opacity-80"
                              style={{ color: "hsl(38 30% 14%)", borderBottom: "1px solid hsl(38 25% 88%)" }}
                            >
                              <div className="font-semibold truncate">{r.clubName}{r.courseName ? ` — ${r.courseName}` : ""}</div>
                              {r.location && (
                                <div className="text-xs truncate" style={{ color: "hsl(38 20% 45%)" }}>{r.location}</div>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {lookupError && (
                      <div className="text-xs font-sans mt-1" style={{ color: "hsl(0 55% 40%)" }}>{lookupError}</div>
                    )}
                    {selectedCourse && (
                      <div className="mt-2 rounded-lg pl-3 pr-1 py-1 flex items-center justify-between gap-2"
                        style={{ background: "hsl(42 30% 86%)", border: "1px solid hsl(38 25% 78%)" }}>
                        <div className="text-xs font-sans min-w-0 flex-1 py-1" style={{ color: "hsl(38 30% 14%)" }}>
                          <div className="font-semibold truncate">{selectedCourse.clubName}</div>
                          {selectedCourse.courseName && (
                            <div className="truncate" style={{ color: "hsl(38 20% 45%)" }}>{selectedCourse.courseName}</div>
                          )}
                        </div>
                        <button type="button" onClick={clearLookup}
                          className="text-xs font-sans font-semibold uppercase tracking-wider px-3 py-2 rounded-md flex-shrink-0 hover:opacity-70"
                          style={{ color: "hsl(38 25% 30%)" }}>
                          Clear
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Date — also drives default round name */}
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

                  {/* Tee selector (shown after a course is picked) */}
                  {selectedCourse && selectedCourse.tees.length > 0 && (
                    <div>
                      <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>
                        Tee box ({selectedCourse.tees.length})
                      </label>
                      <select
                        value={selectedTeeId}
                        onChange={e => {
                          const tee = selectedCourse.tees.find(t => t.id === e.target.value);
                          if (tee) applyTee(tee);
                        }}
                        className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                        style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                      >
                        <option value="">Select a tee…</option>
                        {selectedCourse.tees.map(t => {
                          const parts = [t.name];
                          if (t.gender) parts.push(t.gender);
                          const meta = [
                            t.rating != null ? `CR ${t.rating}` : null,
                            t.slope != null ? `SR ${t.slope}` : null,
                            t.totalYards != null ? `${t.totalYards} yds` : null,
                          ].filter(Boolean).join(" · ");
                          return (
                            <option key={t.id} value={t.id}>
                              {parts.join(" · ")}{meta ? ` (${meta})` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowAdvanced(v => !v)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-xs font-sans font-semibold uppercase tracking-widest"
                    style={{ background: "white", border: "1.5px solid hsl(38 25% 72%)", color: "hsl(38 20% 38%)" }}
                  >
                    <span className="truncate">Advanced Options</span>
                    <span className="flex-shrink-0" style={{ transform: showAdvanced ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>&#8250;</span>
                  </button>
                  {showAdvanced && (
                    <div className="space-y-3">
                      {/* Round name override — defaults to "{course} - {date}" */}
                      <div>
                        <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Round Name</label>
                        <input
                          value={newRoundName}
                          onChange={e => setNewRoundName(e.target.value)}
                          placeholder={(() => {
                            const c = newRoundCourse.trim() || selectedCourse?.clubName || "";
                            if (c && newRoundDate) return `${c} - ${newRoundDate}`;
                            return c || newRoundDate || "Round 1";
                          })()}
                          className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                          style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                        />
                      </div>

                      {/* Course name override — defaults to picked course's club name */}
                      <div>
                        <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Course Name</label>
                        <input
                          value={newRoundCourse}
                          onChange={e => setNewRoundCourse(e.target.value)}
                          placeholder={selectedCourse?.clubName || "Pebble Beach"}
                          className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                          style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                        />
                      </div>

                      {/* Manual fields — auto-filled after a tee is selected, editable either way */}
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
                      {lookupPar && lookupHcp && (
                        <div className="text-xs font-sans" style={{ color: "hsl(38 20% 45%)" }}>
                          Par totals {lookupPar.reduce((a,b)=>a+b,0)} · stroke indexes loaded from selected tee. You can still tweak holes later in Setup.
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={createRound.isPending}
                    className="flex-1 min-h-11 py-3 rounded-lg text-sm font-sans font-semibold"
                    style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
                  >
                    {createRound.isPending ? "Creating..." : "Create Round"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddRound(false)}
                    className="px-4 min-h-11 py-3 rounded-lg text-sm font-sans"
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
                  <h2 className="font-serif text-lg flex items-center gap-2" style={{ color: "hsl(42 45% 80%)" }}>
                    Trip Standings
                    <GameInfoButton game="handicaps" size={14} />
                  </h2>
                  <div className="text-xs font-sans" style={{ color: "hsl(42 20% 55%)" }}>
                    Auto-updates every 10s
                  </div>
                </div>
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(158 40% 22%)" }}>
                  {/* Header row */}
                  <div className="px-4 py-2.5 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] text-xs font-sans font-semibold uppercase tracking-widest"
                    style={{ background: "hsl(158 50% 14%)", color: "hsl(42 20% 55%)" }}>
                    <span>Player</span>
                    <span className="text-right flex items-center justify-end gap-1">Stableford <GameInfoButton game="stableford" size={12} /></span>
                    <span className="text-right flex items-center justify-end gap-1">Net <GameInfoButton game="netStroke" size={12} /></span>
                    <span className="text-right flex items-center justify-end gap-1">Skins <GameInfoButton game="skins" size={12} /></span>
                    <span className="text-right">Rounds</span>
                  </div>
                  {/* Sort by stableford descending */}
                  {[...leaderboard.players]
                    .sort((a, b) => (b.totalStableford ?? 0) - (a.totalStableford ?? 0))
                    .map((p, idx) => (
                      <div
                        key={p.playerId}
                        className="px-4 py-3.5 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center"
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
                      inputMode="decimal"
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
                      inputMode="decimal"
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
