import { useState, useCallback, useRef, useEffect, Fragment } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetRound,
  useListPlayers,
  useGetScores,
  useGetRoundLeaderboard,
  useUpsertScore,
  useUpdateRound,
  getGetRoundQueryKey,
  getListPlayersQueryKey,
  getGetScoresQueryKey,
  getGetRoundLeaderboardQueryKey,
  getGetTripLeaderboardQueryKey,
  useListRoundGroups,
  getListRoundGroupsQueryKey,
  useGetScrambleScores,
  useUpsertScrambleScore,
  getGetScrambleScoresQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, Settings, Trophy, Grid3X3 } from "lucide-react";
import {
  searchCourses,
  getCourseDetail,
  type CourseSearchResult,
  type CourseDetail,
  type CourseTee,
} from "@/lib/course-lookup";
import { SignedInAs } from "@/components/signed-in-as";
import { RoundGroupsEditor } from "@/components/round-groups-editor";
import { GameInfoButton } from "@/components/game-info-modal";
import { useTripIdentity } from "@/lib/trip-identity";

type SubTab = "scorecard" | "results" | "setup";
type ScrambleType = "fourMan" | "twoMan";
type ScrambleTeamSide = "A" | "B" | "G";

// Scoring helpers (client-side for color coding)
function strokesOnHole(hcp: number, holeHcpIdx: number): number {
  let s = 0;
  if (hcp >= holeHcpIdx) s++;
  if (hcp >= 18 + holeHcpIdx) s++;
  if (hcp >= 36 + holeHcpIdx) s++;
  return s;
}

type HandicapMode = "net" | "gross";
type CourseInputs = { slope?: number | null; rating?: number | null; totalPar?: number | null };

// WHS Course Handicap = Index × (Slope/113) + (Course Rating − Par), rounded.
function whsCourseHandicap(idx: number, course: CourseInputs): number {
  const slopeAdjust = (course.slope ?? 113) / 113;
  const ratingDiff = (course.rating != null && course.totalPar != null)
    ? (course.rating - course.totalPar)
    : 0;
  return Math.round((idx || 0) * slopeAdjust + ratingDiff);
}

function effectiveHandicap(playerHcp: number, fieldMinHcp: number, mode: HandicapMode, course: CourseInputs): number {
  const ch = whsCourseHandicap(playerHcp, course);
  if (mode === "gross") return Math.max(0, ch);
  const minCh = whsCourseHandicap(fieldMinHcp, course);
  return Math.max(0, ch - minCh);
}

function formatHandicap(h: number): string {
  return (Math.round(h * 10) / 10).toFixed(1);
}

function netScore(gross: number, playingHcp: number, holeHcpIdx: number) {
  return gross - strokesOnHole(playingHcp, holeHcpIdx);
}

function scoreClass(gross: number | null, par: number, playingHcp: number, holeHcpIdx: number): string {
  if (gross == null) return "score-empty";
  const net = netScore(gross, playingHcp, holeHcpIdx);
  const diff = net - par;
  if (diff <= -2) return "score-eagle";
  if (diff === -1) return "score-birdie";
  if (diff === 0) return "score-par";
  if (diff === 1) return "score-bogey";
  return "score-double";
}

function scoreLabel(gross: number | null, par: number, playingHcp: number, holeHcpIdx: number): string {
  if (gross == null) return "";
  const net = netScore(gross, playingHcp, holeHcpIdx);
  const diff = net - par;
  if (diff <= -3) return "Albatross";
  if (diff === -2) return "Eagle";
  if (diff === -1) return "Birdie";
  if (diff === 0) return "Par";
  if (diff === 1) return "Bogey";
  if (diff === 2) return "Double";
  return `+${diff}`;
}

type ScrambleTeam = {
  key: string;
  groupNumber: number;
  teamSide: ScrambleTeamSide;
  label: string;
  playerIds: number[];
  playerNames: string[];
};

