import { useState, useEffect, useRef } from "react";
import {
  Trophy, Users, Target, DollarSign, ChevronRight, Plus, Trash2,
  Check, X, Edit3, Award, TrendingUp, TrendingDown, Flag,
  Settings, ArrowLeft, Calendar, MapPin, GripVertical,
  UserPlus, Car, Swords, Layers
} from "lucide-react";

// ============ SCORING HELPERS ============

function strokesOnHole(playerHcp, holeHcpIdx) {
  const h = Number(playerHcp) || 0;
  let strokes = 0;
  if (h >= holeHcpIdx) strokes += 1;
  if (h >= 18 + holeHcpIdx) strokes += 1;
  if (h >= 36 + holeHcpIdx) strokes += 1;
  return strokes;
}

function netForHole(gross, playerHcp, holeHcpIdx) {
  if (gross == null || gross === "") return null;
  return Number(gross) - strokesOnHole(playerHcp, holeHcpIdx);
}

function stablefordPoints(net, par) {
  if (net == null) return 0;
  const diff = net - par;
  if (diff <= -3) return 5;
  if (diff === -2) return 4;
  if (diff === -1) return 3;
  if (diff === 0) return 2;
  if (diff === 1) return 1;
  return 0;
}

function sumRange(arr, start, end) {
  let total = 0, any = false;
  for (let i = start; i < end; i++) {
    const v = arr?.[i];
    if (v != null && v !== "") { total += Number(v); any = true; }
  }
  return any ? total : null;
}

function computeRoundStats(round, player) {
  const scores = round.scores?.[player.id] || [];
  const gross = [], net = [], sfPoints = [];
  let grossOut = 0, grossIn = 0, grossTotal = 0;
  let netOut = 0, netIn = 0, netTotal = 0;
  let sfOut = 0, sfIn = 0, sfTotal = 0;
  let holesPlayed = 0;

  for (let h = 0; h < 18; h++) {
    const g = scores[h];
    if (g != null && g !== "") {
      const gNum = Number(g);
      const n = gNum - strokesOnHole(player.handicap, round.holeHcp[h]);
      const sf = stablefordPoints(n, round.par[h]);
      gross[h] = gNum; net[h] = n; sfPoints[h] = sf;
      grossTotal += gNum; netTotal += n; sfTotal += sf;
      if (h < 9) { grossOut += gNum; netOut += n; sfOut += sf; }
      else { grossIn += gNum; netIn += n; sfIn += sf; }
      holesPlayed++;
    } else {
      gross[h] = null; net[h] = null; sfPoints[h] = null;
    }
  }

  return {
    gross, net, sfPoints,
    grossOut, grossIn, grossTotal,
    netOut, netIn, netTotal,
    sfOut, sfIn, sfTotal,
    holesPlayed, complete: holesPlayed === 18,
  };
}

function computeSkins(round, players) {
  const skinsWon = {};
  players.forEach(p => skinsWon[p.id] = 0);
  let carry = 1;
  const perHole = [];

  for (let h = 0; h < 18; h++) {
    const entries = players.map(p => {
      const g = round.scores?.[p.id]?.[h];
      if (g == null || g === "") return null;
      return { id: p.id, net: Number(g) - strokesOnHole(p.handicap, round.holeHcp[h]) };
    }).filter(Boolean);

    if (entries.length < 2) { perHole.push({ winner: null, carry }); continue; }
    const low = Math.min(...entries.map(e => e.net));
    const winners = entries.filter(e => e.net === low);
    if (winners.length === 1) {
      skinsWon[winners[0].id] += carry;
      perHole.push({ winner: winners[0].id, carry });
      carry = 1;
    } else {
      perHole.push({ winner: null, carry, tied: true });
      carry += 1;
    }
  }
  return { skinsWon, perHole };
}

function computeNassau(round, players) {
  const result = { front: null, back: null, total: null };
  const stats = players.map(p => ({ id: p.id, ...computeRoundStats(round, p) }));

  const frontPlayers = stats.filter(s => { for (let h = 0; h < 9; h++) if (s.gross[h] == null) return false; return true; });
  if (frontPlayers.length > 0) {
    const low = Math.min(...frontPlayers.map(s => s.netOut));
    result.front = { winners: frontPlayers.filter(s => s.netOut === low).map(s => s.id), score: low };
  }
  const backPlayers = stats.filter(s => { for (let h = 9; h < 18; h++) if (s.gross[h] == null) return false; return true; });
  if (backPlayers.length > 0) {
    const low = Math.min(...backPlayers.map(s => s.netIn));
    result.back = { winners: backPlayers.filter(s => s.netIn === low).map(s => s.id), score: low };
  }
  const totalPlayers = stats.filter(s => s.complete);
  if (totalPlayers.length > 0) {
    const low = Math.min(...totalPlayers.map(s => s.netTotal));
    result.total = { winners: totalPlayers.filter(s => s.netTotal === low).map(s => s.id), score: low };
  }
  return result;
}

function computeBestBall(round, teams, players) {
  return teams.map(team => {
    const members = team.playerIds.map(id => players.find(p => p.id === id)).filter(Boolean);
    const holeScores = Array(18).fill(null);
    let total = 0, holesPlayed = 0;
    for (let h = 0; h < 18; h++) {
      const nets = members.map(p => {
        const g = round.scores?.[p.id]?.[h];
        if (g == null || g === "") return null;
        return Number(g) - strokesOnHole(p.handicap, round.holeHcp[h]);
      }).filter(n => n != null);
      if (nets.length > 0) {
        const low = Math.min(...nets);
        holeScores[h] = low;
        total += low;
        holesPlayed++;
      }
    }
    return { team, members, holeScores, total, holesPlayed };
  });
}

function computeMatchPlay(round, matches, players) {
  return matches.map(m => {
    const pa = players.find(p => p.id === m.playerA);
    const pb = players.find(p => p.id === m.playerB);
    if (!pa || !pb) return null;
    let aUp = 0, holesPlayed = 0;
    const holes = [];
    for (let h = 0; h < 18; h++) {
      const ga = round.scores?.[pa.id]?.[h];
      const gb = round.scores?.[pb.id]?.[h];
      if (ga == null || gb == null || ga === "" || gb === "") { holes.push(null); continue; }
      const na = Number(ga) - strokesOnHole(pa.handicap, round.holeHcp[h]);
      const nb = Number(gb) - strokesOnHole(pb.handicap, round.holeHcp[h]);
      if (na < nb) { aUp += 1; holes.push("A"); }
      else if (nb < na) { aUp -= 1; holes.push("B"); }
      else { holes.push("H"); }
      holesPlayed++;
    }
    const remaining = 18 - holesPlayed;
    let status, closed = false;
    if (Math.abs(aUp) > remaining && holesPlayed > 0) {
      const leader = aUp > 0 ? pa : pb;
      status = `${leader.name.split(" ")[0]} wins ${Math.abs(aUp)}&${remaining}`;
      closed = true;
    } else if (holesPlayed === 18) {
      if (aUp > 0) status = `${pa.name.split(" ")[0]} wins ${aUp} up`;
      else if (aUp < 0) status = `${pb.name.split(" ")[0]} wins ${Math.abs(aUp)} up`;
      else status = "Halved";
    } else {
      if (aUp > 0) status = `${pa.name.split(" ")[0]} ${aUp} up`;
      else if (aUp < 0) status = `${pb.name.split(" ")[0]} ${Math.abs(aUp)} up`;
      else status = holesPlayed === 0 ? "Not started" : "All square";
    }
    return { match: m, playerA: pa, playerB: pb, aUp, holesPlayed, holes, status, closed };
  }).filter(Boolean);
}

// ============ DEFAULTS & MIGRATION ============

const DEFAULT_PLAYERS = Array.from({ length: 8 }, (_, i) => ({
  id: `p${i + 1}`,
  name: `Player ${i + 1}`,
  handicap: 18,
}));

const DEFAULT_GAMES = () => ({
  stableford: { enabled: true },
  skins: { enabled: true },
  nassau: { enabled: true },
  netStroke: { enabled: true },
  bestBall: { enabled: false, teams: [] },
  matchPlay: { enabled: false, matches: [] },
});

const DEFAULT_ROUND = (n) => ({
  id: `r${n}`,
  name: `Round ${n}`,
  course: "",
  date: "",
  par: Array(18).fill(4),
  holeHcp: Array.from({ length: 18 }, (_, i) => i + 1),
  scores: {},
  carts: [],
  games: DEFAULT_GAMES(),
});

function migrateRound(r) {
  if (!r) return DEFAULT_ROUND(1);
  const games = DEFAULT_GAMES();
  if (r.games) {
    Object.keys(r.games).forEach(k => {
      const v = r.games[k];
      if (typeof v === "boolean") games[k] = { ...games[k], enabled: v };
      else if (v && typeof v === "object") games[k] = { ...games[k], ...v };
    });
  }
  return {
    ...DEFAULT_ROUND(1),
    ...r,
    carts: Array.isArray(r.carts) ? r.carts : [],
    games,
  };
}

// ============ STORAGE HOOK ============

function useStoredState(key, initial, migrate) {
  const [value, setValue] = useState(initial);
  const [loaded, setLoaded] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get(key);
        if (r && r.value) {
          const parsed = JSON.parse(r.value);
          setValue(migrate ? migrate(parsed) : parsed);
        }
      } catch (_) { }
      setLoaded(true);
    })();
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    if (first.current) { first.current = false; return; }
    (async () => {
      try { await window.storage.set(key, JSON.stringify(value)); } catch (_) { }
    })();
  }, [value, loaded, key]);

  return [value, setValue, loaded];
}

