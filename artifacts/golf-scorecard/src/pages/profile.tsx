import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useUpdateMe, useGetMyStats, type MyStatsResponse } from "@workspace/api-client-react";
import { ArrowLeft, User as UserIcon, Users, Flag, Trophy } from "lucide-react";
import { RequireSignIn } from "@/components/require-sign-in";
import { useAuthSession, updateSessionUser } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { goBackOr } from "@/lib/back-nav";

const BRASS = "hsl(42 52% 59%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const CREAM = "hsl(42 45% 91%)";
const CREAM_BORDER = "hsl(38 25% 78%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";

function parseHandicapInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const v = parseFloat(trimmed);
  if (isNaN(v)) return null;
  return Math.round(v * 10) / 10;
}

function formatHandicap(h: number | null | undefined): string {
  if (h == null) return "";
  return (Math.round(h * 10) / 10).toFixed(1);
}

function ProfileContent() {
  const [, navigate] = useLocation();
  const session = useAuthSession();
  const { toast } = useToast();
  const updateMe = useUpdateMe();

  const [hcp, setHcp] = useState<string>(() => formatHandicap(session?.user.handicap));

  useEffect(() => {
    setHcp(formatHandicap(session?.user.handicap));
  }, [session?.user.handicap]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    const next = parseHandicapInput(hcp);
    if (next != null && (next < 0 || next > 54)) {
      toast({ description: "Handicap must be between 0 and 54", variant: "destructive" });
      return;
    }
    updateMe.mutate(
      { data: { handicap: next } },
      {
        onSuccess: (user) => {
          updateSessionUser({ handicap: user.handicap });
          toast({ description: "Handicap saved", duration: 2000 });
        },
        onError: () => {
          toast({ description: "Could not save handicap", variant: "destructive" });
        },
      }
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-dvh" style={{ background: "hsl(158 60% 11%)" }}>
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => goBackOr("/", navigate)}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <h1 className="text-3xl font-serif" style={{ color: "hsl(42 52% 59%)" }}>
            Profile
          </h1>
          <p className="text-sm font-sans mt-1" style={{ color: "hsl(42 25% 60%)" }}>
            Your handicap will autofill when you join new trips.
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6 space-y-4">
        <div
          className="rounded-xl p-6"
          style={{ background: CREAM, border: `1px solid ${CREAM_BORDER}` }}
        >
          {/* Identity block */}
          <div className="flex items-center gap-3 mb-5 pb-5" style={{ borderBottom: `1px dashed ${CREAM_BORDER}` }}>
            <div
              className="inline-flex items-center justify-center rounded-full"
              style={{
                width: 44,
                height: 44,
                background: FOREST_ACCENT,
                border: "1px solid hsla(42, 52%, 59%, 0.35)",
                color: BRASS,
              }}
            >
              <UserIcon size={20} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="font-serif text-base font-semibold" style={{ color: INK }}>
                {session.user.fullName}
              </div>
              <div className="font-sans text-xs tabular-nums" style={{ color: INK_SOFT }}>
                {session.user.phone}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <label
              htmlFor="profile-handicap"
              className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2"
              style={{ color: INK_SOFT }}
            >
              Handicap index
            </label>
            <input
              id="profile-handicap"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={54}
              placeholder="e.g. 12.4"
              value={hcp}
              onChange={e => setHcp(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-2"
              style={{ background: "white", color: INK, border: "1.5px solid hsl(38 25% 72%)" }}
            />
            <p className="text-xs font-sans mb-5" style={{ color: "hsl(38 20% 45%)" }}>
              Decimals OK. Leave empty to clear.
            </p>

            <button
              type="submit"
              disabled={updateMe.isPending}
              className="w-full py-2.5 rounded-lg font-sans font-semibold text-sm disabled:opacity-50"
              style={{ background: BRASS, color: "hsl(38 30% 12%)" }}
            >
              {updateMe.isPending ? "Saving…" : "Save"}
            </button>
          </form>
        </div>

        <StatsCard />
      </div>
    </div>
  );
}

function StatsCard() {
  const { data, isLoading, isError } = useGetMyStats();

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: CREAM, border: `1px solid ${CREAM_BORDER}` }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Trophy size={16} style={{ color: BRASS }} strokeWidth={2} />
        <h2 className="font-serif text-lg" style={{ color: INK }}>Your Stats</h2>
      </div>
      <p className="font-sans text-xs mb-5" style={{ color: INK_SOFT }}>
        Across every round you've played.
      </p>

      {isLoading && (
        <div className="space-y-3">
          <div className="h-16 rounded-lg animate-pulse" style={{ background: "hsl(38 20% 86%)" }} />
          <div className="h-24 rounded-lg animate-pulse" style={{ background: "hsl(38 20% 86%)" }} />
        </div>
      )}
      {!isLoading && isError && (
        <p className="text-sm font-sans" style={{ color: INK_SOFT }}>
          Couldn't load stats right now.
        </p>
      )}
      {!isLoading && !isError && data && <StatsBody stats={data} />}
    </div>
  );
}

