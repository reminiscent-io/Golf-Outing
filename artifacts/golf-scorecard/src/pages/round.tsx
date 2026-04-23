import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRound,
  useListPlayers,
  useGetScores,
  useGetRoundLeaderboard,
  useUpsertScore,
  useUpdateRound,
  getGetScoresQueryKey,
  getGetRoundLeaderboardQueryKey,
  getGetTripLeaderboardQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, Settings, Trophy, Grid3X3 } from "lucide-react";

type SubTab = "scorecard" | "results" | "setup";

// Scoring helpers (client-side for color coding)
function strokesOnHole(hcp: number, holeHcpIdx: number): number {
  let s = 0;
  if (hcp >= holeHcpIdx) s++;
  if (hcp >= 18 + holeHcpIdx) s++;
  if (hcp >= 36 + holeHcpIdx) s++;
  return s;
}

function netScore(gross: number, hcp: number, holeHcpIdx: number) {
  return gross - strokesOnHole(hcp, holeHcpIdx);
}

function scoreClass(gross: number | null, par: number, hcp: number, holeHcpIdx: number): string {
  if (gross == null) return "score-empty";
  const net = netScore(gross, hcp, holeHcpIdx);
  const diff = net - par;
  if (diff <= -2) return "score-eagle";
  if (diff === -1) return "score-birdie";
  if (diff === 0) return "score-par";
  if (diff === 1) return "score-bogey";
  return "score-double";
}

function scoreLabel(gross: number | null, par: number, hcp: number, holeHcpIdx: number): string {
  if (gross == null) return "";
  const net = netScore(gross, hcp, holeHcpIdx);
  const diff = net - par;
  if (diff <= -3) return "Albatross";
  if (diff === -2) return "Eagle";
  if (diff === -1) return "Birdie";
  if (diff === 0) return "Par";
  if (diff === 1) return "Bogey";
  if (diff === 2) return "Double";
  return `+${diff}`;
}

