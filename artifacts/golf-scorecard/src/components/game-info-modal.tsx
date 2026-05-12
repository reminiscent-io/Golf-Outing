import { useState, type ReactNode } from "react";
import { Info, Trophy, Coins, Swords, Flag, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";

export type GameKey = "stableford" | "skins" | "nassau" | "netStroke" | "handicaps";

type Section = { heading: string; body: ReactNode };
type GameDef = {
  key: GameKey;
  label: string;
  tagline: string;
  icon: typeof Trophy;
  sections: Section[];
};

const ACCENT = "hsl(42 52% 59%)";
const PARCHMENT = "hsl(42 35% 94%)";
const PARCHMENT_DEEP = "hsl(42 30% 88%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";
const FOREST = "hsl(158 50% 14%)";
const FOREST_EDGE = "hsl(158 40% 22%)";

function Pts({ children }: { children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center justify-center font-serif font-semibold text-xs rounded-md px-1.5 py-0.5 mx-0.5"
      style={{ background: ACCENT, color: INK, minWidth: 22 }}
    >
      {children}
    </span>
  );
}

function ExampleBox({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg p-3 mt-2 text-xs font-sans leading-relaxed"
      style={{ background: PARCHMENT_DEEP, border: `1px solid hsl(38 25% 78%)`, color: INK_SOFT }}
    >
      <div className="text-[10px] uppercase tracking-widest font-semibold mb-1.5" style={{ color: ACCENT }}>
        Example
      </div>
      {children}
    </div>
  );
}

const GAMES: Record<GameKey, GameDef> = {
  stableford: {
    key: "stableford",
    label: "Stableford",
    tagline: "Earn points per hole — high score wins.",
    icon: Trophy,
    sections: [
      {
        heading: "How it works",
        body: (
          <p>
            On every hole you earn points based on your <strong>net score versus par</strong>. The higher your
            total, the better — one bad hole won't sink your round.
          </p>
        ),
      },
      {
        heading: "Points scale (net to par)",
        body: (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between"><span>Eagle or better (−2 or lower)</span><Pts>4–5</Pts></div>
            <div className="flex items-center justify-between"><span>Birdie (−1)</span><Pts>3</Pts></div>
            <div className="flex items-center justify-between"><span>Par (0)</span><Pts>2</Pts></div>
            <div className="flex items-center justify-between"><span>Bogey (+1)</span><Pts>1</Pts></div>
            <div className="flex items-center justify-between"><span>Double bogey or worse</span><Pts>0</Pts></div>
          </div>
        ),
      },
      {
        heading: "Winning",
        body: (
          <p>
            Add up all 18 holes. <strong>Highest point total wins</strong> the round (and the trip leaderboard).
          </p>
        ),
      },
    ],
  },
  skins: {
    key: "skins",
    label: "Skins",
    tagline: "Win a hole outright — claim the skin.",
    icon: Coins,
    sections: [
      {
        heading: "How it works",
        body: (
          <p>
            On each hole, the player with the <strong>lowest net score wins one skin</strong>. If two or more
            players tie for the low score, no one wins — the skin <strong>carries</strong> to the next hole.
          </p>
        ),
      },
      {
        heading: "Carries",
        body: (
          <p>
            A carried skin stacks on top of the next hole's skin. Win that hole outright and you collect the
            full stack. Ties carry again.
          </p>
        ),
      },
      {
        heading: "Winning",
        body: <p>Most skins won across the round wins. Carried-but-unclaimed skins don't pay out.</p>,
      },
      {
        heading: "",
        body: (
          <ExampleBox>
            Holes 1–3 all tie ➞ skin pot grows to <strong>3</strong>. On hole 4, you net birdie alone ➞ you
            collect all <strong>4 skins</strong> at once.
          </ExampleBox>
        ),
      },
    ],
  },
  nassau: {
    key: "nassau",
    label: "Team Nassau",
    tagline: "Three matches in one: Front, Back, Total.",
    icon: Swords,
    sections: [
      {
        heading: "How it works",
        body: (
          <p>
            Each group is split into <strong>two teams</strong>. The teams play three separate match-play
            contests using <strong>best-ball</strong> (the team's lowest net score on each hole).
          </p>
        ),
      },
      {
        heading: "The three matches",
        body: (
          <div className="space-y-1.5">
            <div><strong>Front 9</strong> — match played over holes 1–9.</div>
            <div><strong>Back 9</strong> — match played over holes 10–18.</div>
            <div><strong>Total 18</strong> — match played over all 18 holes.</div>
          </div>
        ),
      },
      {
        heading: "Scoring",
        body: (
          <p>
            On each hole, the team with the lower best-ball score goes <strong>1 up</strong>. Tied holes are
            halved. Whichever team finishes a segment ahead wins that match.
          </p>
        ),
      },
    ],
  },
  netStroke: {
    key: "netStroke",
    label: "Net Stroke Play",
    tagline: "Lowest net score wins — pure and simple.",
    icon: Flag,
    sections: [
      {
        heading: "How it works",
        body: (
          <p>
            Count every shot. <strong>Net score = gross score − handicap strokes received</strong> on each
            hole. Total all 18 holes; lowest net wins.
          </p>
        ),
      },
      {
        heading: "Why net?",
        body: (
          <p>
            Handicaps level the field so a 20-handicap and a 5-handicap can compete head-to-head. See the
            <strong> Handicaps</strong> tab for how strokes are allocated.
          </p>
        ),
      },
    ],
  },
  handicaps: {
    key: "handicaps",
    label: "Handicaps",
    tagline: "How strokes are calculated and applied.",
    icon: Info,
    sections: [
      {
        heading: "Course Handicap (WHS)",
        body: (
          <p>
            We convert each player's <strong>handicap index</strong> into a course-specific number using the
            World Handicap System formula:
            <span className="block mt-1.5 font-serif text-sm" style={{ color: INK }}>
              Course Hcp = Index × (Slope / 113) + (Rating − Par)
            </span>
            <span className="block mt-1 text-[11px]" style={{ color: INK_SOFT }}>
              If slope/rating aren't set for the course, we use the rounded index directly.
            </span>
          </p>
        ),
      },
      {
        heading: "Net vs Gross mode",
        body: (
          <div className="space-y-1.5">
            <div>
              <strong>Net mode</strong> — within each group, the lowest handicap plays scratch (0). Everyone
              else gets the difference. This keeps matches fair inside a foursome.
            </div>
            <div>
              <strong>Gross mode</strong> — every player uses their full Course Handicap. No relative
              adjustment.
            </div>
          </div>
        ),
      },
      {
        heading: "Stroke allocation",
        body: (
          <p>
            Strokes are distributed by each hole's <strong>stroke index</strong> (1 = hardest, 18 = easiest).
            A 14-handicap gets one stroke on stroke indexes 1–14. A 22-handicap gets one stroke on every hole,
            plus a second stroke on indexes 1–4.
          </p>
        ),
      },
      {
        heading: "How strokes affect scoring",
        body: (
          <p>
            On a hole where you receive a stroke, your <strong>net score = gross − 1</strong> (or −2 if you
            get two). Stableford points and Skins both use this net score.
          </p>
        ),
      },
    ],
  },
};

const TAB_ORDER: GameKey[] = ["stableford", "skins", "nassau", "netStroke", "handicaps"];

export function GameInfoButton({
  game,
  size = 14,
  className,
  label,
}: {
  game: GameKey;
  size?: number;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen(true); }}
        aria-label={`How ${GAMES[game].label} works`}
        className={`inline-flex items-center gap-1 rounded-full transition-opacity hover:opacity-100 ${className ?? ""}`}
        style={{ color: ACCENT, opacity: 0.75 }}
      >
        <Info size={size} strokeWidth={2.25} />
        {label && (
          <span className="text-[10px] font-sans font-semibold uppercase tracking-widest">{label}</span>
        )}
      </button>
      <GameInfoModal open={open} onOpenChange={setOpen} initial={game} />
    </>
  );
}