// ============ THEME ============

const TH = {
  forest: "#0f3d2e",
  forestDeep: "#0a2a20",
  forestLight: "#1a5540",
  cream: "#f5efdf",
  creamDark: "#e8dfc7",
  brass: "#c9a961",
  brassDark: "#a68a4a",
  ink: "#2a2418",
  ink60: "#6b5f4a",
  red: "#a14545",
  green: "#3a7d4c",
};

// ============ DRAG BOARD ============
// A reusable drag-and-drop board. Columns contain player chips.
// Drag from any column to any other. Works on pointer (touch + mouse).

function DragBoard({ columns, players, onMove, columnActions }) {
  // columns: [{ id, title, subtitle, playerIds, accent, capacity, isPool }]
  // onMove(playerId, fromColumnId, toColumnId)
  const [drag, setDrag] = useState(null); // { playerId, fromCol, name }
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [hoverCol, setHoverCol] = useState(null);
  const dragRef = useRef(null);
  const hoverRef = useRef(null);
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);

  useEffect(() => {
    if (!drag) return;
    dragRef.current = drag;

    const handlePointerMove = (e) => {
      const x = e.clientX ?? e.touches?.[0]?.clientX;
      const y = e.clientY ?? e.touches?.[0]?.clientY;
      if (x == null) return;
      setPos({ x, y });
      const el = document.elementFromPoint(x, y);
      const zone = el?.closest("[data-colid]");
      const cid = zone?.getAttribute("data-colid") || null;
      hoverRef.current = cid;
      setHoverCol(cid);
    };

    const handlePointerUp = () => {
      const d = dragRef.current;
      const h = hoverRef.current;
      if (d && h && h !== d.fromCol) {
        onMoveRef.current(d.playerId, d.fromCol, h);
      }
      setDrag(null);
      setHoverCol(null);
      dragRef.current = null;
      hoverRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [drag]);

  const startDrag = (playerId, fromCol, name, e) => {
    setDrag({ playerId, fromCol, name });
    setPos({ x: e.clientX, y: e.clientY });
  };

  return (
    <>
      <div className="space-y-2.5">
        {columns.map(col => {
          const isHover = hoverCol === col.id && drag && drag.fromCol !== col.id;
          const full = col.capacity != null && col.playerIds.length >= col.capacity;
          const isPool = col.isPool;

          return (
            <div
              key={col.id}
              data-colid={col.id}
              className="rounded-xl transition-all"
              style={{
                background: isPool
                  ? (isHover ? `${TH.brass}25` : `${TH.ink}06`)
                  : (isHover ? `${col.accent || TH.brass}30` : TH.creamDark),
                border: `2px ${isHover ? "solid" : "dashed"} ${isHover ? (col.accent || TH.brass) : `${TH.ink}18`}`,
                minHeight: isPool ? 56 : 72,
              }}
            >
              <div className="px-3 pt-2.5 pb-1 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.15em] font-bold" style={{ color: TH.ink60 }}>
                    {col.title}
                    {col.capacity != null && (
                      <span className="ml-1.5 opacity-60">
                        {col.playerIds.length}/{col.capacity}
                      </span>
                    )}
                  </div>
                  {col.subtitle && (
                    <div className="text-[11px]" style={{ color: TH.ink60 }}>{col.subtitle}</div>
                  )}
                </div>
                {columnActions && columnActions(col)}
              </div>
              <div className="px-2 pb-2 flex flex-wrap gap-1.5 min-h-[44px]">
                {col.playerIds.length === 0 && (
                  <div className="px-2 py-2 text-[11px] italic" style={{ color: `${TH.ink}50` }}>
                    {isPool ? "Everyone assigned" : "Drag players here"}
                  </div>
                )}
                {col.playerIds.map(pid => {
                  const p = players.find(x => x.id === pid);
                  if (!p) return null;
                  const isDraggingThis = drag?.playerId === pid;
                  return (
                    <div
                      key={pid}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        startDrag(pid, col.id, p.name, e);
                      }}
                      className="select-none flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] font-semibold cursor-grab active:cursor-grabbing transition-opacity"
                      style={{
                        background: col.accent || TH.forest,
                        color: TH.cream,
                        touchAction: "none",
                        opacity: isDraggingThis ? 0.3 : 1,
                      }}
                    >
                      <GripVertical size={12} style={{ opacity: 0.6 }} />
                      <span className="truncate max-w-[110px]">{p.name}</span>
                    </div>
                  );
                })}
                {full && !isHover && (
                  <div className="px-2 py-1 text-[10px] uppercase tracking-[0.1em] font-bold" style={{ color: TH.ink60 }}>
                    Full
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {drag && (
        <div
          className="fixed pointer-events-none z-[9999] px-3 py-2 rounded-lg text-sm font-bold shadow-2xl"
          style={{
            left: pos.x,
            top: pos.y,
            transform: "translate(-50%, -50%) scale(1.1) rotate(-3deg)",
            background: TH.brass,
            color: TH.forestDeep,
          }}
        >
          {drag.name}
        </div>
      )}
    </>
  );
}

// ============ MAIN APP ============

export default function GolfTripApp() {
  const [players, setPlayers] = useStoredState("golf:players", DEFAULT_PLAYERS);
  const [rounds, setRounds] = useStoredState(
    "golf:rounds",
    Array.from({ length: 5 }, (_, i) => DEFAULT_ROUND(i + 1)),
    (arr) => Array.isArray(arr) ? arr.map(migrateRound) : arr
  );
  const [bets, setBets] = useStoredState("golf:bets", []);
  const [tab, setTab] = useState("leader");
  const [activeRoundId, setActiveRoundId] = useState(null);

  const activeRound = rounds.find(r => r.id === activeRoundId);

  const updateRound = (id, patch) => {
    setRounds(rs => rs.map(r => r.id === id ? { ...r, ...(typeof patch === "function" ? patch(r) : patch) } : r));
  };

  return (
    <div
      className="min-h-screen w-full pb-20"
      style={{
        background: `radial-gradient(ellipse at top, ${TH.forestLight} 0%, ${TH.forest} 45%, ${TH.forestDeep} 100%)`,
        fontFamily: "'Manrope', system-ui, sans-serif",
        color: TH.cream,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;0,9..144,700;0,9..144,800;1,9..144,600&family=Manrope:wght@400;500;600;700;800&display=swap');
        .serif { font-family: 'Fraunces', Georgia, serif; font-variation-settings: "opsz" 144; }
        .num { font-family: 'Fraunces', Georgia, serif; font-variation-settings: "opsz" 144; font-feature-settings: "tnum"; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button {
          -webkit-appearance: none; margin: 0;
        }
        input[type=number] { -moz-appearance: textfield; }
        .scorecard-input:focus { outline: 2px solid ${TH.brass}; outline-offset: -2px; }
      `}</style>

      {activeRound ? (
        <ScorecardScreen
          round={activeRound}
          players={players}
          onBack={() => setActiveRoundId(null)}
          onUpdate={(patch) => updateRound(activeRound.id, patch)}
        />
      ) : (
        <>
          {tab === "leader" && (
            <LeaderboardScreen players={players} rounds={rounds} onOpenRound={setActiveRoundId} />
          )}
          {tab === "rounds" && (
            <RoundsScreen rounds={rounds} players={players} onOpen={setActiveRoundId} />
          )}
          {tab === "bets" && (
            <BetsScreen bets={bets} setBets={setBets} players={players} rounds={rounds} />
          )}
          {tab === "setup" && (
            <SetupScreen players={players} setPlayers={setPlayers} rounds={rounds} setRounds={setRounds} />
          )}
        </>
      )}

      {!activeRound && <TabBar tab={tab} setTab={setTab} />}
    </div>
  );
}

// ============ TAB BAR ============

function TabBar({ tab, setTab }) {
  const tabs = [
    { id: "leader", label: "Leader", icon: Trophy },
    { id: "rounds", label: "Rounds", icon: Flag },
    { id: "bets", label: "Bets", icon: DollarSign },
    { id: "setup", label: "Setup", icon: Settings },
  ];
  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40"
      style={{
        background: TH.forestDeep,
        borderTop: `1px solid ${TH.brass}33`,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      <div className="flex">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 flex flex-col items-center gap-1 py-3 transition-colors"
              style={{ color: active ? TH.brass : `${TH.cream}80` }}
            >
              <Icon size={20} strokeWidth={active ? 2.25 : 1.75} />
              <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============ LEADERBOARD ============

function LeaderboardScreen({ players, rounds, onOpenRound }) {
  const totals = players.map(p => {
    let sfTotal = 0, netTotal = 0, grossTotal = 0, holesTotal = 0;
    let nassauPts = 0, skinsTotal = 0, expectedTotal = 0;

    rounds.forEach(r => {
      const s = computeRoundStats(r, p);
      sfTotal += s.sfTotal;
      netTotal += s.netTotal;
      grossTotal += s.grossTotal;
      holesTotal += s.holesPlayed;
      for (let h = 0; h < 18; h++) {
        if (s.gross[h] != null) expectedTotal += r.par[h];
      }
      if (r.games?.nassau?.enabled) {
        const n = computeNassau(r, players);
        ["front", "back", "total"].forEach(seg => {
          if (n[seg] && n[seg].winners.includes(p.id)) nassauPts += 1 / n[seg].winners.length;
        });
      }
      if (r.games?.skins?.enabled) {
        const sk = computeSkins(r, players);
        skinsTotal += sk.skinsWon[p.id] || 0;
      }
    });

    const vsExpected = holesTotal > 0 ? netTotal - expectedTotal : null;
    return { player: p, sfTotal, netTotal, grossTotal, holesTotal, nassauPts, skinsTotal, vsExpected };
  });

  totals.sort((a, b) => b.sfTotal - a.sfTotal);

  const activeRound = rounds.find(r =>
    Object.values(r.scores || {}).some(arr => arr?.some(v => v != null && v !== ""))
    && !players.every(p => computeRoundStats(r, p).complete)
  );

  return (
    <div className="px-5 pt-12">
      <header className="mb-7">
        <div className="flex items-center gap-2 mb-1" style={{ color: TH.brass }}>
          <div className="w-8 h-px" style={{ background: TH.brass }} />
          <span className="text-[10px] uppercase tracking-[0.25em] font-semibold">The Family Cup</span>
        </div>
        <h1 className="serif text-[42px] leading-[1] font-bold" style={{ color: TH.cream }}>
          Leaderboard
        </h1>
        <p className="text-sm mt-2" style={{ color: `${TH.cream}99` }}>
          {rounds.filter(r => Object.keys(r.scores || {}).length > 0).length} of {rounds.length} rounds in play
        </p>
      </header>

      {activeRound && (
        <button
          onClick={() => onOpenRound(activeRound.id)}
          className="w-full mb-5 text-left rounded-2xl p-4 flex items-center gap-3 transition-transform active:scale-[0.98]"
          style={{ background: `linear-gradient(135deg, ${TH.brass} 0%, ${TH.brassDark} 100%)`, color: TH.forestDeep }}
        >
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: TH.forestDeep, color: TH.brass }}>
            <Flag size={18} />
          </div>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold opacity-80">Live now</div>
            <div className="font-bold text-base">{activeRound.name} {activeRound.course && `· ${activeRound.course}`}</div>
          </div>
          <ChevronRight size={20} />
        </button>
      )}

      <div className="rounded-2xl overflow-hidden" style={{ background: TH.cream, color: TH.ink }}>
        <div className="px-4 py-3 flex items-center gap-2 text-[10px] uppercase tracking-[0.15em] font-bold" style={{ background: TH.creamDark, color: TH.ink60 }}>
          <span className="w-6 text-center">#</span>
          <span className="flex-1">Player</span>
          <span className="w-12 text-right">Pts</span>
          <span className="w-14 text-right">vs Exp</span>
        </div>
        {totals.map((t, i) => (
          <div key={t.player.id} className="px-4 py-3 flex items-center gap-2 border-t" style={{ borderColor: `${TH.ink}15` }}>
            <span className="w-6 text-center num font-bold" style={{ color: i === 0 ? TH.brassDark : TH.ink60 }}>
              {i + 1}
            </span>
            <span className="flex-1 font-semibold truncate">
              {t.player.name}
              <span className="ml-2 text-xs font-normal" style={{ color: TH.ink60 }}>({t.player.handicap})</span>
            </span>
            <span className="w-12 text-right num font-bold text-lg">{t.sfTotal}</span>
            <span
              className="w-14 text-right num text-sm font-semibold flex items-center justify-end gap-0.5"
              style={{
                color: t.vsExpected == null ? TH.ink60 : t.vsExpected < 0 ? TH.green : t.vsExpected > 0 ? TH.red : TH.ink60
              }}
            >
              {t.vsExpected == null ? "—" : (
                <>
                  {t.vsExpected < 0 ? <TrendingDown size={12} /> : t.vsExpected > 0 ? <TrendingUp size={12} /> : null}
                  {t.vsExpected > 0 ? "+" : ""}{t.vsExpected}
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-3 gap-2">
        <StatCard label="Skins" values={totals.map(t => ({ name: t.player.name, val: t.skinsTotal }))} />
        <StatCard label="Nassau" values={totals.map(t => ({ name: t.player.name, val: t.nassauPts }))} />
        <StatCard label="Net Total" values={totals.map(t => ({ name: t.player.name, val: t.netTotal }))} lowIsBetter />
      </div>

      <div className="mt-8 text-[11px] uppercase tracking-[0.2em] font-semibold" style={{ color: `${TH.cream}60` }}>
        Points = Stableford across all rounds · vs Exp = net score minus par for holes played
      </div>
    </div>
  );
}

function StatCard({ label, values, lowIsBetter }) {
  const played = values.filter(v => v.val != null && v.val !== 0);
  const sorted = [...played].sort((a, b) => lowIsBetter ? a.val - b.val : b.val - a.val);
  const leader = sorted[0];
  return (
    <div className="rounded-xl p-3" style={{ background: `${TH.cream}10`, border: `1px solid ${TH.cream}20` }}>
      <div className="text-[9px] uppercase tracking-[0.2em] font-bold mb-1.5" style={{ color: TH.brass }}>
        {label}
      </div>
      {leader ? (
        <>
          <div className="text-sm font-bold truncate">{leader.name}</div>
          <div className="num text-2xl font-bold" style={{ color: TH.brass }}>{leader.val}</div>
        </>
      ) : <div className="text-sm" style={{ color: `${TH.cream}60` }}>—</div>}
    </div>
  );
}

// ============ ROUNDS LIST ============

function RoundsScreen({ rounds, players, onOpen }) {
  return (
    <div className="px-5 pt-12">
      <header className="mb-7">
        <div className="flex items-center gap-2 mb-1" style={{ color: TH.brass }}>
          <div className="w-8 h-px" style={{ background: TH.brass }} />
          <span className="text-[10px] uppercase tracking-[0.25em] font-semibold">Schedule</span>
        </div>
        <h1 className="serif text-[42px] leading-[1] font-bold">Rounds</h1>
      </header>

      <div className="space-y-3">
        {rounds.map((r, idx) => {
          const playedHoles = players.reduce((sum, p) => sum + computeRoundStats(r, p).holesPlayed, 0);
          const maxHoles = players.length * 18;
          const pct = maxHoles > 0 ? (playedHoles / maxHoles) * 100 : 0;
          const activeGames = Object.entries(r.games || {}).filter(([_, g]) => g?.enabled).map(([k]) => k);
          return (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="w-full text-left rounded-2xl p-4 flex items-center gap-4 transition-transform active:scale-[0.98]"
              style={{
                background: pct > 0 ? TH.cream : `${TH.cream}12`,
                color: pct > 0 ? TH.ink : TH.cream,
                border: `1px solid ${pct > 0 ? "transparent" : `${TH.cream}20`}`,
              }}
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center serif text-xl font-bold"
                style={{
                  background: pct > 0 ? TH.forest : `${TH.brass}20`,
                  color: pct > 0 ? TH.cream : TH.brass,
                }}
              >
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base truncate">{r.name}</div>
                <div className="text-xs flex items-center gap-2 mt-0.5 opacity-70">
                  {r.course && <><MapPin size={11} />{r.course}</>}
                  {r.date && <><Calendar size={11} />{r.date}</>}
                  {!r.course && !r.date && <span>Par {r.par.reduce((a, b) => a + b, 0)}</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {(r.carts?.length > 0) && (
                    <span className="text-[9px] uppercase tracking-[0.12em] font-bold px-1.5 py-0.5 rounded" style={{ background: `${TH.forest}${pct > 0 ? "22" : "44"}`, color: pct > 0 ? TH.forest : TH.brass }}>
                      {r.carts.length} carts
                    </span>
                  )}
                  {activeGames.slice(0, 3).map(g => (
                    <span key={g} className="text-[9px] uppercase tracking-[0.12em] font-bold px-1.5 py-0.5 rounded" style={{ background: pct > 0 ? `${TH.brass}33` : `${TH.brass}22`, color: pct > 0 ? TH.brassDark : TH.brass }}>
                      {gameLabel(g)}
                    </span>
                  ))}
                </div>
                <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: pct > 0 ? `${TH.ink}15` : `${TH.cream}15` }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct === 100 ? TH.green : TH.brass }} />
                </div>
              </div>
              <ChevronRight size={20} style={{ opacity: 0.5 }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function gameLabel(key) {
  return {
    stableford: "Stbl",
    skins: "Skins",
    nassau: "Nassau",
    netStroke: "Net",
    bestBall: "Best Ball",
    matchPlay: "Match",
  }[key] || key;
}

// ============ SCORECARD SCREEN ============

function ScorecardScreen({ round, players, onBack, onUpdate }) {
  const [view, setView] = useState("card");
  const [editingHeader, setEditingHeader] = useState(false);
  const [cartFilter, setCartFilter] = useState("all"); // "all" or cart id

  const setScore = (playerId, holeIdx, val) => {
    const scores = { ...(round.scores || {}) };
    const arr = scores[playerId] ? [...scores[playerId]] : Array(18).fill(null);
    arr[holeIdx] = val === "" ? null : Number(val);
    scores[playerId] = arr;
    onUpdate({ scores });
  };

  const setPar = (idx, val) => {
    const par = [...round.par];
    par[idx] = Number(val) || 4;
    onUpdate({ par });
  };
  const setHoleHcp = (idx, val) => {
    const holeHcp = [...round.holeHcp];
    holeHcp[idx] = Number(val) || idx + 1;
    onUpdate({ holeHcp });
  };

  // Filter players by cart
  const displayedPlayers = (() => {
    if (cartFilter === "all" || !round.carts || round.carts.length === 0) return players;
    const cart = round.carts.find(c => c.id === cartFilter);
    if (!cart) return players;
    return players.filter(p => cart.playerIds.includes(p.id));
  })();

  return (
    <div className="min-h-screen pb-6" style={{ background: TH.forestDeep }}>
      <header
        className="sticky top-0 z-30 px-4 pt-12 pb-4"
        style={{ background: `linear-gradient(180deg, ${TH.forestDeep} 0%, ${TH.forestDeep}ee 80%, ${TH.forestDeep}00 100%)` }}
      >
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: `${TH.cream}15`, color: TH.cream }}
          >
            <ArrowLeft size={18} />
          </button>
          {editingHeader ? (
            <div className="flex-1 flex gap-2">
              <input
                value={round.name}
                onChange={e => onUpdate({ name: e.target.value })}
                className="flex-1 px-3 py-1.5 rounded-lg text-sm font-semibold"
                style={{ background: TH.cream, color: TH.ink }}
              />
              <button
                onClick={() => setEditingHeader(false)}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: TH.brass, color: TH.forestDeep }}
              >
                <Check size={16} />
              </button>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <h1 className="serif text-xl font-bold leading-tight truncate">{round.name}</h1>
                <div className="text-[11px] uppercase tracking-[0.15em] font-semibold" style={{ color: TH.brass }}>
                  {round.course || "Tap to name course"} · Par {round.par.reduce((a, b) => a + b, 0)}
                </div>
              </div>
              <button
                onClick={() => setEditingHeader(true)}
                className="w-9 h-9 rounded-full flex items-center justify-center"
                style={{ background: `${TH.cream}15`, color: TH.cream }}
              >
                <Edit3 size={15} />
              </button>
            </>
          )}
        </div>

        {editingHeader && (
          <div className="flex gap-2 mb-3">
            <input
              value={round.course}
              onChange={e => onUpdate({ course: e.target.value })}
              placeholder="Course name"
              className="flex-1 px-3 py-1.5 rounded-lg text-sm"
              style={{ background: TH.cream, color: TH.ink }}
            />
            <input
              value={round.date}
              onChange={e => onUpdate({ date: e.target.value })}
              placeholder="Date"
              className="w-28 px-3 py-1.5 rounded-lg text-sm"
              style={{ background: TH.cream, color: TH.ink }}
            />
          </div>
        )}

        <div className="flex gap-1 p-1 rounded-xl" style={{ background: `${TH.cream}10` }}>
          {[
            { id: "card", label: "Scorecard" },
            { id: "results", label: "Results" },
            { id: "setup", label: "Setup" },
          ].map(v => (
            <button
              key={v.id}
              onClick={() => setView(v.id)}
              className="flex-1 py-2 rounded-lg text-[11px] uppercase tracking-[0.12em] font-semibold transition-colors"
              style={{
                background: view === v.id ? TH.brass : "transparent",
                color: view === v.id ? TH.forestDeep : `${TH.cream}b0`,
              }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {view === "card" && round.carts?.length > 0 && (
          <div className="mt-3 flex gap-1.5 overflow-x-auto -mx-4 px-4 pb-1">
            <button
              onClick={() => setCartFilter("all")}
              className="px-3 py-1.5 rounded-full text-[11px] uppercase tracking-[0.1em] font-bold whitespace-nowrap"
              style={{
                background: cartFilter === "all" ? TH.cream : `${TH.cream}12`,
                color: cartFilter === "all" ? TH.forestDeep : TH.cream,
              }}
            >
              All {players.length}
            </button>
            {round.carts.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setCartFilter(c.id)}
                className="px-3 py-1.5 rounded-full text-[11px] uppercase tracking-[0.1em] font-bold whitespace-nowrap flex items-center gap-1"
                style={{
                  background: cartFilter === c.id ? TH.cream : `${TH.cream}12`,
                  color: cartFilter === c.id ? TH.forestDeep : TH.cream,
                }}
              >
                <Car size={11} />
                Cart {i + 1} · {c.playerIds.length}
              </button>
            ))}
          </div>
        )}
      </header>

      {view === "card" && (
        <ScorecardTable round={round} players={displayedPlayers} allPlayers={players} onScore={setScore} />
      )}
      {view === "results" && (
        <RoundResults round={round} players={players} />
      )}
      {view === "setup" && (
        <RoundSetup round={round} players={players} onUpdate={onUpdate} setPar={setPar} setHoleHcp={setHoleHcp} />
      )}
    </div>
  );
}

// ============ SCORECARD TABLE ============

function ScorecardTable({ round, players, allPlayers, onScore }) {
  // Find cart for each player (for label display)
  const cartByPlayer = {};
  (round.carts || []).forEach((c, i) => {
    c.playerIds.forEach(pid => { cartByPlayer[pid] = i + 1; });
  });

  const Block = ({ startHole, endHole, label }) => (
    <div className="rounded-2xl overflow-hidden mb-4" style={{ background: TH.cream, color: TH.ink }}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: 540 }}>
          <thead>
            <tr style={{ background: TH.forest, color: TH.cream }}>
              <th className="sticky left-0 z-10 text-left px-3 py-2 text-[10px] uppercase tracking-[0.1em] font-bold" style={{ background: TH.forest, minWidth: 110 }}>
                {label}
              </th>
              {Array.from({ length: endHole - startHole }, (_, i) => (
                <th key={i} className="px-1 py-2 text-center num font-bold w-9" style={{ fontSize: 13 }}>
                  {startHole + i + 1}
                </th>
              ))}
              <th className="px-2 py-2 text-[10px] uppercase font-bold" style={{ background: TH.forestDeep }}>
                {endHole === 9 ? "Out" : "In"}
              </th>
            </tr>
            <tr style={{ background: TH.creamDark, color: TH.ink60 }}>
              <td className="sticky left-0 px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold" style={{ background: TH.creamDark }}>
                Par
              </td>
              {Array.from({ length: endHole - startHole }, (_, i) => (
                <td key={i} className="px-1 py-1.5 text-center num font-semibold" style={{ fontSize: 12 }}>
                  {round.par[startHole + i]}
                </td>
              ))}
              <td className="px-2 py-1.5 text-center num font-bold" style={{ fontSize: 12 }}>
                {sumRange(round.par, startHole, endHole)}
              </td>
            </tr>
            <tr style={{ background: TH.creamDark, color: TH.ink60 }}>
              <td className="sticky left-0 px-3 py-1.5 text-[10px] uppercase tracking-[0.1em] font-bold" style={{ background: TH.creamDark }}>
                Hcp
              </td>
              {Array.from({ length: endHole - startHole }, (_, i) => (
                <td key={i} className="px-1 py-1.5 text-center num" style={{ fontSize: 11 }}>
                  {round.holeHcp[startHole + i]}
                </td>
              ))}
              <td className="px-2 py-1.5"></td>
            </tr>
          </thead>
          <tbody>
            {players.map(p => {
              const stats = computeRoundStats(round, p);
              const segSum = endHole === 9 ? stats.grossOut : stats.grossIn;
              const cartNum = cartByPlayer[p.id];
              return (
                <tr key={p.id} className="border-t" style={{ borderColor: `${TH.ink}15` }}>
                  <td className="sticky left-0 px-3 py-2" style={{ background: TH.cream, minWidth: 110 }}>
                    <div className="font-semibold text-[13px] truncate flex items-center gap-1">
                      {cartNum != null && (
                        <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: TH.forest, color: TH.cream }}>
                          {cartNum}
                        </span>
                      )}
                      {p.name}
                    </div>
                    <div className="text-[10px]" style={{ color: TH.ink60 }}>H {p.handicap}</div>
                  </td>
                  {Array.from({ length: endHole - startHole }, (_, i) => {
                    const h = startHole + i;
                    const val = round.scores?.[p.id]?.[h];
                    const gross = val != null && val !== "" ? Number(val) : null;
                    const par = round.par[h];
                    const net = gross != null ? gross - strokesOnHole(p.handicap, round.holeHcp[h]) : null;
                    const strokesGiven = strokesOnHole(p.handicap, round.holeHcp[h]);

                    let bg = "transparent", color = TH.ink;
                    if (gross != null) {
                      const diff = net - par;
                      if (diff <= -2) { bg = "#2a6b4f"; color = "#fff"; }
                      else if (diff === -1) { bg = "#e76a3c"; color = "#fff"; }
                      else if (diff === 0) { bg = "transparent"; }
                      else if (diff === 1) { bg = `${TH.ink}10`; }
                      else if (diff >= 2) { bg = `${TH.red}22`; color = TH.red; }
                    }

                    return (
                      <td key={h} className="relative p-0" style={{ background: bg }}>
                        <input
                          type="tel"
                          inputMode="numeric"
                          value={val ?? ""}
                          onChange={e => {
                            const v = e.target.value.replace(/\D/g, "").slice(0, 2);
                            onScore(p.id, h, v);
                          }}
                          className="scorecard-input w-full text-center num font-bold bg-transparent border-0 py-2"
                          style={{ color, fontSize: 16, height: 44 }}
                          maxLength={2}
                        />
                        {strokesGiven > 0 && (
                          <span
                            className="absolute top-0.5 right-0.5 text-[8px] font-bold pointer-events-none"
                            style={{ color: gross != null && (net - par) <= -1 ? "#fff" : TH.brassDark }}
                          >
                            {strokesGiven === 1 ? "•" : "••"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className="px-2 py-2 text-center num font-bold"
                    style={{ background: TH.forestDeep, color: TH.cream, fontSize: 14 }}
                  >
                    {segSum ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="px-3">
      <Block startHole={0} endHole={9} label="Front 9" />
      <Block startHole={9} endHole={18} label="Back 9" />

      <div className="rounded-2xl overflow-hidden" style={{ background: TH.cream, color: TH.ink }}>
        <div className="px-4 py-2.5 text-[10px] uppercase tracking-[0.15em] font-bold" style={{ background: TH.brass, color: TH.forestDeep }}>
          Totals
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: TH.creamDark, color: TH.ink60 }}>
              <th className="text-left px-3 py-2 text-[10px] uppercase tracking-[0.1em] font-bold">Player</th>
              <th className="px-2 py-2 text-center text-[10px] uppercase font-bold">Gross</th>
              <th className="px-2 py-2 text-center text-[10px] uppercase font-bold">Net</th>
              <th className="px-2 py-2 text-center text-[10px] uppercase font-bold">Pts</th>
              <th className="px-2 py-2 text-center text-[10px] uppercase font-bold">Thru</th>
            </tr>
          </thead>
          <tbody>
            {players.map(p => {
              const s = computeRoundStats(round, p);
              return (
                <tr key={p.id} className="border-t" style={{ borderColor: `${TH.ink}15` }}>
                  <td className="px-3 py-2 font-semibold truncate">{p.name}</td>
                  <td className="px-2 py-2 text-center num font-bold">{s.holesPlayed > 0 ? s.grossTotal : "—"}</td>
                  <td className="px-2 py-2 text-center num font-bold">{s.holesPlayed > 0 ? s.netTotal : "—"}</td>
                  <td className="px-2 py-2 text-center num font-bold" style={{ color: TH.brassDark }}>{s.sfTotal}</td>
                  <td className="px-2 py-2 text-center text-xs" style={{ color: TH.ink60 }}>{s.holesPlayed}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 px-2 text-[11px]" style={{ color: `${TH.cream}70` }}>
        Dot = 1 stroke given · Orange = net birdie · Green = net eagle · Red box = double+
      </div>
    </div>
  );
}

// ============ ROUND SETUP (Groups + Games + Course) ============

function RoundSetup({ round, players, onUpdate, setPar, setHoleHcp }) {
  // Carts management
  const movePlayerToCart = (playerId, fromColId, toColId) => {
    let carts = (round.carts || []).map(c => ({ ...c, playerIds: c.playerIds.filter(id => id !== playerId) }));
    if (toColId !== "__pool") {
      carts = carts.map(c => c.id === toColId ? { ...c, playerIds: [...c.playerIds, playerId] } : c);
    }
    onUpdate({ carts });
  };

  const addCart = () => {
    const newCart = { id: `cart_${Date.now()}`, playerIds: [] };
    onUpdate({ carts: [...(round.carts || []), newCart] });
  };

  const removeCart = (cartId) => {
    onUpdate({ carts: (round.carts || []).filter(c => c.id !== cartId) });
  };

  const autoSplitCarts = () => {
    // Split players evenly into foursomes (cart = foursome / cart of 2, 4-player group)
    const groupSize = 4;
    const numGroups = Math.ceil(players.length / groupSize);
    const carts = [];
    for (let i = 0; i < numGroups; i++) {
      carts.push({
        id: `cart_${Date.now()}_${i}`,
        playerIds: players.slice(i * groupSize, (i + 1) * groupSize).map(p => p.id),
      });
    }
    onUpdate({ carts });
  };

  const assignedToCart = new Set((round.carts || []).flatMap(c => c.playerIds));
  const unassigned = players.filter(p => !assignedToCart.has(p.id));

  const cartColumns = [
    {
      id: "__pool",
      title: "Unassigned",
      subtitle: unassigned.length > 0 ? `${unassigned.length} players waiting` : null,
      playerIds: unassigned.map(p => p.id),
      isPool: true,
    },
    ...(round.carts || []).map((c, i) => ({
      id: c.id,
      title: `Cart ${i + 1}`,
      playerIds: c.playerIds,
      accent: TH.forest,
    })),
  ];

  // Game setup helpers
  const toggleGame = (gameKey) => {
    const current = round.games?.[gameKey] || {};
    onUpdate({ games: { ...round.games, [gameKey]: { ...current, enabled: !current.enabled } } });
  };

  // Best Ball teams
  const bbTeams = round.games?.bestBall?.teams || [];
  const bbAssigned = new Set(bbTeams.flatMap(t => t.playerIds));
  const bbUnassigned = players.filter(p => !bbAssigned.has(p.id));

  const movePlayerInBestBall = (playerId, fromColId, toColId) => {
    let teams = bbTeams.map(t => ({ ...t, playerIds: t.playerIds.filter(id => id !== playerId) }));
    if (toColId !== "__pool") {
      teams = teams.map(t => {
        if (t.id === toColId) {
          if (t.playerIds.length >= 2) return t;
          return { ...t, playerIds: [...t.playerIds, playerId] };
        }
        return t;
      });
    }
    onUpdate({
      games: { ...round.games, bestBall: { ...round.games.bestBall, teams } },
    });
  };

  const addBestBallTeam = () => {
    onUpdate({
      games: {
        ...round.games,
        bestBall: {
          ...round.games.bestBall,
          teams: [...bbTeams, { id: `team_${Date.now()}`, playerIds: [] }],
        },
      },
    });
  };

  const removeBestBallTeam = (tid) => {
    onUpdate({
      games: {
        ...round.games,
        bestBall: { ...round.games.bestBall, teams: bbTeams.filter(t => t.id !== tid) },
      },
    });
  };

  const copyCartsToBestBall = () => {
    const teams = (round.carts || []).map((c, i) => ({
      id: `team_${Date.now()}_${i}`,
      playerIds: c.playerIds.slice(0, 2),
    }));
    onUpdate({
      games: { ...round.games, bestBall: { ...round.games.bestBall, teams } },
    });
  };

  const bbColumns = [
    {
      id: "__pool",
      title: "Unassigned",
      subtitle: bbUnassigned.length > 0 ? `${bbUnassigned.length} players` : null,
      playerIds: bbUnassigned.map(p => p.id),
      isPool: true,
    },
    ...bbTeams.map((t, i) => ({
      id: t.id,
      title: `Team ${String.fromCharCode(65 + i)}`,
      playerIds: t.playerIds,
      capacity: 2,
      accent: i % 2 === 0 ? "#2a5d8f" : "#8f4a2a",
    })),
  ];

  // Match play
  const matches = round.games?.matchPlay?.matches || [];
  const updateMatches = (m) => {
    onUpdate({ games: { ...round.games, matchPlay: { ...round.games.matchPlay, matches: m } } });
  };
  const addMatch = () => {
    updateMatches([...matches, { id: `m_${Date.now()}`, playerA: "", playerB: "" }]);
  };
  const setMatchPlayer = (mid, side, val) => {
    updateMatches(matches.map(m => m.id === mid ? { ...m, [side]: val } : m));
  };
  const removeMatch = (mid) => updateMatches(matches.filter(m => m.id !== mid));

  return (
    <div className="px-4 space-y-5">
      {/* CARTS SECTION */}
      <section className="rounded-2xl p-4" style={{ background: TH.cream, color: TH.ink }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Car size={15} style={{ color: TH.brassDark }} />
            <div className="text-[11px] uppercase tracking-[0.15em] font-bold" style={{ color: TH.ink60 }}>
              Carts / Groupings
            </div>
          </div>
          <div className="flex gap-1.5">
            {(round.carts || []).length === 0 && (
              <button
                onClick={autoSplitCarts}
                className="px-2.5 py-1 rounded-md text-[10px] uppercase tracking-[0.1em] font-bold"
                style={{ background: TH.forest, color: TH.cream }}
              >
                Auto foursomes
              </button>
            )}
            <button
              onClick={addCart}
              className="px-2.5 py-1 rounded-md text-[10px] uppercase tracking-[0.1em] font-bold flex items-center gap-1"
              style={{ background: TH.brass, color: TH.forestDeep }}
            >
              <Plus size={11} strokeWidth={3} /> Cart
            </button>
          </div>
        </div>

        <DragBoard
          columns={cartColumns}
          players={players}
          onMove={movePlayerToCart}
          columnActions={(col) =>
            !col.isPool && (
              <button
                onClick={() => removeCart(col.id)}
                className="w-6 h-6 rounded-full flex items-center justify-center"
                style={{ color: TH.ink60 }}
              >
                <X size={13} />
              </button>
            )
          }
        />

        <div className="mt-3 text-[11px]" style={{ color: TH.ink60 }}>
          Long-press a name and drag to move between carts. Cart numbers show up on the scorecard.
        </div>
      </section>

      {/* GAMES SECTION */}
      <section className="rounded-2xl p-4" style={{ background: TH.cream, color: TH.ink }}>
        <div className="flex items-center gap-2 mb-3">
          <Target size={15} style={{ color: TH.brassDark }} />
          <div className="text-[11px] uppercase tracking-[0.15em] font-bold" style={{ color: TH.ink60 }}>
            Games this round
          </div>
        </div>

        {/* Individual games */}
        {[
          { k: "stableford", label: "Stableford Points", desc: "Net points per hole" },
          { k: "netStroke", label: "Net Stroke Play", desc: "Lowest total net score wins" },
          { k: "nassau", label: "Nassau", desc: "Low net on front, back, total" },
          { k: "skins", label: "Skins", desc: "Lowest net per hole, ties carry over" },
        ].map(g => (
          <label key={g.k} className="flex items-center justify-between py-2.5 border-t" style={{ borderColor: `${TH.ink}12` }}>
            <div>
              <div className="text-sm font-semibold">{g.label}</div>
              <div className="text-[11px]" style={{ color: TH.ink60 }}>{g.desc}</div>
            </div>
            <Toggle on={!!round.games?.[g.k]?.enabled} onChange={() => toggleGame(g.k)} />
          </label>
        ))}

        {/* Best Ball with team setup */}
        <div className="border-t pt-3 mt-1" style={{ borderColor: `${TH.ink}12` }}>
          <label className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers size={14} style={{ color: TH.ink60 }} />
              <div>
                <div className="text-sm font-semibold">Best Ball (2-person teams)</div>
                <div className="text-[11px]" style={{ color: TH.ink60 }}>Lowest net per hole from each team</div>
              </div>
            </div>
            <Toggle on={!!round.games?.bestBall?.enabled} onChange={() => toggleGame("bestBall")} />
          </label>

          {round.games?.bestBall?.enabled && (
            <div className="mt-3 pl-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.1em] font-bold" style={{ color: TH.ink60 }}>
                  Teams
                </div>
                <div className="flex gap-1.5">
                  {bbTeams.length === 0 && (round.carts || []).length > 0 && (
                    <button
                      onClick={copyCartsToBestBall}
                      className="px-2 py-1 rounded-md text-[10px] uppercase tracking-[0.1em] font-bold"
                      style={{ background: TH.forest, color: TH.cream }}
                    >
                      Use carts
                    </button>
                  )}
                  <button
                    onClick={addBestBallTeam}
                    className="px-2 py-1 rounded-md text-[10px] uppercase tracking-[0.1em] font-bold flex items-center gap-1"
                    style={{ background: TH.brass, color: TH.forestDeep }}
                  >
                    <Plus size={10} strokeWidth={3} /> Team
                  </button>
                </div>
              </div>
              <DragBoard
                columns={bbColumns}
                players={players}
                onMove={movePlayerInBestBall}
                columnActions={(col) =>
                  !col.isPool && (
                    <button
                      onClick={() => removeBestBallTeam(col.id)}
                      className="w-6 h-6 rounded-full flex items-center justify-center"
                      style={{ color: TH.ink60 }}
                    >
                      <X size={13} />
                    </button>
                  )
                }
              />
            </div>
          )}
        </div>

        {/* Match Play */}
        <div className="border-t pt-3 mt-1" style={{ borderColor: `${TH.ink}12` }}>
          <label className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Swords size={14} style={{ color: TH.ink60 }} />
              <div>
                <div className="text-sm font-semibold">Match Play (head-to-head)</div>
                <div className="text-[11px]" style={{ color: TH.ink60 }}>Win holes, not strokes</div>
              </div>
            </div>
            <Toggle on={!!round.games?.matchPlay?.enabled} onChange={() => toggleGame("matchPlay")} />
          </label>

          {round.games?.matchPlay?.enabled && (
            <div className="mt-3 pl-6">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] uppercase tracking-[0.1em] font-bold" style={{ color: TH.ink60 }}>
                  Pairings
                </div>
                <button
                  onClick={addMatch}
                  className="px-2 py-1 rounded-md text-[10px] uppercase tracking-[0.1em] font-bold flex items-center gap-1"
                  style={{ background: TH.brass, color: TH.forestDeep }}
                >
                  <Plus size={10} strokeWidth={3} /> Match
                </button>
              </div>
              {matches.length === 0 && (
                <div className="text-[11px] italic py-2" style={{ color: TH.ink60 }}>
                  No matches set. Tap + to add a pair.
                </div>
              )}
              <div className="space-y-2">
                {matches.map(m => (
                  <div key={m.id} className="flex items-center gap-2">
                    <select
                      value={m.playerA}
                      onChange={e => setMatchPlayer(m.id, "playerA", e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded-md text-sm font-semibold"
                      style={{ background: TH.creamDark, color: TH.ink, border: "none" }}
                    >
                      <option value="">Player A</option>
                      {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <span className="text-[10px] uppercase tracking-[0.1em] font-bold" style={{ color: TH.ink60 }}>vs</span>
                    <select
                      value={m.playerB}
                      onChange={e => setMatchPlayer(m.id, "playerB", e.target.value)}
                      className="flex-1 px-2 py-1.5 rounded-md text-sm font-semibold"
                      style={{ background: TH.creamDark, color: TH.ink, border: "none" }}
                    >
                      <option value="">Player B</option>
                      {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <button
                      onClick={() => removeMatch(m.id)}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ color: TH.ink60 }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* COURSE SECTION */}
      <section className="rounded-2xl p-4" style={{ background: TH.cream, color: TH.ink }}>
        <div className="flex items-center gap-2 mb-3">
          <Flag size={15} style={{ color: TH.brassDark }} />
          <div className="text-[11px] uppercase tracking-[0.15em] font-bold" style={{ color: TH.ink60 }}>
            Pars & stroke index
          </div>
        </div>
        <div className="grid grid-cols-9 gap-1.5 mb-1">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="text-[10px] text-center font-bold" style={{ color: TH.ink60 }}>{i + 1}</div>
          ))}
        </div>
        <HoleGrid values={round.par.slice(0, 9)} onChange={(i, v) => setPar(i, v)} />
        <div className="grid grid-cols-9 gap-1.5 mt-2 mb-1">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="text-[10px] text-center font-bold" style={{ color: TH.ink60 }}>{i + 10}</div>
          ))}
        </div>
        <HoleGrid values={round.par.slice(9, 18)} onChange={(i, v) => setPar(i + 9, v)} />

        <div className="text-[11px] uppercase tracking-[0.15em] font-bold mt-5 mb-2" style={{ color: TH.ink60 }}>
          Stroke index (1 = hardest)
        </div>
        <HoleGrid values={round.holeHcp.slice(0, 9)} onChange={(i, v) => setHoleHcp(i, v)} max={18} />
        <div className="h-2" />
        <HoleGrid values={round.holeHcp.slice(9, 18)} onChange={(i, v) => setHoleHcp(i + 9, v)} max={18} />
      </section>
    </div>
  );
}

function HoleGrid({ values, onChange, max = 9 }) {
  return (
    <div className="grid grid-cols-9 gap-1.5">
      {values.map((v, i) => (
        <input
          key={i}
          type="tel"
          inputMode="numeric"
          value={v}
          onChange={e => onChange(i, e.target.value.replace(/\D/g, "").slice(0, max > 9 ? 2 : 1))}
          className="num font-bold text-center rounded-md py-1.5 text-sm"
          style={{ background: TH.creamDark, color: TH.ink, border: "none" }}
        />
      ))}
    </div>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button
      onClick={onChange}
      className="w-11 h-6 rounded-full relative transition-colors flex-shrink-0"
      style={{ background: on ? TH.forest : `${TH.ink}30` }}
    >
      <div
        className="absolute top-0.5 w-5 h-5 rounded-full transition-all"
        style={{ left: on ? 22 : 2, background: on ? TH.brass : TH.cream }}
      />
    </button>
  );
}

// ============ ROUND RESULTS ============

function RoundResults({ round, players }) {
  const stats = players.map(p => ({ player: p, ...computeRoundStats(round, p) }));
  const bySf = [...stats].sort((a, b) => b.sfTotal - a.sfTotal);
  const byNet = [...stats].filter(s => s.complete).sort((a, b) => a.netTotal - b.netTotal);

  const nassau = round.games?.nassau?.enabled ? computeNassau(round, players) : null;
  const skins = round.games?.skins?.enabled ? computeSkins(round, players) : null;
  const bestBall = round.games?.bestBall?.enabled ? computeBestBall(round, round.games.bestBall.teams || [], players) : null;
  const matchPlay = round.games?.matchPlay?.enabled ? computeMatchPlay(round, round.games.matchPlay.matches || [], players) : null;

  const nameById = (id) => players.find(p => p.id === id)?.name || "—";

  return (
    <div className="px-4 space-y-4">
      {round.games?.stableford?.enabled && (
        <ResultCard title="Stableford Points">
          {bySf.map((s, i) => (
            <ResultRow key={s.player.id} rank={i + 1} name={s.player.name} value={s.sfTotal} suffix="pts" highlight={i === 0} />
          ))}
        </ResultCard>
      )}

      {round.games?.netStroke?.enabled && (
        <ResultCard title="Net Stroke Play">
          {byNet.length === 0 ? (
            <div className="px-4 py-4 text-sm" style={{ color: TH.ink60 }}>
              Complete all 18 holes to see final net scores
            </div>
          ) : byNet.map((s, i) => (
            <ResultRow
              key={s.player.id}
              rank={i + 1}
              name={s.player.name}
              value={s.netTotal}
              sub={`Gross ${s.grossTotal}`}
              highlight={i === 0}
            />
          ))}
        </ResultCard>
      )}

      {round.games?.nassau?.enabled && nassau && (
        <ResultCard title="Nassau">
          {[
            { key: "front", label: "Front 9" },
            { key: "back", label: "Back 9" },
            { key: "total", label: "Total 18" },
          ].map(seg => {
            const r = nassau[seg.key];
            return (
              <div key={seg.key} className="px-4 py-3 border-t flex items-center gap-3" style={{ borderColor: `${TH.ink}15` }}>
                <div className="text-[10px] uppercase tracking-[0.15em] font-bold w-16" style={{ color: TH.ink60 }}>
                  {seg.label}
                </div>
                <div className="flex-1 font-semibold text-sm">
                  {r ? r.winners.map(nameById).join(", ") : <span style={{ color: TH.ink60 }}>In progress</span>}
                </div>
                <div className="num font-bold" style={{ color: TH.brassDark }}>
                  {r ? r.score : "—"}
                </div>
              </div>
            );
          })}
        </ResultCard>
      )}

      {round.games?.bestBall?.enabled && bestBall && (
        <ResultCard title="Best Ball">
          {bestBall.length === 0 ? (
            <div className="px-4 py-4 text-sm" style={{ color: TH.ink60 }}>
              Add teams in Setup to see results
            </div>
          ) : (
            [...bestBall]
              .filter(b => b.holesPlayed > 0)
              .sort((a, b) => a.total - b.total)
              .map((b, i) => (
                <ResultRow
                  key={b.team.id}
                  rank={i + 1}
                  name={b.members.map(m => m.name.split(" ")[0]).join(" & ") || `Team ${i + 1}`}
                  value={b.total}
                  sub={`thru ${b.holesPlayed}`}
                  highlight={i === 0}
                />
              ))
          )}
        </ResultCard>
      )}

      {round.games?.matchPlay?.enabled && matchPlay && (
        <ResultCard title="Match Play">
          {matchPlay.length === 0 ? (
            <div className="px-4 py-4 text-sm" style={{ color: TH.ink60 }}>
              Add pairings in Setup to see results
            </div>
          ) : matchPlay.map((m, i) => (
            <div key={m.match.id} className="px-4 py-3 border-t" style={{ borderColor: `${TH.ink}15` }}>
              <div className="flex items-center gap-3">
                <div className="flex-1 font-semibold text-sm truncate">
                  {m.playerA.name} <span style={{ color: TH.ink60 }}>vs</span> {m.playerB.name}
                </div>
                <div
                  className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-[0.1em]"
                  style={{
                    background: m.closed ? TH.green : m.aUp === 0 ? `${TH.ink}15` : TH.brass,
                    color: m.closed || m.aUp !== 0 ? TH.forestDeep : TH.ink60,
                  }}
                >
                  {m.status}
                </div>
              </div>
              {m.holesPlayed > 0 && (
                <div className="mt-2 flex gap-0.5">
                  {m.holes.map((h, idx) => (
                    <div
                      key={idx}
                      className="flex-1 h-2 rounded-sm"
                      style={{
                        background: h === "A" ? "#2a5d8f" : h === "B" ? "#8f4a2a" : h === "H" ? `${TH.ink}30` : `${TH.ink}08`,
                      }}
                      title={`#${idx + 1}: ${h || "not played"}`}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
          {matchPlay.length > 0 && (
            <div className="px-4 py-2 text-[10px] border-t flex items-center gap-3" style={{ borderColor: `${TH.ink}15`, color: TH.ink60 }}>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ background: "#2a5d8f" }}></span>A won</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ background: "#8f4a2a" }}></span>B won</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ background: `${TH.ink}30` }}></span>Halved</span>
            </div>
          )}
        </ResultCard>
      )}

      {round.games?.skins?.enabled && skins && (
        <ResultCard title="Skins">
          {players
            .map(p => ({ p, count: skins.skinsWon[p.id] || 0 }))
            .sort((a, b) => b.count - a.count)
            .map(({ p, count }, i) => (
              <ResultRow key={p.id} rank={i + 1} name={p.name} value={count} suffix={count === 1 ? "skin" : "skins"} highlight={count > 0 && i === 0} muted={count === 0} />
            ))}
          <div className="px-4 py-3 border-t text-[11px]" style={{ borderColor: `${TH.ink}15`, color: TH.ink60 }}>
            <div className="font-bold uppercase tracking-[0.1em] text-[9px] mb-1">By hole</div>
            <div className="flex flex-wrap gap-1">
              {skins.perHole.map((h, i) => (
                <div
                  key={i}
                  className="px-1.5 py-0.5 rounded text-[10px] num font-semibold"
                  style={{ background: h.winner ? TH.forest : `${TH.ink}15`, color: h.winner ? TH.cream : TH.ink60 }}
                  title={h.winner ? nameById(h.winner) : h.tied ? "carry" : ""}
                >
                  {i + 1}{h.winner ? ` ${nameById(h.winner).split(" ")[0]}` : h.tied ? "↻" : ""}
                </div>
              ))}
            </div>
          </div>
        </ResultCard>
      )}

      {!Object.values(round.games || {}).some(g => g?.enabled) && (
        <div className="rounded-2xl p-6 text-center" style={{ background: `${TH.cream}08`, border: `1px dashed ${TH.cream}30` }}>
          <Target size={24} style={{ color: TH.brass, margin: "0 auto" }} />
          <div className="mt-2 text-sm" style={{ color: `${TH.cream}80` }}>
            No games selected. Head to Setup to pick games for this round.
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({ title, children }) {
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: TH.cream, color: TH.ink }}>
      <div className="px-4 py-2.5 text-[10px] uppercase tracking-[0.15em] font-bold" style={{ background: TH.brass, color: TH.forestDeep }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function ResultRow({ rank, name, value, suffix, sub, highlight, muted }) {
  return (
    <div className="px-4 py-2.5 border-t flex items-center gap-3" style={{ borderColor: `${TH.ink}12`, opacity: muted ? 0.5 : 1 }}>
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center num font-bold text-sm"
        style={{ background: highlight ? TH.brass : `${TH.ink}10`, color: highlight ? TH.forestDeep : TH.ink60 }}
      >
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm truncate">{name}</div>
        {sub && <div className="text-[11px]" style={{ color: TH.ink60 }}>{sub}</div>}
      </div>
      <div className="text-right">
        <span className="num font-bold text-lg">{value}</span>
        {suffix && <span className="text-xs ml-1" style={{ color: TH.ink60 }}>{suffix}</span>}
      </div>
    </div>
  );
}

// ============ BETS ============

function BetsScreen({ bets, setBets, players, rounds }) {
  const [drafting, setDrafting] = useState(false);

  const addBet = (bet) => { setBets([{ ...bet, id: Date.now().toString() }, ...bets]); setDrafting(false); };
  const resolveBet = (id, winnerId) => setBets(bets.map(b => b.id === id ? { ...b, winner: winnerId, resolvedAt: Date.now() } : b));
  const deleteBet = (id) => setBets(bets.filter(b => b.id !== id));

  const tallies = {};
  players.forEach(p => tallies[p.id] = 0);
  bets.forEach(b => {
    if (b.winner && b.amount) tallies[b.winner] = (tallies[b.winner] || 0) + Number(b.amount);
  });

  const sortedPlayers = [...players].sort((a, b) => (tallies[b.id] || 0) - (tallies[a.id] || 0));

  return (
    <div className="px-5 pt-12">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1" style={{ color: TH.brass }}>
            <div className="w-8 h-px" style={{ background: TH.brass }} />
            <span className="text-[10px] uppercase tracking-[0.25em] font-semibold">The Book</span>
          </div>
          <h1 className="serif text-[42px] leading-[1] font-bold">Side Bets</h1>
        </div>
        <button
          onClick={() => setDrafting(true)}
          className="w-11 h-11 rounded-full flex items-center justify-center"
          style={{ background: TH.brass, color: TH.forestDeep }}
        >
          <Plus size={22} strokeWidth={2.5} />
        </button>
      </header>

      <div className="rounded-2xl p-4 mb-5" style={{ background: `${TH.cream}10`, border: `1px solid ${TH.cream}20` }}>
        <div className="text-[10px] uppercase tracking-[0.2em] font-bold mb-2.5" style={{ color: TH.brass }}>
          Running Tally
        </div>
        <div className="space-y-1.5">
          {sortedPlayers.map(p => {
            const t = tallies[p.id] || 0;
            return (
              <div key={p.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate">{p.name}</span>
                <span className="num font-bold" style={{ color: t > 0 ? "#79c28d" : t < 0 ? TH.red : `${TH.cream}70` }}>
                  {t > 0 ? "+" : ""}${t}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {drafting && <BetDraft players={players} rounds={rounds} onSave={addBet} onCancel={() => setDrafting(false)} />}

      <div className="space-y-3">
        {bets.length === 0 && !drafting && (
          <div className="rounded-2xl p-6 text-center" style={{ background: `${TH.cream}08`, border: `1px dashed ${TH.cream}30` }}>
            <DollarSign size={24} style={{ color: TH.brass, margin: "0 auto" }} />
            <div className="mt-2 text-sm" style={{ color: `${TH.cream}80` }}>
              No side action logged yet. Tap + to open the book.
            </div>
          </div>
        )}
        {bets.map(b => (
          <BetCard key={b.id} bet={b} players={players} rounds={rounds} onResolve={(w) => resolveBet(b.id, w)} onDelete={() => deleteBet(b.id)} />
        ))}
      </div>
    </div>
  );
}

function BetDraft({ players, rounds, onSave, onCancel }) {
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [involved, setInvolved] = useState([]);
  const [roundId, setRoundId] = useState("");
  const [notes, setNotes] = useState("");

  const toggle = (id) => setInvolved(involved.includes(id) ? involved.filter(i => i !== id) : [...involved, id]);
  const save = () => {
    if (!description.trim()) return;
    onSave({
      description: description.trim(),
      amount: Number(amount) || 0,
      players: involved,
      roundId: roundId || null,
      notes: notes.trim(),
      winner: null,
      createdAt: Date.now(),
    });
  };

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: TH.cream, color: TH.ink }}>
      <div className="text-[11px] uppercase tracking-[0.15em] font-bold mb-3" style={{ color: TH.ink60 }}>New Bet</div>
      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="e.g. Closest to pin #7"
        className="w-full px-3 py-2.5 rounded-lg text-sm font-semibold mb-2"
        style={{ background: TH.creamDark, color: TH.ink, border: "none" }}
      />
      <div className="flex gap-2 mb-2">
        <div className="flex items-center gap-1 px-3 py-2 rounded-lg flex-1" style={{ background: TH.creamDark }}>
          <DollarSign size={14} style={{ color: TH.ink60 }} />
          <input
            type="tel"
            inputMode="numeric"
            value={amount}
            onChange={e => setAmount(e.target.value.replace(/\D/g, ""))}
            placeholder="Amount"
            className="flex-1 bg-transparent text-sm font-semibold num border-none outline-none"
          />
        </div>
        <select
          value={roundId}
          onChange={e => setRoundId(e.target.value)}
          className="px-3 py-2 rounded-lg text-sm font-semibold"
          style={{ background: TH.creamDark, color: TH.ink, border: "none" }}
        >
          <option value="">Any round</option>
          {rounds.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </div>

      <div className="text-[10px] uppercase tracking-[0.1em] font-bold mt-3 mb-2" style={{ color: TH.ink60 }}>Who's in</div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {players.map(p => (
          <button
            key={p.id}
            onClick={() => toggle(p.id)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold transition-colors"
            style={{ background: involved.includes(p.id) ? TH.forest : `${TH.ink}10`, color: involved.includes(p.id) ? TH.cream : TH.ink }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        placeholder="Notes (trash talk, terms, etc.)"
        rows={2}
        className="w-full px-3 py-2 rounded-lg text-sm resize-none"
        style={{ background: TH.creamDark, color: TH.ink, border: "none" }}
      />

      <div className="flex gap-2 mt-3">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-lg text-sm font-bold" style={{ background: `${TH.ink}10`, color: TH.ink }}>
          Cancel
        </button>
        <button onClick={save} className="flex-1 py-2.5 rounded-lg text-sm font-bold" style={{ background: TH.forest, color: TH.cream }}>
          Save Bet
        </button>
      </div>
    </div>
  );
}

function BetCard({ bet, players, rounds, onResolve, onDelete }) {
  const [picking, setPicking] = useState(false);
  const round = rounds.find(r => r.id === bet.roundId);
  const winner = players.find(p => p.id === bet.winner);
  const involved = bet.players?.length > 0
    ? bet.players.map(id => players.find(p => p.id === id)?.name).filter(Boolean)
    : ["everyone"];

  return (
    <div className="rounded-2xl p-4" style={{ background: TH.cream, color: TH.ink }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-bold text-base leading-tight">{bet.description}</div>
          <div className="text-[11px] mt-1 flex items-center gap-2 flex-wrap" style={{ color: TH.ink60 }}>
            {bet.amount > 0 && <span className="num font-bold" style={{ color: TH.brassDark }}>${bet.amount}</span>}
            {round && <span>· {round.name}</span>}
            <span>· {involved.join(", ")}</span>
          </div>
          {bet.notes && <div className="text-[12px] mt-2 italic" style={{ color: TH.ink60 }}>"{bet.notes}"</div>}
        </div>
        <button onClick={onDelete} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ color: TH.ink60 }}>
          <Trash2 size={14} />
        </button>
      </div>

      {winner ? (
        <div className="mt-3 px-3 py-2 rounded-lg flex items-center justify-between" style={{ background: TH.forest, color: TH.cream }}>
          <div className="flex items-center gap-2">
            <Award size={14} style={{ color: TH.brass }} />
            <span className="text-sm font-bold">{winner.name} wins</span>
          </div>
          <button onClick={() => onResolve(null)} className="text-[11px] uppercase tracking-[0.1em] font-semibold" style={{ color: `${TH.cream}80` }}>Undo</button>
        </div>
      ) : picking ? (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold mb-2" style={{ color: TH.ink60 }}>Who won?</div>
          <div className="flex flex-wrap gap-1.5">
            {(bet.players?.length > 0 ? bet.players.map(id => players.find(p => p.id === id)).filter(Boolean) : players).map(p => (
              <button key={p.id} onClick={() => { onResolve(p.id); setPicking(false); }} className="px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: TH.forest, color: TH.cream }}>
                {p.name}
              </button>
            ))}
            <button onClick={() => setPicking(false)} className="px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: `${TH.ink}10`, color: TH.ink }}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setPicking(true)} className="mt-3 w-full py-2 rounded-lg text-xs font-bold uppercase tracking-[0.1em]" style={{ background: `${TH.forest}15`, color: TH.forest }}>
          Settle Bet
        </button>
      )}
    </div>
  );
}

// ============ SETUP ============

function SetupScreen({ players, setPlayers, rounds, setRounds }) {
  const updatePlayer = (id, patch) => setPlayers(players.map(p => p.id === id ? { ...p, ...patch } : p));

  const addPlayer = () => {
    const next = Math.max(0, ...players.map(p => parseInt((p.id || "").replace(/\D/g, "")) || 0)) + 1;
    setPlayers([...players, { id: `p${next}_${Date.now().toString(36)}`, name: `Player ${players.length + 1}`, handicap: 18 }]);
  };

  const removePlayer = (id) => {
    if (!confirm("Remove this player? Their scores for all rounds will be cleared.")) return;
    setPlayers(players.filter(p => p.id !== id));
    // Also remove from all rounds
    setRounds(rounds.map(r => {
      const scores = { ...r.scores };
      delete scores[id];
      const carts = (r.carts || []).map(c => ({ ...c, playerIds: c.playerIds.filter(x => x !== id) }));
      const games = { ...r.games };
      if (games.bestBall?.teams) {
        games.bestBall = { ...games.bestBall, teams: games.bestBall.teams.map(t => ({ ...t, playerIds: t.playerIds.filter(x => x !== id) })) };
      }
      if (games.matchPlay?.matches) {
        games.matchPlay = { ...games.matchPlay, matches: games.matchPlay.matches.filter(m => m.playerA !== id && m.playerB !== id) };
      }
      return { ...r, scores, carts, games };
    }));
  };

  const renameRound = (id, name) => setRounds(rounds.map(r => r.id === id ? { ...r, name } : r));

  const addRound = () => {
    const next = rounds.length + 1;
    setRounds([...rounds, DEFAULT_ROUND(next)]);
  };

  const removeRound = (id) => {
    if (!confirm("Remove this round? All scores for this round will be lost.")) return;
    setRounds(rounds.filter(r => r.id !== id));
  };

  const resetAll = () => {
    if (!confirm("Clear all players, scores, bets, and rounds? This can't be undone.")) return;
    setPlayers(DEFAULT_PLAYERS);
    setRounds(Array.from({ length: 5 }, (_, i) => DEFAULT_ROUND(i + 1)));
  };

  return (
    <div className="px-5 pt-12 pb-6">
      <header className="mb-7">
        <div className="flex items-center gap-2 mb-1" style={{ color: TH.brass }}>
          <div className="w-8 h-px" style={{ background: TH.brass }} />
          <span className="text-[10px] uppercase tracking-[0.25em] font-semibold">Roster</span>
        </div>
        <h1 className="serif text-[42px] leading-[1] font-bold">Setup</h1>
      </header>

      <section className="rounded-2xl overflow-hidden mb-5" style={{ background: TH.cream, color: TH.ink }}>
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: TH.brass, color: TH.forestDeep }}>
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold">Players & Handicaps ({players.length})</div>
          <button
            onClick={addPlayer}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: TH.forestDeep, color: TH.brass }}
          >
            <UserPlus size={13} />
          </button>
        </div>
        {players.map(p => (
          <div key={p.id} className="px-4 py-3 border-t flex items-center gap-2" style={{ borderColor: `${TH.ink}12` }}>
            <input
              value={p.name}
              onChange={e => updatePlayer(p.id, { name: e.target.value })}
              className="flex-1 bg-transparent font-semibold text-sm border-none outline-none min-w-0"
            />
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.1em] font-bold" style={{ color: TH.ink60 }}>Hcp</span>
              <input
                type="tel"
                inputMode="numeric"
                value={p.handicap}
                onChange={e => updatePlayer(p.id, { handicap: Number(e.target.value.replace(/\D/g, "")) || 0 })}
                className="w-12 text-center num font-bold rounded-md py-1.5 text-sm"
                style={{ background: TH.creamDark, color: TH.ink, border: "none" }}
              />
            </div>
            <button
              onClick={() => removePlayer(p.id)}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ color: TH.ink60 }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </section>

      <section className="rounded-2xl overflow-hidden mb-5" style={{ background: TH.cream, color: TH.ink }}>
        <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: TH.brass, color: TH.forestDeep }}>
          <div className="text-[10px] uppercase tracking-[0.15em] font-bold">Rounds ({rounds.length})</div>
          <button
            onClick={addRound}
            className="w-7 h-7 rounded-full flex items-center justify-center"
            style={{ background: TH.forestDeep, color: TH.brass }}
          >
            <Plus size={14} />
          </button>
        </div>
        {rounds.map(r => (
          <div key={r.id} className="px-4 py-3 border-t flex items-center gap-3" style={{ borderColor: `${TH.ink}12` }}>
            <input
              value={r.name}
              onChange={e => renameRound(r.id, e.target.value)}
              className="flex-1 bg-transparent font-semibold text-sm border-none outline-none"
            />
            <span className="text-[11px]" style={{ color: TH.ink60 }}>{r.course || "no course"}</span>
            <button
              onClick={() => removeRound(r.id)}
              className="w-7 h-7 rounded-full flex items-center justify-center"
              style={{ color: TH.ink60 }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div className="px-4 py-3 border-t text-[11px]" style={{ borderColor: `${TH.ink}12`, color: TH.ink60 }}>
          Tap any round on the Rounds tab to set course, date, carts, games, and pars.
        </div>
      </section>

      <button
        onClick={resetAll}
        className="w-full py-3 rounded-xl text-sm font-bold"
        style={{ background: `${TH.red}22`, color: TH.red }}
      >
        Reset Everything
      </button>

      <div className="mt-6 text-center text-[10px] uppercase tracking-[0.2em] font-semibold" style={{ color: `${TH.cream}50` }}>
        · The Family Cup ·
      </div>
    </div>
  );
}
