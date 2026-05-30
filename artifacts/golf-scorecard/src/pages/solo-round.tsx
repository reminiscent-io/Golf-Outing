import { useMemo } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
  useGetSoloRound,
  useUpdateSoloRound,
  useGetSoloRoundScores,
  useUpsertSoloRoundScore,
  getGetSoloRoundQueryKey,
  getGetSoloRoundScoresQueryKey,
} from "@workspace/api-client-react";
import NotFound from "@/pages/not-found";

const BRASS = "hsl(42 52% 59%)";
const INK = "hsl(38 30% 14%)";

export default function SoloRoundPage() {
  const { roundId: roundIdStr } = useParams<{ roundId: string }>();
  const roundId = Number(roundIdStr);
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const { data: round, isLoading } = useGetSoloRound(roundId, {
    query: { queryKey: getGetSoloRoundQueryKey(roundId), enabled: !!roundId },
  });
  const { data: scoreRows } = useGetSoloRoundScores(roundId, {
    query: { queryKey: getGetSoloRoundScoresQueryKey(roundId), enabled: !!roundId },
  });
  const updateRound = useUpdateSoloRound();
  const upsertScore = useUpsertSoloRoundScore();

  // The caller owns the round (server enforces it); for a solo round the caller's
  // player is the only score row.
  const myScoreRow = scoreRows?.[0] ?? null;
  const myPlayerId = myScoreRow?.playerId ?? null;
  const holeScores = (myScoreRow?.holeScores as (number | null)[] | undefined) ?? Array(18).fill(null);

  const { gross, netVsPar, holesPlayed } = useMemo(() => {
    if (!round) return { gross: null as number | null, netVsPar: null as number | null, holesPlayed: 0 };
    let sum = 0;
    let played = 0;
    for (let h = 0; h < 18; h++) {
      const s = holeScores[h];
      if (s != null) { sum += s; played++; }
    }
    const parTotal = round.par.reduce((a, b) => a + b, 0);
    return { gross: played > 0 ? sum : null, netVsPar: played === 18 ? sum - parTotal : null, holesPlayed: played };
  }, [round, holeScores]);

  function setHole(hole: number, score: number | null) {
    if (myPlayerId == null) return;
    upsertScore.mutate(
      { roundId, data: { playerId: myPlayerId, hole, score } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSoloRoundScoresQueryKey(roundId) }) },
    );
  }

  function toggleComplete() {
    if (!round) return;
    const next = round.completedAt ? null : new Date().toISOString();
    updateRound.mutate(
      { roundId, data: { completedAt: next } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getGetSoloRoundQueryKey(roundId) }) },
    );
  }

  if (!roundId) return <NotFound />;
  if (isLoading) return <div className="min-h-dvh bg-background flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  if (!round) return <NotFound />;

  return (
    <div className="min-h-dvh bg-background">
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate("/my-golf")}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            My Golf
          </button>
          <h1 className="text-2xl font-serif" style={{ color: BRASS }}>{round.course ?? round.name}</h1>
          {round.date && (
            <p className="text-sm font-sans mt-1" style={{ color: "hsl(42 25% 60%)" }}>{round.date}</p>
          )}
          <div className="flex items-center gap-6 mt-4">
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "hsl(42 25% 55%)" }}>Gross</div>
              <div className="text-xl font-serif" style={{ color: BRASS }}>{gross ?? "—"}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "hsl(42 25% 55%)" }}>Net vs par</div>
              <div className="text-xl font-serif" style={{ color: BRASS }}>
                {netVsPar == null ? "—" : `${netVsPar > 0 ? "+" : netVsPar < 0 ? "−" : ""}${Math.abs(netVsPar)}`}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] font-bold" style={{ color: "hsl(42 25% 55%)" }}>Holes</div>
              <div className="text-xl font-serif" style={{ color: BRASS }}>{holesPlayed} / 18</div>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-5 py-4">
        <SoloHoleGrid par={round.par} holeScores={holeScores} onSetHole={setHole} disabled={myPlayerId == null} />
        <button
          type="button"
          onClick={toggleComplete}
          disabled={updateRound.isPending}
          className="mt-6 w-full py-3 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm disabled:opacity-50"
        >
          {round.completedAt ? "Mark in progress" : "Mark round complete"}
        </button>
      </div>
    </div>
  );
}

function SoloHoleGrid({
  par, holeScores, onSetHole, disabled,
}: Readonly<{ par: number[]; holeScores: (number | null)[]; onSetHole: (hole: number, score: number | null) => void; disabled: boolean }>) {
  return (
    <div className="grid grid-cols-9 gap-1.5">
      {Array.from({ length: 18 }, (_, i) => {
        const hole = i + 1;
        const currentValue = holeScores[i];
        const holePar = par[i] ?? 4;
        return (
          <div key={hole} className="flex flex-col items-center">
            <div className="text-[9px] tracking-[0.12em] uppercase font-bold mb-1" style={{ color: "hsl(38 20% 50%)" }}>{hole}</div>
            <input
              type="number"
              min={1}
              max={15}
              value={currentValue ?? ""}
              disabled={disabled}
              onChange={e => {
                const raw = e.target.value;
                onSetHole(hole, raw === "" ? null : Number(raw));
              }}
              className="w-full text-center font-serif text-base rounded-md py-1.5 disabled:opacity-50"
              style={{ background: "hsl(42 45% 91%)", color: INK, border: "1px solid hsl(38 25% 78%)" }}
              placeholder={String(holePar)}
            />
          </div>
        );
      })}
    </div>
  );
}