export default function RoundPage() {
  const { tripId: tripIdStr, roundId: roundIdStr } = useParams<{ tripId: string; roundId: string }>();
  const tripId = Number(tripIdStr);
  const roundId = Number(roundIdStr);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>("scorecard");

  const { data: round, isLoading: roundLoading } = useGetRound(tripId, roundId, { query: { enabled: !!tripId && !!roundId } });
  const { data: players } = useListPlayers(tripId, { query: { enabled: !!tripId } });
  const { data: scoreRows, isLoading: scoresLoading } = useGetScores(tripId, roundId, {
    query: { enabled: !!tripId && !!roundId, refetchInterval: 10000 },
  });
  const { data: leaderboard, isLoading: lbLoading } = useGetRoundLeaderboard(tripId, roundId, {
    query: { enabled: subTab === "results", refetchInterval: 10000 },
  });

  const upsertScore = useUpsertScore();
  const updateRound = useUpdateRound();

  // Build a scores map: playerId -> holeScores[18]
  const scoresMap = new Map<number, (number | null)[]>();
  scoreRows?.forEach(s => {
    scoresMap.set(s.playerId, s.holeScores as (number | null)[]);
  });

  function getScore(playerId: number, holeIdx: number): number | null {
    return scoresMap.get(playerId)?.[holeIdx] ?? null;
  }

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ playerId: number; hole: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  function startEdit(playerId: number, holeIdx: number) {
    const current = getScore(playerId, holeIdx);
    setEditingCell({ playerId, hole: holeIdx });
    setEditValue(current != null ? String(current) : "");
  }

  function commitEdit(playerId: number, holeIdx: number) {
    const val = editValue.trim();
    const score = val === "" ? null : parseInt(val);
    if (val !== "" && (isNaN(score!) || score! < 1 || score! > 20)) {
      setEditingCell(null);
      return;
    }
    upsertScore.mutate(
      { tripId, roundId, data: { playerId, hole: holeIdx + 1, score } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetScoresQueryKey(tripId, roundId) });
          queryClient.invalidateQueries({ queryKey: getGetRoundLeaderboardQueryKey(tripId, roundId) });
          queryClient.invalidateQueries({ queryKey: getGetTripLeaderboardQueryKey(tripId) });
        },
      }
    );
    setEditingCell(null);
  }

  function handleKeyDown(e: React.KeyboardEvent, playerId: number, holeIdx: number) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      commitEdit(playerId, holeIdx);
      // Advance to next player
      if (players && players.length > 0) {
        const currPlayerIdx = players.findIndex(p => p.id === playerId);
        const nextPlayerIdx = (currPlayerIdx + 1) % players.length;
        const nextHoleIdx = nextPlayerIdx === 0 ? holeIdx + 1 : holeIdx;
        if (nextHoleIdx < 18) {
          setTimeout(() => startEdit(players[nextPlayerIdx].id, nextHoleIdx), 50);
        }
      }
    }
    if (e.key === "Escape") {
      setEditingCell(null);
    }
  }

  // Setup state
  const [setupPar, setSetupPar] = useState<number[]>([]);
  const [setupHcp, setSetupHcp] = useState<number[]>([]);
  const [setupGames, setSetupGames] = useState<Record<string, boolean>>({});
  const [setupCourse, setSetupCourse] = useState("");
  const [setupDate, setSetupDate] = useState("");
  const setupInitialized = useRef(false);

  useEffect(() => {
    if (round && !setupInitialized.current) {
      setSetupPar((round.par as number[]) || Array(18).fill(4));
      setSetupHcp((round.holeHcp as number[]) || Array.from({ length: 18 }, (_, i) => i + 1));
      const gc = round.gamesConfig as Record<string, boolean>;
      setSetupGames({
        stableford: gc?.stableford ?? true,
        skins: gc?.skins ?? true,
        nassau: gc?.nassau ?? true,
        netStroke: gc?.netStroke ?? true,
      });
      setSetupCourse(round.course ?? "");
      setSetupDate(round.date ?? "");
      setupInitialized.current = true;
    }
  }, [round]);

  function handleSaveSetup() {
    updateRound.mutate(
      {
        tripId,
        roundId,
        data: {
          course: setupCourse || null,
          date: setupDate || null,
          par: setupPar,
          holeHcp: setupHcp,
          gamesConfig: {
            stableford: setupGames.stableford ?? true,
            skins: setupGames.skins ?? true,
            nassau: setupGames.nassau ?? true,
            netStroke: setupGames.netStroke ?? true,
            bestBall: false,
            matchPlay: false,
          },
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetRoundLeaderboardQueryKey(tripId, roundId) });
        },
      }
    );
  }

  const par = (round?.par as number[]) || Array(18).fill(4);
  const holeHcp = (round?.holeHcp as number[]) || Array.from({ length: 18 }, (_, i) => i + 1);

  const SUBTABS: { id: SubTab; label: string; icon: typeof Trophy }[] = [
    { id: "scorecard", label: "Scorecard", icon: Grid3X3 },
    { id: "results", label: "Results", icon: Trophy },
    { id: "setup", label: "Setup", icon: Settings },
  ];

  if (roundLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>Loading round...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="px-4 pt-7 pb-4 flex-shrink-0" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-5xl mx-auto">
          <button
            onClick={() => navigate(`/trips/${tripId}`)}
            className="flex items-center gap-1.5 text-xs font-sans mb-3 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            Back to Trip
          </button>
          <h1 className="text-xl font-serif" style={{ color: "hsl(42 52% 59%)" }}>{round?.name}</h1>
          {(round?.course || round?.date) && (
            <div className="text-xs font-sans mt-0.5 flex items-center gap-2" style={{ color: "hsl(42 20% 55%)" }}>
              {round.course && <span>{round.course}</span>}
              {round.course && round.date && <span>·</span>}
              {round.date && <span>{round.date}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex-shrink-0 sticky top-0 z-10" style={{ background: "hsl(158 60% 13%)", borderBottom: "1px solid hsl(158 40% 18%)" }}>
        <div className="max-w-5xl mx-auto px-4 flex">
          {SUBTABS.map(t => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className="flex items-center gap-1.5 px-4 py-3 text-xs font-sans font-semibold uppercase tracking-widest transition-all"
              style={{
                color: subTab === t.id ? "hsl(42 52% 59%)" : "hsl(42 20% 55%)",
                borderBottom: subTab === t.id ? "2px solid hsl(42 52% 59%)" : "2px solid transparent",
              }}
            >
              <t.icon size={12} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* SCORECARD TAB */}
      {subTab === "scorecard" && (
        <div className="flex-1 overflow-hidden">
          {!players || players.length === 0 ? (
            <div className="max-w-5xl mx-auto px-4 py-12 text-center">
              <p className="text-sm font-sans" style={{ color: "hsl(42 20% 55%)" }}>
                No players in this trip. Add players first.
              </p>
              <button
                onClick={() => navigate(`/trips/${tripId}`)}
                className="mt-3 px-5 py-2 rounded-xl text-sm font-sans font-semibold"
                style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
              >
                Manage Players
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="w-full" style={{ minWidth: `${Math.max(700, 80 + players.length * 68)}px` }}>
                <colgroup>
                  <col style={{ width: 64 }} />
                  <col style={{ width: 44 }} />
                  {players.map(p => (
                    <col key={p.id} style={{ width: 64 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ background: "hsl(158 65% 9%)", borderBottom: "2px solid hsl(42 52% 59%)" }}>
                    <th className="px-3 py-2.5 text-left text-xs font-sans font-semibold uppercase tracking-wider sticky left-0 z-20"
                      style={{ background: "hsl(158 65% 9%)", color: "hsl(42 20% 55%)" }}>Hole</th>
                    <th className="px-2 py-2.5 text-center text-xs font-sans font-semibold uppercase tracking-wider"
                      style={{ color: "hsl(42 20% 55%)" }}>Par</th>
                    {players.map(p => (
                      <th key={p.id} className="px-2 py-2.5 text-center text-xs font-sans font-semibold"
                        style={{ color: "hsl(42 45% 80%)" }}>
                        <div style={{ maxWidth: 60, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name.split(" ")[0]}</div>
                        <div style={{ color: "hsl(42 20% 55%)", fontWeight: 400, fontSize: 10 }}>HCP {p.handicap}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 18 }, (_, holeIdx) => {
                    const isSection = holeIdx === 9;
                    const outRow = holeIdx === 9;
                    return (
                      <>
                        {holeIdx === 9 && (
                          <tr key="out" style={{ background: "hsl(158 50% 14%)", borderTop: "2px solid hsl(42 52% 59%)" }}>
                            <td className="px-3 py-2 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                              style={{ background: "hsl(158 50% 14%)", color: "hsl(42 52% 59%)" }}>OUT</td>
                            <td className="px-2 py-2 text-center text-xs font-serif font-semibold"
                              style={{ color: "hsl(42 45% 75%)" }}>
                              {par.slice(0, 9).reduce((a, b) => a + b, 0)}
                            </td>
                            {players.map(p => {
                              const scores = scoresMap.get(p.id) || [];
                              const holesIn = scores.slice(0, 9).filter(s => s != null).length;
                              const outTotal = holesIn > 0 ? scores.slice(0, 9).filter((s): s is number => s != null).reduce((a, b) => a + b, 0) : null;
                              return (
                                <td key={p.id} className="px-2 py-2 text-center font-serif text-sm font-semibold"
                                  style={{ color: "hsl(42 45% 80%)" }}>
                                  {outTotal ?? "—"}
                                </td>
                              );
                            })}
                          </tr>
                        )}
                        <tr
                          key={holeIdx}
                          style={{
                            background: holeIdx % 2 === 0 ? "hsl(158 45% 13%)" : "hsl(158 40% 15%)",
                            borderBottom: "1px solid hsl(158 40% 18%)",
                          }}
                        >
                          <td className="px-3 py-1.5 text-left sticky left-0 z-10"
                            style={{ background: holeIdx % 2 === 0 ? "hsl(158 45% 13%)" : "hsl(158 40% 15%)" }}>
                            <div className="font-serif text-base font-semibold" style={{ color: "hsl(42 45% 75%)" }}>
                              {holeIdx + 1}
                            </div>
                            <div className="text-[9px] font-sans" style={{ color: "hsl(42 15% 50%)" }}>
                              HCP {holeHcp[holeIdx]}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-center">
                            <span className="font-serif text-sm" style={{ color: "hsl(42 35% 65%)" }}>
                              {par[holeIdx]}
                            </span>
                          </td>
                          {players.map(p => {
                            const gross = getScore(p.id, holeIdx);
                            const isEditing = editingCell?.playerId === p.id && editingCell?.hole === holeIdx;
                            return (
                              <td key={p.id} className="px-1.5 py-1.5 text-center">
                                {isEditing ? (
                                  <input
                                    ref={inputRef}
                                    type="number"
                                    min="1"
                                    max="20"
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onBlur={() => commitEdit(p.id, holeIdx)}
                                    onKeyDown={e => handleKeyDown(e, p.id, holeIdx)}
                                    className="w-10 h-8 text-center font-serif text-sm rounded-lg outline-none"
                                    style={{
                                      background: "white",
                                      color: "hsl(38 30% 14%)",
                                      border: "2px solid hsl(42 52% 59%)",
                                    }}
                                  />
                                ) : (
                                  <button
                                    onClick={() => startEdit(p.id, holeIdx)}
                                    className={`w-10 h-8 rounded-lg font-serif text-sm font-semibold transition-all hover:scale-105 ${scoreClass(gross, par[holeIdx], p.handicap, holeHcp[holeIdx])}`}
                                    title={gross != null ? scoreLabel(gross, par[holeIdx], p.handicap, holeHcp[holeIdx]) : `Enter score for hole ${holeIdx + 1}`}
                                  >
                                    {gross ?? "·"}
                                  </button>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                        {holeIdx === 17 && (
                          <tr key="in-total" style={{ background: "hsl(158 50% 14%)", borderTop: "2px solid hsl(42 52% 59%)" }}>
                            <td className="px-3 py-2 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                              style={{ background: "hsl(158 50% 14%)", color: "hsl(42 52% 59%)" }}>IN</td>
                            <td className="px-2 py-2 text-center text-xs font-serif font-semibold"
                              style={{ color: "hsl(42 45% 75%)" }}>
                              {par.slice(9).reduce((a, b) => a + b, 0)}
                            </td>
                            {players.map(p => {
                              const scores = scoresMap.get(p.id) || [];
                              const holesIn = scores.slice(9).filter(s => s != null).length;
                              const inTotal = holesIn > 0 ? scores.slice(9).filter((s): s is number => s != null).reduce((a, b) => a + b, 0) : null;
                              return (
                                <td key={p.id} className="px-2 py-2 text-center font-serif text-sm font-semibold"
                                  style={{ color: "hsl(42 45% 80%)" }}>
                                  {inTotal ?? "—"}
                                </td>
                              );
                            })}
                          </tr>
                        )}
                      </>
                    );
                  })}
                  {/* Total row */}
                  <tr style={{ background: "hsl(158 60% 11%)", borderTop: "2px solid hsl(42 52% 59%)" }}>
                    <td className="px-3 py-3 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                      style={{ background: "hsl(158 60% 11%)", color: "hsl(42 52% 59%)" }}>TOT</td>
                    <td className="px-2 py-3 text-center font-serif text-sm font-semibold"
                      style={{ color: "hsl(42 45% 75%)" }}>
                      {par.reduce((a, b) => a + b, 0)}
                    </td>
                    {players.map(p => {
                      const scores = scoresMap.get(p.id) || [];
                      const played = scores.filter(s => s != null).length;
                      const total = played > 0 ? scores.filter((s): s is number => s != null).reduce((a, b) => a + b, 0) : null;
                      return (
                        <td key={p.id} className="px-2 py-3 text-center font-serif text-base font-semibold"
                          style={{ color: "hsl(42 52% 59%)" }}>
                          {total ?? "—"}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* RESULTS TAB */}
      {subTab === "results" && (
        <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-5">
          {lbLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: "hsl(158 40% 15%)" }} />
              ))}
            </div>
          ) : leaderboard ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-serif text-lg" style={{ color: "hsl(42 45% 80%)" }}>Round Results</h2>
                <span className="text-xs font-sans" style={{ color: "hsl(42 20% 55%)" }}>Auto-updates every 10s</span>
              </div>

              {/* Net Stroke & Stableford */}
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(158 40% 22%)" }}>
                <div className="px-4 py-2.5 grid grid-cols-[2fr,1fr,1fr,1fr,1fr] text-xs font-sans font-semibold uppercase tracking-widest"
                  style={{ background: "hsl(158 50% 14%)", color: "hsl(42 20% 55%)" }}>
                  <span>Player</span>
                  <span className="text-right">Gross</span>
                  <span className="text-right">Net</span>
                  <span className="text-right">Stblfd</span>
                  <span className="text-right">Skins</span>
                </div>
                {[...leaderboard.entries]
                  .sort((a, b) => (b.stablefordTotal ?? 0) - (a.stablefordTotal ?? 0))
                  .map((e, idx) => (
                    <div
                      key={e.playerId}
                      className="px-4 py-3 grid grid-cols-[2fr,1fr,1fr,1fr,1fr] items-center"
                      style={{
                        background: idx === 0 ? "hsl(42 30% 88%)" : idx % 2 === 0 ? "hsl(42 20% 93%)" : "hsl(42 15% 90%)",
                        borderTop: "1px solid hsl(38 25% 78%)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-sans font-semibold w-4 text-center" style={{ color: "hsl(38 20% 45%)" }}>{idx + 1}</span>
                        <div>
                          <div className="font-sans font-semibold text-sm" style={{ color: "hsl(38 30% 14%)" }}>{e.playerName}</div>
                          <div className="text-[10px]" style={{ color: "hsl(38 20% 42%)" }}>{e.holesPlayed}/18 holes</div>
                        </div>
                      </div>
                      <div className="text-right font-serif text-sm" style={{ color: "hsl(38 30% 25%)" }}>{e.grossTotal ?? "—"}</div>
                      <div className="text-right font-serif text-sm" style={{ color: "hsl(38 30% 25%)" }}>{e.netTotal ?? "—"}</div>
                      <div className="text-right font-serif text-sm font-semibold" style={{ color: idx === 0 ? "hsl(148 45% 30%)" : "hsl(38 30% 18%)" }}>
                        {e.stablefordTotal ?? 0}
                      </div>
                      <div className="text-right font-serif text-sm" style={{ color: "hsl(38 30% 25%)" }}>{e.skinsWon}</div>
                    </div>
                  ))}
              </div>

              {/* Nassau */}
              {leaderboard.nassauResult && (
                <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
                  <h3 className="font-sans font-semibold text-xs uppercase tracking-widest mb-3" style={{ color: "hsl(38 20% 38%)" }}>Nassau</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Front 9", ids: leaderboard.nassauResult.frontWinnerIds },
                      { label: "Back 9", ids: leaderboard.nassauResult.backWinnerIds },
                      { label: "Total 18", ids: leaderboard.nassauResult.totalWinnerIds },
                    ].map(({ label, ids }) => (
                      <div key={label} className="rounded-lg p-3 text-center" style={{ background: "hsl(158 35% 20%)" }}>
                        <div className="text-[10px] font-sans uppercase tracking-widest mb-1" style={{ color: "hsl(42 20% 55%)" }}>{label}</div>
                        <div className="font-serif text-sm font-semibold" style={{ color: "hsl(42 52% 59%)" }}>
                          {ids.length === 0 ? "—" : ids.map(id => leaderboard.entries.find(e => e.playerId === id)?.playerName?.split(" ")[0]).join(", ")}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Skins */}
              {leaderboard.skinResults && leaderboard.skinResults.some(s => s.winnerId != null || s.tied) && (
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(158 40% 22%)" }}>
                  <div className="px-4 py-2.5 grid grid-cols-[1fr,2fr,1fr] text-xs font-sans font-semibold uppercase tracking-widest"
                    style={{ background: "hsl(158 50% 14%)", color: "hsl(42 20% 55%)" }}>
                    <span>Hole</span>
                    <span>Winner</span>
                    <span className="text-right">Skins</span>
                  </div>
                  {leaderboard.skinResults.map((s, idx) => (
                    <div
                      key={s.hole}
                      className="px-4 py-2.5 grid grid-cols-[1fr,2fr,1fr] items-center"
                      style={{
                        background: idx % 2 === 0 ? "hsl(42 20% 93%)" : "hsl(42 15% 90%)",
                        borderTop: "1px solid hsl(38 25% 78%)",
                      }}
                    >
                      <div className="font-serif font-semibold text-sm" style={{ color: "hsl(38 30% 14%)" }}>#{s.hole}</div>
                      <div className="font-sans text-sm" style={{ color: s.winnerId ? "hsl(148 45% 30%)" : s.tied ? "hsl(38 20% 45%)" : "hsl(38 20% 55%)" }}>
                        {s.winnerName ?? (s.tied ? "Tied — carries" : "—")}
                      </div>
                      <div className="text-right font-serif text-sm font-semibold" style={{ color: "hsl(42 52% 45%)" }}>
                        {s.carry > 1 || s.winnerId ? (s.carry > 1 && !s.winnerId ? `${s.carry} carry` : s.carry) : ""}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12">
              <p className="text-sm font-sans" style={{ color: "hsl(42 20% 55%)" }}>Enter some scores to see results.</p>
            </div>
          )}
        </div>
      )}

      {/* SETUP TAB */}
      {subTab === "setup" && (
        <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-6">
          {/* Course info */}
          <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
            <h3 className="font-sans font-semibold text-xs uppercase tracking-widest mb-3" style={{ color: "hsl(38 20% 38%)" }}>Course Info</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-sans mb-1" style={{ color: "hsl(38 20% 38%)" }}>Course Name</label>
                <input
                  value={setupCourse}
                  onChange={e => setSetupCourse(e.target.value)}
                  placeholder="Course name..."
                  className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-sans mb-1" style={{ color: "hsl(38 20% 38%)" }}>Date</label>
                <input
                  type="date"
                  value={setupDate}
                  onChange={e => setSetupDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
              </div>
            </div>
          </div>

          {/* Games */}
          <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
            <h3 className="font-sans font-semibold text-xs uppercase tracking-widest mb-3" style={{ color: "hsl(38 20% 38%)" }}>Active Games</h3>
            <div className="space-y-2">
              {(["stableford", "skins", "nassau", "netStroke"] as const).map(game => (
                <label key={game} className="flex items-center justify-between cursor-pointer py-1.5">
                  <span className="font-sans text-sm font-semibold" style={{ color: "hsl(38 30% 14%)" }}>
                    {game === "netStroke" ? "Net Stroke Play" : game.charAt(0).toUpperCase() + game.slice(1)}
                  </span>
                  <div
                    onClick={() => setSetupGames(g => ({ ...g, [game]: !g[game] }))}
                    className="w-10 h-5.5 rounded-full relative transition-all cursor-pointer"
                    style={{
                      background: setupGames[game] ? "hsl(42 52% 59%)" : "hsl(38 20% 70%)",
                      width: 40, height: 22,
                    }}
                  >
                    <div
                      className="absolute top-0.5 rounded-full transition-all"
                      style={{
                        width: 18, height: 18,
                        background: "white",
                        left: setupGames[game] ? 20 : 2,
                        boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      }}
                    />
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Par & HCP table */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(38 25% 78%)" }}>
            <div className="px-4 py-2.5 grid grid-cols-3 text-xs font-sans font-semibold uppercase tracking-widest"
              style={{ background: "hsl(158 50% 14%)", color: "hsl(42 20% 55%)" }}>
              <span>Hole</span>
              <span className="text-center">Par</span>
              <span className="text-center">Stroke Index</span>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 400 }}>
              {Array.from({ length: 18 }, (_, i) => (
                <div
                  key={i}
                  className="px-4 py-2 grid grid-cols-3 items-center"
                  style={{
                    background: i % 2 === 0 ? "hsl(42 20% 93%)" : "hsl(42 15% 90%)",
                    borderTop: "1px solid hsl(38 25% 78%)",
                  }}
                >
                  <span className="font-serif font-semibold text-sm" style={{ color: "hsl(38 30% 14%)" }}>#{i + 1}</span>
                  <div className="flex justify-center">
                    <input
                      type="number" min="3" max="6"
                      value={setupPar[i] ?? 4}
                      onChange={e => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 3 && v <= 6) {
                          setSetupPar(p => { const n = [...p]; n[i] = v; return n; });
                        }
                      }}
                      className="w-12 text-center font-serif text-sm rounded-lg py-1 outline-none"
                      style={{ background: "white", border: "1.5px solid hsl(38 25% 72%)", color: "hsl(38 30% 14%)" }}
                    />
                  </div>
                  <div className="flex justify-center">
                    <input
                      type="number" min="1" max="18"
                      value={setupHcp[i] ?? i + 1}
                      onChange={e => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 1 && v <= 18) {
                          setSetupHcp(h => { const n = [...h]; n[i] = v; return n; });
                        }
                      }}
                      className="w-12 text-center font-serif text-sm rounded-lg py-1 outline-none"
                      style={{ background: "white", border: "1.5px solid hsl(38 25% 72%)", color: "hsl(38 30% 14%)" }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={handleSaveSetup}
            disabled={updateRound.isPending}
            className="w-full py-3 rounded-xl font-sans font-semibold text-sm transition-all hover:opacity-90"
            style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
          >
            {updateRound.isPending ? "Saving..." : "Save Setup"}
          </button>
        </div>
      )}
    </div>
  );
}