function StatsBody({ stats }: Readonly<{ stats: MyStatsResponse }>) {
  const { tripsCreated, roundsPlayed, holesPlayed, scoring, holeOutcomes, playersPlayedWith } = stats;
  const noHistory = roundsPlayed === 0 && tripsCreated === 0;

  if (noHistory) {
    return (
      <p className="text-sm font-sans" style={{ color: INK_SOFT, lineHeight: 1.55 }}>
        No rounds yet. Join a trip and enter scores to start tracking eagles, birdies, and more.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-2">
        <SummaryTile label="Trips made" value={String(tripsCreated)} />
        <SummaryTile label="Rounds played" value={String(roundsPlayed)} />
        <SummaryTile label="Holes" value={String(holesPlayed)} />
      </div>

      <div>
        <SectionLabel>Scoring</SectionLabel>
        <div className="grid grid-cols-3 gap-2">
          <SummaryTile label="Best 18" value={fmt(scoring.bestGross)} />
          <SummaryTile label="Avg 18" value={fmtAvg(scoring.avgGross)} />
          <SummaryTile label="Worst 18" value={fmt(scoring.worstGross)} />
        </div>
        {scoring.completedRounds === 0 && (
          <p className="text-[11px] font-sans mt-1.5" style={{ color: INK_SOFT }}>
            Finish a full 18-hole round to unlock scoring totals.
          </p>
        )}
      </div>

      <div>
        <SectionLabel>Hole results vs par</SectionLabel>
        <div className="grid grid-cols-4 gap-1.5">
          <OutcomeChip label="Eagle+" count={holeOutcomes.eagles} tone="gold" />
          <OutcomeChip label="Birdie" count={holeOutcomes.birdies} tone="green" />
          <OutcomeChip label="Par" count={holeOutcomes.pars} tone="neutral" />
          <OutcomeChip label="Bogey" count={holeOutcomes.bogeys} tone="warm" />
          <OutcomeChip label="Double" count={holeOutcomes.doubles} tone="warm" />
          <OutcomeChip label="Triple" count={holeOutcomes.triples} tone="hot" />
          <OutcomeChip label="Quad+" count={holeOutcomes.quadPlus} tone="hot" />
          <OutcomeChip label="Total" count={holesPlayed} tone="ink" />
        </div>
      </div>

      <div>
        <SectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Users size={12} strokeWidth={2} />
            Played with
          </span>
        </SectionLabel>
        {playersPlayedWith.length === 0 ? (
          <p className="text-sm font-sans" style={{ color: INK_SOFT }}>
            No co-players yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {playersPlayedWith.slice(0, 12).map(p => (
              <li
                key={p.name}
                className="flex items-center justify-between px-3 py-2 rounded-lg"
                style={{ background: "hsl(42 35% 86%)", border: `1px solid ${CREAM_BORDER}` }}
              >
                <span className="font-sans text-sm truncate mr-2" style={{ color: INK }}>{p.name}</span>
                <span className="font-sans text-xs tabular-nums shrink-0" style={{ color: INK_SOFT }}>
                  {p.rounds} {p.rounds === 1 ? "round" : "rounds"}
                </span>
              </li>
            ))}
            {playersPlayedWith.length > 12 && (
              <li className="text-[11px] font-sans pt-0.5" style={{ color: INK_SOFT }}>
                + {playersPlayedWith.length - 12} more
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function SectionLabel({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div
      className="text-[10px] font-sans font-semibold uppercase tracking-widest mb-2"
      style={{ color: INK_SOFT }}
    >
      {children}
    </div>
  );
}

function SummaryTile({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div
      className="rounded-lg px-3 py-2.5 text-center"
      style={{ background: FOREST_ACCENT, border: "1px solid hsla(42, 52%, 59%, 0.2)" }}
    >
      <div className="font-serif text-xl tabular-nums leading-none" style={{ color: BRASS }}>
        {value}
      </div>
      <div
        className="text-[10px] font-sans uppercase tracking-widest mt-1.5"
        style={{ color: BRASS_FAINT }}
      >
        {label}
      </div>
    </div>
  );
}

type ChipTone = "gold" | "green" | "neutral" | "warm" | "hot" | "ink";

function OutcomeChip({ label, count, tone }: Readonly<{ label: string; count: number; tone: ChipTone }>) {
  const palette: Record<ChipTone, { bg: string; fg: string; border: string }> = {
    gold:    { bg: "hsl(42 70% 88%)", fg: "hsl(35 60% 28%)", border: "hsl(42 50% 70%)" },
    green:   { bg: "hsl(150 35% 86%)", fg: "hsl(150 45% 22%)", border: "hsl(150 30% 70%)" },
    neutral: { bg: "hsl(38 25% 88%)", fg: INK,               border: CREAM_BORDER },
    warm:    { bg: "hsl(30 55% 86%)", fg: "hsl(25 60% 28%)", border: "hsl(30 45% 72%)" },
    hot:     { bg: "hsl(8 60% 88%)",  fg: "hsl(5 55% 32%)",  border: "hsl(8 50% 72%)" },
    ink:     { bg: FOREST_ACCENT,     fg: BRASS,             border: "hsla(42, 52%, 59%, 0.2)" },
  };
  const c = palette[tone];
  return (
    <div
      className="rounded-lg px-1 py-2 text-center"
      style={{ background: c.bg, border: `1px solid ${c.border}` }}
    >
      <div className="font-serif text-lg tabular-nums leading-none" style={{ color: c.fg }}>
        {count}
      </div>
      <div
        className="text-[9px] font-sans font-semibold uppercase tracking-wider mt-1"
        style={{ color: c.fg, opacity: 0.75 }}
      >
        {label}
      </div>
    </div>
  );
}

function fmt(n: number | null): string {
  return n == null ? "—" : String(n);
}

function fmtAvg(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(1);
}

export default function ProfilePage() {
  return (
    <RequireSignIn modalTitle="Sign in to view your profile">
      <ProfileContent />
    </RequireSignIn>
  );
}