export function GameInfoModal({
  open,
  onOpenChange,
  initial = "stableford",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: GameKey;
}) {
  const [active, setActive] = useState<GameKey>(initial);
  // Sync when modal is re-opened with a different initial
  const [lastInitial, setLastInitial] = useState(initial);
  if (open && initial !== lastInitial) {
    setLastInitial(initial);
    setActive(initial);
  }

  const def = GAMES[active];
  const Icon = def.icon;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{ background: "rgba(20, 30, 25, 0.72)", backdropFilter: "blur(2px)" }}
        />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-1.5rem))] max-h-[88vh] -translate-x-1/2 -translate-y-1/2 rounded-2xl overflow-hidden flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          style={{ background: PARCHMENT, border: `1px solid ${FOREST_EDGE}`, boxShadow: "0 24px 60px rgba(0,0,0,0.45)" }}
        >
          {/* Header */}
          <div className="px-5 pt-5 pb-3" style={{ background: FOREST, color: PARCHMENT }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className="rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ width: 36, height: 36, background: "rgba(255,255,255,0.08)", color: ACCENT }}
                >
                  <Icon size={18} strokeWidth={2} />
                </div>
                <div className="min-w-0">
                  <DialogPrimitive.Title className="font-serif text-lg leading-tight" style={{ color: PARCHMENT }}>
                    {def.label}
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="text-xs font-sans mt-0.5" style={{ color: "hsl(42 20% 65%)" }}>
                    {def.tagline}
                  </DialogPrimitive.Description>
                </div>
              </div>
              <DialogPrimitive.Close
                className="rounded-full p-1 flex-shrink-0 transition-colors hover:bg-white/10"
                style={{ color: "hsl(42 20% 65%)" }}
                aria-label="Close"
              >
                <X size={18} />
              </DialogPrimitive.Close>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 mt-4 -mx-1 overflow-x-auto pb-1" style={{ scrollbarWidth: "none" }}>
              {TAB_ORDER.map(k => {
                const isActive = k === active;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setActive(k)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-sans font-semibold uppercase tracking-widest whitespace-nowrap transition-all"
                    style={{
                      background: isActive ? ACCENT : "rgba(255,255,255,0.05)",
                      color: isActive ? INK : "hsl(42 20% 70%)",
                      border: isActive ? `1px solid ${ACCENT}` : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    {GAMES[k].label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Body */}
          <div className="overflow-y-auto px-5 py-4 space-y-4" style={{ color: INK }}>
            {def.sections.map((s, i) => (
              <div key={i}>
                {s.heading && (
                  <h4
                    className="font-sans font-semibold text-[10px] uppercase tracking-widest mb-1.5"
                    style={{ color: INK_SOFT }}
                  >
                    {s.heading}
                  </h4>
                )}
                <div className="text-sm font-sans leading-relaxed" style={{ color: INK }}>
                  {s.body}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div
            className="px-5 py-3 flex items-center justify-between"
            style={{ background: PARCHMENT_DEEP, borderTop: `1px solid hsl(38 25% 78%)` }}
          >
            <span className="text-[11px] font-sans" style={{ color: INK_SOFT }}>
              Scoring runs server-side so leaderboards stay consistent.
            </span>
            <DialogPrimitive.Close
              className="px-3 py-1.5 rounded-lg text-xs font-sans font-semibold uppercase tracking-widest transition-all"
              style={{ background: FOREST, color: ACCENT, border: `1px solid ${FOREST_EDGE}` }}
            >
              Got it
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