function ScrambleScorecard(props: {
  teams: ScrambleTeam[];
  myTeamKey: string | undefined;
  viewMode: "mine" | "all";
  setViewMode: (m: "mine" | "all") => void;
  par: number[];
  holeHcp: number[];
  getScore: (teamKey: string, holeIdx: number) => number | null;
  editingScramble: { teamKey: string; hole: number } | null;
  startEditScramble: (teamKey: string, holeIdx: number) => void;
  scrambleEditValue: string;
  handleScrambleChange: (val: string, teamKey: string, holeIdx: number) => void;
  commitScramble: (teamKey: string, holeIdx: number) => void;
  handleScrambleKeyDown: (e: React.KeyboardEvent, teamKey: string, holeIdx: number) => void;
  scrambleInputRef: React.RefObject<HTMLInputElement | null>;
  onNavigateToSetup: () => void;
}) {
  const {
    teams, myTeamKey, viewMode, setViewMode, par, holeHcp,
    getScore, editingScramble, startEditScramble, scrambleEditValue,
    handleScrambleChange, commitScramble, handleScrambleKeyDown, scrambleInputRef,
    onNavigateToSetup,
  } = props;

  if (teams.length === 0) {
    return (
      <div className="flex-1 max-w-2xl mx-auto px-4 py-12 text-center">
        <p className="text-sm font-sans" style={{ color: "hsl(42 20% 55%)" }}>
          Assign players to groups before entering scramble scores.
        </p>
        <button
          onClick={onNavigateToSetup}
          className="mt-3 px-5 py-2 rounded-xl text-sm font-sans font-semibold"
          style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
        >
          Set Up Groups
        </button>
      </div>
    );
  }

  const visibleTeams = viewMode === "mine" && myTeamKey
    ? teams.filter(t => t.key === myTeamKey)
    : teams;

  function teamScoreClass(gross: number | null, parVal: number): string {
    if (gross == null) return "score-empty";
    const diff = gross - parVal;
    if (diff <= -2) return "score-eagle";
    if (diff === -1) return "score-birdie";
    if (diff === 0) return "score-par";
    if (diff === 1) return "score-bogey";
    return "score-double";
  }

  return (
    <div className="flex-1 overflow-hidden">
      {myTeamKey && (
        <div className="flex items-center gap-2 mb-3 px-4 pt-3 text-xs font-sans">
          <button
            onClick={() => setViewMode("mine")}
            className="px-3 py-1.5 rounded-lg font-600"
            style={{
              background: viewMode === "mine" ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
              color: viewMode === "mine" ? "hsl(38 30% 12%)" : "hsl(42 35% 65%)",
            }}
          >
            My team
          </button>
          <button
            onClick={() => setViewMode("all")}
            className="px-3 py-1.5 rounded-lg font-600"
            style={{
              background: viewMode === "all" ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
              color: viewMode === "all" ? "hsl(38 30% 12%)" : "hsl(42 35% 65%)",
            }}
          >
            All teams
          </button>
        </div>
      )}
      <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        <table className="w-full" style={{ minWidth: `${44 + 28 + visibleTeams.length * 84}px` }}>
          <colgroup>
            <col style={{ width: 44 }} />
            <col style={{ width: 28 }} />
            {visibleTeams.map(t => (
              <col key={t.key} style={{ width: 84 }} />
            ))}
          </colgroup>
          <thead>
            <tr style={{ background: "hsl(158 65% 9%)", borderBottom: "2px solid hsl(42 52% 59%)" }}>
              <th className="px-2 py-2 text-left text-xs font-sans font-semibold uppercase tracking-wider sticky left-0 z-20"
                style={{ background: "hsl(158 65% 9%)", color: "hsl(42 20% 55%)" }}>Hole</th>
              <th className="px-1 py-2 text-center text-xs font-sans font-semibold uppercase tracking-wider"
                style={{ color: "hsl(42 20% 55%)" }}>Par</th>
              {visibleTeams.map(t => (
                <th key={t.key} className="px-1 py-2 text-center text-xs font-sans font-semibold"
                  style={{ color: "hsl(42 45% 80%)", ...(t.key === myTeamKey ? { boxShadow: "inset 0 0 0 2px hsl(42 52% 59% / 0.6)" } : {}) }}>
                  <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.label}</div>
                  <div style={{ color: "hsl(42 20% 55%)", fontWeight: 400, fontSize: 9, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {t.playerNames.join(" / ")}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 18 }, (_, holeIdx) => (
              <Fragment key={holeIdx}>
                {holeIdx === 9 && (
                  <tr key="out" style={{ background: "hsl(158 50% 14%)", borderTop: "2px solid hsl(42 52% 59%)" }}>
                    <td className="px-2 py-2 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                      style={{ background: "hsl(158 50% 14%)", color: "hsl(42 52% 59%)" }}>OUT</td>
                    <td className="px-1 py-2 text-center text-xs font-serif font-semibold"
                      style={{ color: "hsl(42 45% 75%)" }}>
                      {par.slice(0, 9).reduce((a, b) => a + b, 0)}
                    </td>
                    {visibleTeams.map(t => {
                      const filled = Array.from({ length: 9 }, (_, h) => getScore(t.key, h)).filter((s): s is number => s != null);
                      const total = filled.length > 0 ? filled.reduce((a, b) => a + b, 0) : null;
                      return (
                        <td key={t.key} className="px-1 py-2 text-center font-serif text-sm font-semibold"
                          style={{ color: "hsl(42 45% 80%)" }}>
                          {total ?? "—"}
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
                  <td className="px-2 py-1 text-left sticky left-0 z-10"
                    style={{ background: holeIdx % 2 === 0 ? "hsl(158 45% 13%)" : "hsl(158 40% 15%)" }}>
                    <div className="font-serif text-sm font-semibold leading-tight" style={{ color: "hsl(42 45% 75%)" }}>
                      {holeIdx + 1}
                    </div>
                    <div className="text-[8px] font-sans leading-tight" style={{ color: "hsl(42 15% 50%)" }}>
                      {holeHcp[holeIdx]}
                    </div>
                  </td>
                  <td className="px-1 py-1 text-center">
                    <span className="font-serif text-sm" style={{ color: "hsl(42 35% 65%)" }}>
                      {par[holeIdx]}
                    </span>
                  </td>
                  {visibleTeams.map(t => {
                    const gross = getScore(t.key, holeIdx);
                    const isEditing = editingScramble?.teamKey === t.key && editingScramble?.hole === holeIdx;
                    return (
                      <td key={t.key} className="px-1 py-1 text-center">
                        {isEditing ? (
                          <input
                            ref={scrambleInputRef}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="off"
                            value={scrambleEditValue}
                            onChange={e => handleScrambleChange(e.target.value, t.key, holeIdx)}
                            onBlur={() => commitScramble(t.key, holeIdx)}
                            onKeyDown={e => handleScrambleKeyDown(e, t.key, holeIdx)}
                            className="w-9 h-8 text-center font-serif text-sm rounded-lg outline-none"
                            style={{
                              background: "white",
                              color: "hsl(38 30% 14%)",
                              border: "2px solid hsl(42 52% 59%)",
                            }}
                          />
                        ) : (
                          <button
                            onClick={() => startEditScramble(t.key, holeIdx)}
                            className={`w-9 h-8 rounded-lg font-serif text-sm font-semibold transition-all hover:scale-105 ${teamScoreClass(gross, par[holeIdx])}`}
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
                    <td className="px-2 py-2 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                      style={{ background: "hsl(158 50% 14%)", color: "hsl(42 52% 59%)" }}>IN</td>
                    <td className="px-1 py-2 text-center text-xs font-serif font-semibold"
                      style={{ color: "hsl(42 45% 75%)" }}>
                      {par.slice(9).reduce((a, b) => a + b, 0)}
                    </td>
                    {visibleTeams.map(t => {
                      const filled = Array.from({ length: 9 }, (_, h) => getScore(t.key, h + 9)).filter((s): s is number => s != null);
                      const total = filled.length > 0 ? filled.reduce((a, b) => a + b, 0) : null;
                      return (
                        <td key={t.key} className="px-1 py-2 text-center font-serif text-sm font-semibold"
                          style={{ color: "hsl(42 45% 80%)" }}>
                          {total ?? "—"}
                        </td>
                      );
                    })}
                  </tr>
                )}
              </Fragment>
            ))}
            {/* Total row */}
            <tr style={{ background: "hsl(158 60% 11%)", borderTop: "2px solid hsl(42 52% 59%)" }}>
              <td className="px-2 py-2 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                style={{ background: "hsl(158 60% 11%)", color: "hsl(42 52% 59%)" }}>TOT</td>
              <td className="px-1 py-2 text-center font-serif text-sm font-semibold"
                style={{ color: "hsl(42 45% 75%)" }}>
                {par.reduce((a, b) => a + b, 0)}
              </td>
              {visibleTeams.map(t => {
                const filled = Array.from({ length: 18 }, (_, h) => getScore(t.key, h)).filter((s): s is number => s != null);
                const total = filled.length > 0 ? filled.reduce((a, b) => a + b, 0) : null;
                return (
                  <td key={t.key} className="px-1 py-2 text-center font-serif text-base font-semibold"
                    style={{ color: "hsl(42 52% 59%)" }}>
                    {total ?? "—"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function RoundPage() {
  const { tripId: tripIdStr, roundId: roundIdStr } = useParams<{ tripId: string; roundId: string }>();
  const tripId = Number(tripIdStr);
  const roundId = Number(roundIdStr);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [subTab, setSubTab] = useState<SubTab>("scorecard");

  const { data: round, isLoading: roundLoading } = useGetRound(tripId, roundId, {
    query: { queryKey: getGetRoundQueryKey(tripId, roundId), enabled: !!tripId && !!roundId },
  });
  const { data: players } = useListPlayers(tripId, {
    query: { queryKey: getListPlayersQueryKey(tripId), enabled: !!tripId },
  });
  const { data: scoreRows, isLoading: scoresLoading } = useGetScores(tripId, roundId, {
    query: { queryKey: getGetScoresQueryKey(tripId, roundId), enabled: !!tripId && !!roundId, refetchInterval: 10000 },
  });
  const { data: leaderboard, isLoading: lbLoading } = useGetRoundLeaderboard(tripId, roundId, {
    query: { queryKey: getGetRoundLeaderboardQueryKey(tripId, roundId), enabled: subTab === "results", refetchInterval: 10000 },
  });

  const identity = useTripIdentity(tripId);
  const { data: groupsData } = useListRoundGroups(tripId, roundId, {
    query: { queryKey: getListRoundGroupsQueryKey(tripId, roundId), enabled: !!tripId && !!roundId },
  });
  const myGroupNumber: number | undefined = identity && groupsData
    ? groupsData.assignments.find(a => a.playerId === identity.playerId)?.groupNumber
    : undefined;

  const viewKey = `round:${roundId}:view`;
  const [viewMode, setViewMode] = useState<"mine" | "all">(() => {
    try {
      const stored = localStorage.getItem(viewKey);
      if (stored === "mine" || stored === "all") return stored;
    } catch {}
    return "mine";
  });
  useEffect(() => {
    try { localStorage.setItem(viewKey, viewMode); } catch {}
  }, [viewMode, viewKey]);

  const entryKey = `round:${roundId}:entry`;
  const [entryMode, setEntryMode] = useState<"mine" | "group">(() => {
    try {
      const stored = localStorage.getItem(entryKey);
      if (stored === "mine" || stored === "group") return stored;
    } catch {}
    return "group";
  });
  useEffect(() => {
    try { localStorage.setItem(entryKey, entryMode); } catch {}
  }, [entryMode, entryKey]);

  const effectiveMode: "mine" | "all" = myGroupNumber === undefined ? "all" : viewMode;

  const groupPlayerIds = new Set<number>(
    (groupsData?.assignments ?? []).filter(a => a.groupNumber === myGroupNumber).map(a => a.playerId)
  );

  // Build a slot lookup: playerId -> { groupNumber, slotIndex }
  const slotMap = new Map<number, { groupNumber: number; slotIndex: number }>(
    (groupsData?.assignments ?? []).map(a => [a.playerId, { groupNumber: a.groupNumber, slotIndex: a.slotIndex }])
  );

  const mySlotIndex = identity ? slotMap.get(identity.playerId)?.slotIndex : undefined;
  // Slots 1-2 = Team A, slots 3-4 = Team B
  const myTeamSide = mySlotIndex !== undefined ? (mySlotIndex <= 2 ? "A" : "B") : undefined;

  function playerSortKey(playerId: number): number {
    if (identity && playerId === identity.playerId) return 0; // me first
    const slot = slotMap.get(playerId);
    if (slot === undefined) return 100; // unassigned — original order
    if (myGroupNumber !== undefined && slot.groupNumber !== myGroupNumber) {
      // Different group in "all" view — sort by group then slot
      return 200 + slot.groupNumber * 10 + slot.slotIndex;
    }
    if (myTeamSide !== undefined) {
      const theirSide = slot.slotIndex <= 2 ? "A" : "B";
      if (theirSide === myTeamSide) return 1 + slot.slotIndex; // partner (same team)
      return 10 + slot.slotIndex; // other team in group
    }
    return 50 + slot.slotIndex;
  }

  const baseVisible = effectiveMode === "mine" && myGroupNumber !== undefined
    ? (players ?? []).filter(p => groupPlayerIds.has(p.id))
    : (players ?? []);

  const visiblePlayers = [...baseVisible].sort((a, b) => playerSortKey(a.id) - playerSortKey(b.id));

  const upsertScore = useUpsertScore();
  const updateRound = useUpdateRound();
  const upsertScrambleScore = useUpsertScrambleScore();

  // Scramble config + data
  const gamesConfig = (round?.gamesConfig ?? {}) as { scramble?: boolean; scrambleType?: ScrambleType | null };
  const scrambleEnabled = !!gamesConfig.scramble && !!gamesConfig.scrambleType;
  const scrambleType: ScrambleType | null = scrambleEnabled ? (gamesConfig.scrambleType ?? null) : null;

  const { data: scrambleScoresData } = useGetScrambleScores(tripId, roundId, {
    query: {
      queryKey: getGetScrambleScoresQueryKey(tripId, roundId),
      enabled: !!tripId && !!roundId && scrambleEnabled,
      refetchInterval: 10000,
    },
  });

  // Resolve scramble teams (groupNumber + side + member players) from group assignments.
  const scrambleTeams: ScrambleTeam[] = (() => {
    if (!scrambleType || !groupsData?.assignments || !players) return [];
    const playerNameById = new Map(players.map(p => [p.id, p.name]));
    const byGroup = new Map<number, { playerId: number; slotIndex: number }[]>();
    for (const a of groupsData.assignments) {
      const arr = byGroup.get(a.groupNumber) ?? [];
      arr.push({ playerId: a.playerId, slotIndex: a.slotIndex });
      byGroup.set(a.groupNumber, arr);
    }
    const teams: ScrambleTeam[] = [];
    for (const groupNumber of [...byGroup.keys()].sort((a, b) => a - b)) {
      const slots = byGroup.get(groupNumber)!.sort((a, b) => a.slotIndex - b.slotIndex);
      const nameOf = (id: number) => playerNameById.get(id)?.split(" ")[0] ?? `#${id}`;
      if (scrambleType === "fourMan") {
        teams.push({
          key: `${groupNumber}:G`,
          groupNumber,
          teamSide: "G",
          label: `Group ${groupNumber}`,
          playerIds: slots.map(s => s.playerId),
          playerNames: slots.map(s => nameOf(s.playerId)),
        });
      } else {
        const a = slots.filter(s => s.slotIndex <= 2);
        const b = slots.filter(s => s.slotIndex >= 3);
        if (a.length > 0) {
          teams.push({
            key: `${groupNumber}:A`,
            groupNumber,
            teamSide: "A",
            label: `G${groupNumber}·A`,
            playerIds: a.map(s => s.playerId),
            playerNames: a.map(s => nameOf(s.playerId)),
          });
        }
        if (b.length > 0) {
          teams.push({
            key: `${groupNumber}:B`,
            groupNumber,
            teamSide: "B",
            label: `G${groupNumber}·B`,
            playerIds: b.map(s => s.playerId),
            playerNames: b.map(s => nameOf(s.playerId)),
          });
        }
      }
    }
    return teams;
  })();

  // Map from team key to its 18-hole scores.
  const scrambleScoresByKey = new Map<string, (number | null)[]>();
  scrambleScoresData?.scores.forEach(s => {
    scrambleScoresByKey.set(`${s.groupNumber}:${s.teamSide}`, s.holeScores as (number | null)[]);
  });

  // My team key (for "mine" view in scramble mode)
  const myScrambleTeamKey: string | undefined = (() => {
    if (!scrambleType || myGroupNumber === undefined || mySlotIndex === undefined) return undefined;
    if (scrambleType === "fourMan") return `${myGroupNumber}:G`;
    return `${myGroupNumber}:${mySlotIndex <= 2 ? "A" : "B"}`;
  })();

  // Build a scores map: playerId -> holeScores[18]
  const scoresMap = new Map<number, (number | null)[]>();
  scoreRows?.forEach(s => {
    scoresMap.set(s.playerId, s.holeScores as (number | null)[]);
  });

  function getScore(playerId: number, holeIdx: number): number | null {
    return scoresMap.get(playerId)?.[holeIdx] ?? null;
  }

  function getScrambleScore(teamKey: string, holeIdx: number): number | null {
    return scrambleScoresByKey.get(teamKey)?.[holeIdx] ?? null;
  }

  // Inline editing state
  const [editingCell, setEditingCell] = useState<{ playerId: number; hole: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const autoAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scramble inline editing state (separate from individual cell editing)
  const [editingScramble, setEditingScramble] = useState<{ teamKey: string; hole: number } | null>(null);
  const [scrambleEditValue, setScrambleEditValue] = useState("");
  const scrambleInputRef = useRef<HTMLInputElement>(null);
  const scrambleAdvanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editingScramble && scrambleInputRef.current) {
      scrambleInputRef.current.focus();
      scrambleInputRef.current.select();
    }
  }, [editingScramble]);

  useEffect(() => {
    if (editingCell && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingCell]);

  // Find first empty cell. In "mine" entry mode, scan only the user's column
  // top-to-bottom; in "group" entry mode, scan row-by-row across players.
  function findFirstEmptyCell(): { playerId: number; holeIdx: number } | null {
    if (!visiblePlayers || visiblePlayers.length === 0) return null;
    if (entryMode === "mine" && identity) {
      const me = visiblePlayers.find(p => p.id === identity.playerId);
      if (me) {
        for (let h = 0; h < 18; h++) {
          if (getScore(me.id, h) == null) return { playerId: me.id, holeIdx: h };
        }
        return null;
      }
    }
    for (let h = 0; h < 18; h++) {
      for (const p of visiblePlayers) {
        if (getScore(p.id, h) == null) return { playerId: p.id, holeIdx: h };
      }
    }
    return null;
  }

  function startEdit(playerId: number, holeIdx: number) {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    const current = getScore(playerId, holeIdx);
    setEditingCell({ playerId, hole: holeIdx });
    setEditValue(current != null ? String(current) : "");
  }

  function startEditFirstEmpty() {
    const cell = findFirstEmptyCell();
    if (cell) startEdit(cell.playerId, cell.holeIdx);
  }

  function advanceToNext(playerId: number, holeIdx: number) {
    if (!visiblePlayers || visiblePlayers.length === 0) return;
    if (entryMode === "mine") {
      // Vertical: same player, next hole.
      const nextHole = holeIdx + 1;
      if (nextHole < 18) {
        setTimeout(() => startEdit(playerId, nextHole), 0);
      } else {
        setEditingCell(null);
      }
      return;
    }
    // Group: next player same hole, wrapping down to next hole.
    const currPlayerIdx = visiblePlayers.findIndex(p => p.id === playerId);
    const nextPlayerIdx = (currPlayerIdx + 1) % visiblePlayers.length;
    const nextHoleIdx = nextPlayerIdx === 0 ? holeIdx + 1 : holeIdx;
    if (nextHoleIdx < 18) {
      setTimeout(() => startEdit(visiblePlayers[nextPlayerIdx].id, nextHoleIdx), 0);
    } else {
      setEditingCell(null);
    }
  }

  function commitEditWithValue(playerId: number, holeIdx: number, val: string, andAdvance = false) {
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    const trimmed = val.trim();
    const score = trimmed === "" ? null : parseInt(trimmed);
    if (trimmed !== "" && (isNaN(score!) || score! < 1 || score! > 20)) {
      if (!andAdvance) setEditingCell(null);
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
    if (andAdvance) {
      advanceToNext(playerId, holeIdx);
    } else {
      setEditingCell(null);
    }
  }

  function commitEdit(playerId: number, holeIdx: number) {
    commitEditWithValue(playerId, holeIdx, editValue, false);
  }

  function handleScoreChange(val: string, playerId: number, holeIdx: number) {
    // Only allow digits
    const cleaned = val.replace(/\D/g, "").slice(0, 2);
    setEditValue(cleaned);
    if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
    const num = parseInt(cleaned);
    if (!isNaN(num) && num >= 1) {
      if (num >= 10) {
        // Two-digit score — commit immediately
        commitEditWithValue(playerId, holeIdx, cleaned, true);
      } else {
        // Single digit — short wait in case they type a second digit (e.g. 10–19)
        autoAdvanceTimer.current = setTimeout(() => {
          commitEditWithValue(playerId, holeIdx, cleaned, true);
        }, 500);
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent, playerId: number, holeIdx: number) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      commitEditWithValue(playerId, holeIdx, editValue, true);
    }
    if (e.key === "Escape") {
      if (autoAdvanceTimer.current) clearTimeout(autoAdvanceTimer.current);
      setEditingCell(null);
    }
  }

  // Scramble score editing
  function startEditScramble(teamKey: string, holeIdx: number) {
    if (scrambleAdvanceTimer.current) clearTimeout(scrambleAdvanceTimer.current);
    const current = getScrambleScore(teamKey, holeIdx);
    setEditingScramble({ teamKey, hole: holeIdx });
    setScrambleEditValue(current != null ? String(current) : "");
  }

  function advanceScrambleNext(teams: ScrambleTeam[], teamKey: string, holeIdx: number) {
    if (teams.length === 0) return;
    const idx = teams.findIndex(t => t.key === teamKey);
    const nextIdx = (idx + 1) % teams.length;
    const nextHole = nextIdx === 0 ? holeIdx + 1 : holeIdx;
    if (nextHole < 18) {
      setTimeout(() => startEditScramble(teams[nextIdx].key, nextHole), 0);
    } else {
      setEditingScramble(null);
    }
  }

  function commitScrambleWithValue(teams: ScrambleTeam[], teamKey: string, holeIdx: number, val: string, andAdvance = false) {
    if (scrambleAdvanceTimer.current) clearTimeout(scrambleAdvanceTimer.current);
    const team = teams.find(t => t.key === teamKey);
    if (!team) return;
    const trimmed = val.trim();
    const score = trimmed === "" ? null : parseInt(trimmed);
    if (trimmed !== "" && (isNaN(score!) || score! < 1 || score! > 20)) {
      if (!andAdvance) setEditingScramble(null);
      return;
    }
    upsertScrambleScore.mutate(
      {
        tripId,
        roundId,
        data: { groupNumber: team.groupNumber, teamSide: team.teamSide, hole: holeIdx + 1, score },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetScrambleScoresQueryKey(tripId, roundId) });
          queryClient.invalidateQueries({ queryKey: getGetRoundLeaderboardQueryKey(tripId, roundId) });
        },
      }
    );
    if (andAdvance) {
      advanceScrambleNext(teams, teamKey, holeIdx);
    } else {
      setEditingScramble(null);
    }
  }

  function handleScrambleChange(teams: ScrambleTeam[], val: string, teamKey: string, holeIdx: number) {
    const cleaned = val.replace(/\D/g, "").slice(0, 2);
    setScrambleEditValue(cleaned);
    if (scrambleAdvanceTimer.current) clearTimeout(scrambleAdvanceTimer.current);
    const num = parseInt(cleaned);
    if (!isNaN(num) && num >= 1) {
      if (num >= 10) {
        commitScrambleWithValue(teams, teamKey, holeIdx, cleaned, true);
      } else {
        scrambleAdvanceTimer.current = setTimeout(() => {
          commitScrambleWithValue(teams, teamKey, holeIdx, cleaned, true);
        }, 500);
      }
    }
  }

  function handleScrambleKeyDown(e: React.KeyboardEvent, teams: ScrambleTeam[], teamKey: string, holeIdx: number) {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (scrambleAdvanceTimer.current) clearTimeout(scrambleAdvanceTimer.current);
      commitScrambleWithValue(teams, teamKey, holeIdx, scrambleEditValue, true);
    }
    if (e.key === "Escape") {
      if (scrambleAdvanceTimer.current) clearTimeout(scrambleAdvanceTimer.current);
      setEditingScramble(null);
    }
  }

  // Setup state
  const [setupPar, setSetupPar] = useState<number[]>([]);
  const [setupHcp, setSetupHcp] = useState<number[]>([]);
  const [setupGames, setSetupGames] = useState<Record<string, boolean>>({});
  const [setupScramble, setSetupScramble] = useState(false);
  const [setupScrambleType, setSetupScrambleType] = useState<ScrambleType>("fourMan");
  const [setupCourse, setSetupCourse] = useState("");
  const [setupDate, setSetupDate] = useState("");
  const [setupHandicapMode, setSetupHandicapMode] = useState<HandicapMode>("net");
  const [setupTeeBox, setSetupTeeBox] = useState("");
  const [setupRating, setSetupRating] = useState("");
  const [setupSlope, setSetupSlope] = useState("");
  const setupInitialized = useRef(false);

  // Course lookup state for the Setup tab.
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupResults, setLookupResults] = useState<CourseSearchResult[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<CourseDetail | null>(null);
  const [selectedTeeId, setSelectedTeeId] = useState<string>("");

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
        .finally(() => { if (!ctrl.signal.aborted) setLookupLoading(false); });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [lookupQuery]);

  function applyTee(tee: CourseTee, clubName: string) {
    setSetupTeeBox(tee.name);
    setSetupRating(tee.rating != null ? String(tee.rating) : "");
    setSetupSlope(tee.slope != null ? String(tee.slope) : "");
    setSetupPar(tee.par);
    setSetupHcp(tee.holeHcp);
    setSelectedTeeId(tee.id);
    if (!setupCourse.trim()) setSetupCourse(clubName);
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
      if (detail.tees.length === 1) applyTee(detail.tees[0], detail.clubName);
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
    setLookupError(null);
  }

  useEffect(() => {
    if (round && !setupInitialized.current) {
      setSetupPar((round.par as number[]) || Array(18).fill(4));
      setSetupHcp((round.holeHcp as number[]) || Array.from({ length: 18 }, (_, i) => i + 1));
      const gc = round.gamesConfig as unknown as Record<string, unknown>;
      setSetupGames({
        stableford: (gc?.stableford as boolean) ?? true,
        skins: (gc?.skins as boolean) ?? true,
        nassau: (gc?.nassau as boolean) ?? true,
        netStroke: (gc?.netStroke as boolean) ?? true,
      });
      setSetupScramble((gc?.scramble as boolean) ?? false);
      const st = gc?.scrambleType as ScrambleType | null | undefined;
      setSetupScrambleType(st === "twoMan" ? "twoMan" : "fourMan");
      setSetupCourse(round.course ?? "");
      setSetupDate(round.date ?? "");
      setSetupHandicapMode((round.handicapMode as HandicapMode | undefined) ?? "net");
      setSetupTeeBox(round.teeBox ?? "");
      setSetupRating(round.courseRating != null ? String(round.courseRating) : "");
      setSetupSlope(round.courseSlope != null ? String(round.courseSlope) : "");
      setupInitialized.current = true;
    }
  }, [round]);

  function handleSaveSetup() {
    const ratingNum = parseFloat(setupRating);
    const slopeNum = parseInt(setupSlope);
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
            // Scramble takes over the round — disable individual games when on.
            stableford: setupScramble ? false : (setupGames.stableford ?? true),
            skins: setupScramble ? false : (setupGames.skins ?? true),
            nassau: setupScramble ? false : (setupGames.nassau ?? true),
            netStroke: setupScramble ? false : (setupGames.netStroke ?? true),
            bestBall: false,
            matchPlay: false,
            scramble: setupScramble,
            scrambleType: setupScramble ? setupScrambleType : null,
          },
          handicapMode: setupHandicapMode,
          teeBox: setupTeeBox.trim() || null,
          courseRating: isNaN(ratingNum) ? null : ratingNum,
          courseSlope: isNaN(slopeNum) ? null : slopeNum,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetRoundQueryKey(tripId, roundId) });
          queryClient.invalidateQueries({ queryKey: getGetRoundLeaderboardQueryKey(tripId, roundId) });
          queryClient.invalidateQueries({ queryKey: getGetTripLeaderboardQueryKey(tripId) });
        },
      }
    );
  }

  const par = (round?.par as number[]) || Array(18).fill(4);
  const holeHcp = (round?.holeHcp as number[]) || Array.from({ length: 18 }, (_, i) => i + 1);
  const handicapMode: HandicapMode = (round?.handicapMode as HandicapMode | undefined) ?? "net";
  const course: CourseInputs = {
    slope: round?.courseSlope ?? null,
    rating: round?.courseRating ?? null,
    totalPar: par.reduce((a, b) => a + b, 0),
  };

  // Playing handicap per player. In "net" mode each group's lowest handicap
  // plays scratch and others receive the integer difference from the WHS
  // course handicap formula relative to that group; in "gross" mode each
  // player plays their full course handicap. Players not assigned to a group
  // fall back to the field-wide minimum.
  const fieldMinHcp = players && players.length > 0
    ? Math.min(...players.map(p => p.handicap || 0))
    : 0;
  const groupMinHcp = new Map<number, number>();
  for (const a of groupsData?.assignments ?? []) {
    const p = (players ?? []).find(pp => pp.id === a.playerId);
    if (!p) continue;
    const h = p.handicap || 0;
    const cur = groupMinHcp.get(a.groupNumber);
    if (cur == null || h < cur) groupMinHcp.set(a.groupNumber, h);
  }
  const playerGroup = new Map<number, number>(
    (groupsData?.assignments ?? []).map(a => [a.playerId, a.groupNumber])
  );
  const playingHcps = new Map<number, number>(
    (players ?? []).map(p => {
      const grp = playerGroup.get(p.id);
      const ref = grp != null ? groupMinHcp.get(grp) ?? fieldMinHcp : fieldMinHcp;
      return [p.id, effectiveHandicap(p.handicap, ref, handicapMode, course)];
    })
  );
  // Course handicap (integer) per player, derived from overall index plus
  // the selected tee's slope/rating. Falls back to round(index) when slope
  // or rating are missing.
  const courseHcps = new Map<number, number>(
    (players ?? []).map(p => [p.id, whsCourseHandicap(p.handicap || 0, course)])
  );

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
          <div className="mt-2">
            <SignedInAs tripId={tripId} />
          </div>
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
      {subTab === "scorecard" && scrambleEnabled && (
        <ScrambleScorecard
          teams={scrambleTeams}
          myTeamKey={myScrambleTeamKey}
          viewMode={viewMode}
          setViewMode={setViewMode}
          par={par}
          holeHcp={holeHcp}
          getScore={getScrambleScore}
          editingScramble={editingScramble}
          startEditScramble={startEditScramble}
          scrambleEditValue={scrambleEditValue}
          handleScrambleChange={(val, teamKey, holeIdx) => handleScrambleChange(scrambleTeams, val, teamKey, holeIdx)}
          commitScramble={(teamKey, holeIdx) => commitScrambleWithValue(scrambleTeams, teamKey, holeIdx, scrambleEditValue, false)}
          handleScrambleKeyDown={(e, teamKey, holeIdx) => handleScrambleKeyDown(e, scrambleTeams, teamKey, holeIdx)}
          scrambleInputRef={scrambleInputRef}
          onNavigateToSetup={() => setSubTab("setup")}
        />
      )}
      {subTab === "scorecard" && !scrambleEnabled && (
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
            <>
              {myGroupNumber !== undefined && (
                <div className="flex items-center gap-2 mb-3 px-4 pt-3 text-xs font-sans">
                  <button
                    onClick={() => setViewMode("mine")}
                    className="px-3 py-1.5 rounded-lg font-600"
                    style={{
                      background: viewMode === "mine" ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
                      color: viewMode === "mine" ? "hsl(38 30% 12%)" : "hsl(42 35% 65%)",
                    }}
                  >
                    My group
                  </button>
                  <button
                    onClick={() => setViewMode("all")}
                    className="px-3 py-1.5 rounded-lg font-600"
                    style={{
                      background: viewMode === "all" ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
                      color: viewMode === "all" ? "hsl(38 30% 12%)" : "hsl(42 35% 65%)",
                    }}
                  >
                    All players
                  </button>
                </div>
              )}
              {identity && (
                <div className="flex items-center gap-2 mb-3 px-4 text-xs font-sans">
                  <span style={{ color: "hsl(42 20% 55%)" }}>Scoring:</span>
                  <button
                    onClick={() => setEntryMode("mine")}
                    className="px-3 py-1.5 rounded-lg font-600"
                    title="Enter only my scores; advances down my column"
                    style={{
                      background: entryMode === "mine" ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
                      color: entryMode === "mine" ? "hsl(38 30% 12%)" : "hsl(42 35% 65%)",
                    }}
                  >
                    Just me
                  </button>
                  <button
                    onClick={() => setEntryMode("group")}
                    className="px-3 py-1.5 rounded-lg font-600"
                    title="Enter scores for the group; advances across the row then to the next hole"
                    style={{
                      background: entryMode === "group" ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
                      color: entryMode === "group" ? "hsl(38 30% 12%)" : "hsl(42 35% 65%)",
                    }}
                  >
                    Whole group
                  </button>
                </div>
              )}
            <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
              <table className="w-full" style={{ minWidth: `${44 + 28 + visiblePlayers.length * 52}px` }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 28 }} />
                  {visiblePlayers.map(p => (
                    <col key={p.id} style={{ width: 52 }} />
                  ))}
                </colgroup>
                <thead>
                  <tr style={{ background: "hsl(158 65% 9%)", borderBottom: "2px solid hsl(42 52% 59%)" }}>
                    <th className="px-2 py-2 text-left text-xs font-sans font-semibold uppercase tracking-wider sticky left-0 z-20"
                      style={{ background: "hsl(158 65% 9%)", color: "hsl(42 20% 55%)" }}>Hole</th>
                    <th className="px-1 py-2 text-center text-xs font-sans font-semibold uppercase tracking-wider"
                      style={{ color: "hsl(42 20% 55%)" }}>Par</th>
                    {visiblePlayers.map(p => {
                      const ch = courseHcps.get(p.id) ?? 0;
                      const ph = playingHcps.get(p.id) ?? 0;
                      return (
                        <th key={p.id} className="px-1 py-2 text-center text-xs font-sans font-semibold"
                          style={{ color: "hsl(42 45% 80%)", ...(identity?.playerId === p.id ? { boxShadow: "inset 0 0 0 2px hsl(42 52% 59% / 0.6)" } : {}) }}>
                          <div style={{ maxWidth: 46, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name.split(" ")[0]}</div>
                          <div style={{ color: "hsl(42 20% 55%)", fontWeight: 400, fontSize: 9 }} title={`Index ${formatHandicap(p.handicap)} · Course HCP ${ch}${ph !== ch ? ` · Playing ${ph}` : ""}`}>
                            {ch}
                            {ph !== ch && (
                              <span style={{ color: "hsl(42 35% 50%)" }}>/{ph}</span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 18 }, (_, holeIdx) => {
                    const isSection = holeIdx === 9;
                    const outRow = holeIdx === 9;
                    return (
                      <Fragment key={holeIdx}>
                        {holeIdx === 9 && (
                          <tr key="out" style={{ background: "hsl(158 50% 14%)", borderTop: "2px solid hsl(42 52% 59%)" }}>
                            <td className="px-2 py-2 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                              style={{ background: "hsl(158 50% 14%)", color: "hsl(42 52% 59%)" }}>OUT</td>
                            <td className="px-1 py-2 text-center text-xs font-serif font-semibold"
                              style={{ color: "hsl(42 45% 75%)" }}>
                              {par.slice(0, 9).reduce((a, b) => a + b, 0)}
                            </td>
                            {visiblePlayers.map(p => {
                              const scores = scoresMap.get(p.id) || [];
                              const holesIn = scores.slice(0, 9).filter(s => s != null).length;
                              const outTotal = holesIn > 0 ? scores.slice(0, 9).filter((s): s is number => s != null).reduce((a, b) => a + b, 0) : null;
                              return (
                                <td key={p.id} className="px-1 py-2 text-center font-serif text-sm font-semibold"
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
                          <td className="px-2 py-1 text-left sticky left-0 z-10"
                            style={{ background: holeIdx % 2 === 0 ? "hsl(158 45% 13%)" : "hsl(158 40% 15%)" }}>
                            <div className="font-serif text-sm font-semibold leading-tight" style={{ color: "hsl(42 45% 75%)" }}>
                              {holeIdx + 1}
                            </div>
                            <div className="text-[8px] font-sans leading-tight" style={{ color: "hsl(42 15% 50%)" }}>
                              {holeHcp[holeIdx]}
                            </div>
                          </td>
                          <td className="px-1 py-1 text-center">
                            <span className="font-serif text-sm" style={{ color: "hsl(42 35% 65%)" }}>
                              {par[holeIdx]}
                            </span>
                          </td>
                          {visiblePlayers.map(p => {
                            const gross = getScore(p.id, holeIdx);
                            const isEditing = editingCell?.playerId === p.id && editingCell?.hole === holeIdx;
                            const pops = strokesOnHole(playingHcps.get(p.id) ?? 0, holeHcp[holeIdx]);
                            return (
                              <td key={p.id} className="px-1 py-1 text-center">
                                <div className="relative inline-block">
                                  {isEditing ? (
                                    <input
                                      ref={inputRef}
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      autoComplete="off"
                                      value={editValue}
                                      onChange={e => handleScoreChange(e.target.value, p.id, holeIdx)}
                                      onBlur={() => commitEdit(p.id, holeIdx)}
                                      onKeyDown={e => handleKeyDown(e, p.id, holeIdx)}
                                      className="w-9 h-8 text-center font-serif text-sm rounded-lg outline-none"
                                      style={{
                                        background: "white",
                                        color: "hsl(38 30% 14%)",
                                        border: "2px solid hsl(42 52% 59%)",
                                      }}
                                    />
                                  ) : (
                                    <button
                                      onClick={() => startEdit(p.id, holeIdx)}
                                      className={`w-9 h-8 rounded-lg font-serif text-sm font-semibold transition-all hover:scale-105 ${scoreClass(gross, par[holeIdx], playingHcps.get(p.id) ?? 0, holeHcp[holeIdx])}`}
                                      title={gross != null ? scoreLabel(gross, par[holeIdx], playingHcps.get(p.id) ?? 0, holeHcp[holeIdx]) : `Enter score for hole ${holeIdx + 1}`}
                                    >
                                      {gross ?? "·"}
                                    </button>
                                  )}
                                  {pops > 0 && (
                                    <span
                                      className="absolute -top-1 -right-1 text-[9px] font-bold leading-none pointer-events-none select-none"
                                      style={{ color: "hsl(42 80% 68%)" }}
                                    >
                                      {"*".repeat(pops)}
                                    </span>
                                  )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                        {holeIdx === 17 && (
                          <tr key="in-total" style={{ background: "hsl(158 50% 14%)", borderTop: "2px solid hsl(42 52% 59%)" }}>
                            <td className="px-2 py-2 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                              style={{ background: "hsl(158 50% 14%)", color: "hsl(42 52% 59%)" }}>IN</td>
                            <td className="px-1 py-2 text-center text-xs font-serif font-semibold"
                              style={{ color: "hsl(42 45% 75%)" }}>
                              {par.slice(9).reduce((a, b) => a + b, 0)}
                            </td>
                            {visiblePlayers.map(p => {
                              const scores = scoresMap.get(p.id) || [];
                              const holesIn = scores.slice(9).filter(s => s != null).length;
                              const inTotal = holesIn > 0 ? scores.slice(9).filter((s): s is number => s != null).reduce((a, b) => a + b, 0) : null;
                              return (
                                <td key={p.id} className="px-1 py-2 text-center font-serif text-sm font-semibold"
                                  style={{ color: "hsl(42 45% 80%)" }}>
                                  {inTotal ?? "—"}
                                </td>
                              );
                            })}
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {/* Total row */}
                  <tr style={{ background: "hsl(158 60% 11%)", borderTop: "2px solid hsl(42 52% 59%)" }}>
                    <td className="px-2 py-2 text-xs font-sans font-semibold uppercase tracking-widest sticky left-0 z-20"
                      style={{ background: "hsl(158 60% 11%)", color: "hsl(42 52% 59%)" }}>TOT</td>
                    <td className="px-1 py-2 text-center font-serif text-sm font-semibold"
                      style={{ color: "hsl(42 45% 75%)" }}>
                      {par.reduce((a, b) => a + b, 0)}
                    </td>
                    {visiblePlayers.map(p => {
                      const scores = scoresMap.get(p.id) || [];
                      const played = scores.filter(s => s != null).length;
                      const total = played > 0 ? scores.filter((s): s is number => s != null).reduce((a, b) => a + b, 0) : null;
                      return (
                        <td key={p.id} className="px-1 py-2 text-center font-serif text-base font-semibold"
                          style={{ color: "hsl(42 52% 59%)" }}>
                          {total ?? "—"}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            </>
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

              {/* Scramble leaderboard — replaces individual results when scramble is on */}
              {scrambleEnabled && leaderboard.scrambleResult && leaderboard.scrambleResult.teams.length > 0 && (
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(158 40% 22%)" }}>
                  <div className="px-4 py-2.5 grid grid-cols-[2fr_1fr_1fr_1fr] text-xs font-sans font-semibold uppercase tracking-widest"
                    style={{ background: "hsl(158 50% 14%)", color: "hsl(42 20% 55%)" }}>
                    <span>Team {scrambleType === "twoMan" ? "(2-man)" : "(4-man)"}</span>
                    <span className="text-right">Out</span>
                    <span className="text-right">In</span>
                    <span className="text-right">Total</span>
                  </div>
                  {[...leaderboard.scrambleResult.teams]
                    .sort((a, b) => {
                      const at = a.grossTotal ?? Number.POSITIVE_INFINITY;
                      const bt = b.grossTotal ?? Number.POSITIVE_INFINITY;
                      if (at !== bt) return at - bt;
                      return a.groupNumber - b.groupNumber;
                    })
                    .map((t, idx) => {
                      const label = t.teamSide === "G"
                        ? `Group ${t.groupNumber}`
                        : `Group ${t.groupNumber} · Cart ${t.teamSide}`;
                      return (
                        <div
                          key={`${t.groupNumber}-${t.teamSide}`}
                          className="px-4 py-3 grid grid-cols-[2fr_1fr_1fr_1fr] items-center"
                          style={{
                            background: idx === 0 ? "hsl(42 30% 88%)" : idx % 2 === 0 ? "hsl(42 20% 93%)" : "hsl(42 15% 90%)",
                            borderTop: "1px solid hsl(38 25% 78%)",
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-sans font-semibold w-4 text-center" style={{ color: "hsl(38 20% 45%)" }}>{idx + 1}</span>
                            <div>
                              <div className="font-sans font-semibold text-sm" style={{ color: "hsl(38 30% 14%)" }}>{label}</div>
                              <div className="text-[10px]" style={{ color: "hsl(38 20% 42%)" }}>
                                {t.playerNames.join(" / ")} · {t.holesPlayed}/18
                              </div>
                            </div>
                          </div>
                          <div className="text-right font-serif text-sm" style={{ color: "hsl(38 30% 25%)" }}>{t.grossOut ?? "—"}</div>
                          <div className="text-right font-serif text-sm" style={{ color: "hsl(38 30% 25%)" }}>{t.grossIn ?? "—"}</div>
                          <div className="text-right font-serif text-sm font-semibold" style={{ color: idx === 0 ? "hsl(148 45% 30%)" : "hsl(38 30% 18%)" }}>
                            {t.grossTotal ?? "—"}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
              {scrambleEnabled && (!leaderboard.scrambleResult || leaderboard.scrambleResult.teams.length === 0) && (
                <div className="rounded-xl px-4 py-6 text-center" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
                  <p className="text-sm font-sans" style={{ color: "hsl(38 20% 45%)" }}>
                    Assign players to groups in Setup to start scoring the scramble.
                  </p>
                </div>
              )}

              {/* Net Stroke & Stableford */}
              {!scrambleEnabled && (
              <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(158 40% 22%)" }}>
                <div className="px-4 py-2.5 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] text-xs font-sans font-semibold uppercase tracking-widest"
                  style={{ background: "hsl(158 50% 14%)", color: "hsl(42 20% 55%)" }}>
                  <span>Player</span>
                  <span className="text-right">Gross</span>
                  <span className="text-right flex items-center justify-end gap-1">Net <GameInfoButton game="netStroke" size={12} /></span>
                  <span className="text-right flex items-center justify-end gap-1">Stblfd <GameInfoButton game="stableford" size={12} /></span>
                  <span className="text-right flex items-center justify-end gap-1">Skins <GameInfoButton game="skins" size={12} /></span>
                </div>
                {[...leaderboard.entries]
                  .sort((a, b) => (b.stablefordTotal ?? 0) - (a.stablefordTotal ?? 0))
                  .map((e, idx) => (
                    <div
                      key={e.playerId}
                      className="px-4 py-3 grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center"
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
              )}

              {/* Team Nassau — one card per group match */}
              {!scrambleEnabled && (round?.gamesConfig as { nassau?: boolean } | undefined)?.nassau !== false &&
                leaderboard.nassauResult?.matches &&
                leaderboard.nassauResult.matches.length > 0 && (
                <div className="space-y-3">
                  <h3 className="font-sans font-semibold text-xs uppercase tracking-widest flex items-center gap-1.5" style={{ color: "hsl(42 52% 59%)" }}>
                    Team Nassau
                    <GameInfoButton game="nassau" size={13} />
                  </h3>
                  {leaderboard.nassauResult.matches.map(m => {
                    const nameFor = (id: number) =>
                      leaderboard.entries.find(e => e.playerId === id)?.playerName?.split(" ")[0] ?? `#${id}`;
                    const teamAName = m.teamAPlayerIds.map(nameFor).join(" / ") || "—";
                    const teamBName = m.teamBPlayerIds.map(nameFor).join(" / ") || "—";
                    const outcomeLabel = (side: "A" | "B" | "halved" | null, margin: number) => {
                      if (side == null) return "—";
                      if (side === "halved") return "All square";
                      return `${side === "A" ? `Team ${m.teamA}` : `Team ${m.teamB}`} ${margin} up`;
                    };
                    return (
                      <div key={m.groupNumber} className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
                        <div className="flex items-baseline justify-between mb-2">
                          <div className="font-sans font-semibold text-xs uppercase tracking-widest" style={{ color: "hsl(38 20% 38%)" }}>
                            Group {m.groupNumber}
                          </div>
                          <div className="font-sans text-xs" style={{ color: "hsl(38 20% 45%)" }}>
                            Team {m.teamA} ({teamAName}) vs Team {m.teamB} ({teamBName})
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: "Front 9", side: m.front, margin: m.frontMargin },
                            { label: "Back 9", side: m.back, margin: m.backMargin },
                            { label: "Total 18", side: m.total, margin: m.totalMargin },
                          ].map(seg => (
                            <div key={seg.label} className="rounded-lg p-3 text-center" style={{ background: "hsl(158 35% 20%)" }}>
                              <div className="text-[10px] font-sans uppercase tracking-widest mb-1" style={{ color: "hsl(42 20% 55%)" }}>{seg.label}</div>
                              <div className="font-serif text-sm font-semibold" style={{ color: "hsl(42 52% 59%)" }}>
                                {outcomeLabel(seg.side, seg.margin)}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Skins */}
              {!scrambleEnabled && leaderboard.skinResults && leaderboard.skinResults.some(s => s.winnerId != null || s.tied) && (
                <div className="rounded-xl overflow-hidden" style={{ border: "1px solid hsl(158 40% 22%)" }}>
                  <div className="px-4 py-2.5 grid grid-cols-[1fr_2fr_1fr] text-xs font-sans font-semibold uppercase tracking-widest"
                    style={{ background: "hsl(158 50% 14%)", color: "hsl(42 20% 55%)" }}>
                    <span>Hole</span>
                    <span className="flex items-center gap-1">Winner <GameInfoButton game="skins" size={12} /></span>
                    <span className="text-right">Skins</span>
                  </div>
                  {leaderboard.skinResults.map((s, idx) => (
                    <div
                      key={s.hole}
                      className="px-4 py-2.5 grid grid-cols-[1fr_2fr_1fr] items-center"
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
          <section className="mb-6">
            <h2 className="text-sm font-sans font-600 uppercase tracking-widest mb-3" style={{ color: "hsl(42 52% 59%)" }}>
              Groups
            </h2>
            <RoundGroupsEditor tripId={tripId} roundId={roundId} />
          </section>
          {/* Course lookup */}
          <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
            <h3 className="font-sans font-semibold text-xs uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>Look up course</h3>
            <p className="text-xs font-sans mb-2" style={{ color: "hsl(38 20% 45%)" }}>
              Type a club name, pick a course and a tee to populate slope, rating, par and stroke index.
            </p>
            <div className="relative">
              <input
                value={lookupQuery}
                onChange={e => { setLookupQuery(e.target.value); setSelectedCourse(null); setSelectedTeeId(""); }}
                placeholder="e.g. Pinehurst"
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
                      className="w-full text-left px-3 py-2 text-sm font-sans hover:opacity-80"
                      style={{ color: "hsl(38 30% 14%)", borderBottom: "1px solid hsl(38 25% 88%)" }}
                    >
                      <div className="font-semibold">{r.clubName}{r.courseName ? ` — ${r.courseName}` : ""}</div>
                      {r.location && (
                        <div className="text-xs" style={{ color: "hsl(38 20% 45%)" }}>{r.location}</div>
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
              <div className="mt-2 rounded-lg px-3 py-2 flex items-center justify-between"
                style={{ background: "hsl(42 30% 86%)", border: "1px solid hsl(38 25% 78%)" }}>
                <div className="text-xs font-sans" style={{ color: "hsl(38 30% 14%)" }}>
                  <div className="font-semibold">{selectedCourse.clubName}</div>
                  {selectedCourse.courseName && (
                    <div style={{ color: "hsl(38 20% 45%)" }}>{selectedCourse.courseName}</div>
                  )}
                </div>
                <button type="button" onClick={clearLookup}
                  className="text-xs font-sans" style={{ color: "hsl(38 20% 45%)" }}>
                  Clear
                </button>
              </div>
            )}
            {selectedCourse && selectedCourse.tees.length > 0 && (
              <div className="mt-3">
                <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>
                  Tee box ({selectedCourse.tees.length})
                </label>
                <select
                  value={selectedTeeId}
                  onChange={e => {
                    const tee = selectedCourse.tees.find(t => t.id === e.target.value);
                    if (tee) applyTee(tee, selectedCourse.clubName);
                  }}
                  className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                >
                  <option value="">Select a tee…</option>
                  {selectedCourse.tees.map(t => {
                    const meta = [
                      t.gender,
                      t.rating != null ? `CR ${t.rating}` : null,
                      t.slope != null ? `SR ${t.slope}` : null,
                      t.totalYards != null ? `${t.totalYards} yds` : null,
                    ].filter(Boolean).join(" · ");
                    return (
                      <option key={t.id} value={t.id}>
                        {t.name}{meta ? ` (${meta})` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}
          </div>

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
              <div className="min-w-0">
                <label className="block text-xs font-sans mb-1" style={{ color: "hsl(38 20% 38%)" }}>Date</label>
                <input
                  type="date"
                  value={setupDate}
                  onChange={e => setSetupDate(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 rounded-lg text-sm font-sans outline-none"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <div>
                <label className="block text-xs font-sans mb-1" style={{ color: "hsl(38 20% 38%)" }}>Tee Box</label>
                <input
                  value={setupTeeBox}
                  onChange={e => setSetupTeeBox(e.target.value)}
                  placeholder="Blue"
                  className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-sans mb-1" style={{ color: "hsl(38 20% 38%)" }}>Rating</label>
                <input
                  type="number" step="0.1" min="55" max="80"
                  value={setupRating}
                  onChange={e => setSetupRating(e.target.value)}
                  placeholder="71.4"
                  className="w-full px-3 py-2 rounded-lg text-sm font-sans text-center outline-none"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
              </div>
              <div>
                <label className="block text-xs font-sans mb-1" style={{ color: "hsl(38 20% 38%)" }}>Slope</label>
                <input
                  type="number" min="55" max="155"
                  value={setupSlope}
                  onChange={e => setSetupSlope(e.target.value)}
                  placeholder="113"
                  className="w-full px-3 py-2 rounded-lg text-sm font-sans text-center outline-none"
                  style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
                />
              </div>
            </div>
          </div>

          {/* Handicap mode */}
          <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
            <h3 className="font-sans font-semibold text-xs uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>Handicap</h3>
            <p className="text-xs font-sans mb-3" style={{ color: "hsl(38 20% 45%)" }}>
              {setupHandicapMode === "net"
                ? "Net: lowest handicap plays scratch, others play the difference."
                : "Gross: every player plays their full handicap."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(["net", "gross"] as const).map(mode => {
                const selected = setupHandicapMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSetupHandicapMode(mode)}
                    className="py-2 rounded-lg text-sm font-sans font-semibold uppercase tracking-widest transition-all"
                    style={{
                      background: selected ? "hsl(42 52% 59%)" : "white",
                      color: selected ? "hsl(38 30% 12%)" : "hsl(38 20% 38%)",
                      border: selected ? "1.5px solid hsl(42 52% 59%)" : "1.5px solid hsl(38 25% 72%)",
                    }}
                  >
                    {mode}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Games */}
          <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-sans font-semibold text-xs uppercase tracking-widest" style={{ color: "hsl(38 20% 38%)" }}>Active Games</h3>
              <GameInfoButton game="handicaps" size={13} label="How scoring works" />
            </div>
            <div className="space-y-2">
              {(["stableford", "skins", "nassau", "netStroke"] as const).map(game => {
                const disabled = setupScramble;
                return (
                  <label key={game} className={`flex items-center justify-between py-1.5 ${disabled ? "opacity-40" : "cursor-pointer"}`}>
                    <span className="font-sans text-sm font-semibold flex items-center gap-1.5" style={{ color: "hsl(38 30% 14%)" }}>
                      {game === "netStroke" ? "Net Stroke Play" : game === "nassau" ? "Team Nassau" : game.charAt(0).toUpperCase() + game.slice(1)}
                      <GameInfoButton game={game} size={13} />
                    </span>
                    <div
                      onClick={() => { if (!disabled) setSetupGames(g => ({ ...g, [game]: !g[game] })); }}
                      className="rounded-full relative transition-all"
                      style={{
                        background: disabled ? "hsl(38 20% 75%)" : (setupGames[game] ? "hsl(42 52% 59%)" : "hsl(38 20% 70%)"),
                        width: 40, height: 22,
                        cursor: disabled ? "not-allowed" : "pointer",
                      }}
                    >
                      <div
                        className="absolute top-0.5 rounded-full transition-all"
                        style={{
                          width: 18, height: 18,
                          background: "white",
                          left: !disabled && setupGames[game] ? 20 : 2,
                          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                        }}
                      />
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Scramble */}
          <div className="rounded-xl p-4" style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="font-sans font-semibold text-xs uppercase tracking-widest" style={{ color: "hsl(38 20% 38%)" }}>Scramble</h3>
                <p className="text-xs font-sans mt-1" style={{ color: "hsl(38 20% 45%)" }}>
                  One score per team per hole. Replaces individual games.
                </p>
              </div>
              <div
                onClick={() => setSetupScramble(v => !v)}
                className="rounded-full relative transition-all cursor-pointer flex-shrink-0"
                style={{
                  background: setupScramble ? "hsl(42 52% 59%)" : "hsl(38 20% 70%)",
                  width: 40, height: 22,
                }}
              >
                <div
                  className="absolute top-0.5 rounded-full transition-all"
                  style={{
                    width: 18, height: 18,
                    background: "white",
                    left: setupScramble ? 20 : 2,
                    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }}
                />
              </div>
            </div>
            {setupScramble && (
              <div className="grid grid-cols-2 gap-2 mt-3">
                {(["fourMan", "twoMan"] as const).map(t => {
                  const selected = setupScrambleType === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSetupScrambleType(t)}
                      className="py-2 rounded-lg text-sm font-sans font-semibold uppercase tracking-widest transition-all"
                      style={{
                        background: selected ? "hsl(42 52% 59%)" : "white",
                        color: selected ? "hsl(38 30% 12%)" : "hsl(38 20% 38%)",
                        border: selected ? "1.5px solid hsl(42 52% 59%)" : "1.5px solid hsl(38 25% 72%)",
                      }}
                    >
                      {t === "fourMan" ? "4-Man (group)" : "2-Man (cart)"}
                    </button>
                  );
                })}
              </div>
            )}
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
