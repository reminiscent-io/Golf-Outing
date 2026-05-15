import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Trophy, Flag, ArrowRight, Coins, Swords, Activity } from "lucide-react";
import { useAuthSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";

const FOREST_DEEP = "hsl(158 65% 9%)";
const FOREST_BG = "hsl(158 60% 11%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";
const CREAM = "hsl(42 45% 91%)";
const CREAM_FG = "hsl(42 45% 88%)";
const BRASS = "hsl(42 52% 59%)";
const BRASS_DEEP = "hsl(42 60% 48%)";
const BRASS_MUTED = "hsl(42 35% 65%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";
const BIRDIE = "hsl(148 45% 40%)";

function Ornament({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-3 ${className}`} aria-hidden>
      <span className="h-px w-10" style={{ background: `linear-gradient(to right, transparent, ${BRASS_FAINT})` }} />
      <span style={{ color: BRASS, fontSize: 10, lineHeight: 1 }}>✦</span>
      <span className="h-px w-10" style={{ background: `linear-gradient(to left, transparent, ${BRASS_FAINT})` }} />
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-sans text-[10px] font-semibold"
      style={{ color: BRASS, letterSpacing: "0.32em", textTransform: "uppercase" }}
    >
      {children}
    </div>
  );
}

function PrimaryCTA({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full font-sans font-semibold text-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
      style={{
        background: BRASS,
        color: INK,
        boxShadow: `0 1px 0 ${BRASS_DEEP} inset, 0 14px 30px -12px hsla(42, 60%, 50%, 0.55), 0 2px 0 hsla(0,0%,0%,0.18)`,
        letterSpacing: "0.04em",
      }}
    >
      {children}
      <ArrowRight size={16} strokeWidth={2.25} className="transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

function HeroScorecard() {
  const holes = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const par = [4, 4, 3, 5, 4, 4, 3, 4, 5];
  const kev: (number | null)[] = [4, 5, 3, 3, 4, 4, 3, null, null];
  const mike: (number | null)[] = [5, 4, 4, 4, 4, 5, 3, null, null];

  function cellClass(score: number | null, p: number) {
    if (score === null) return "";
    if (score <= p - 2) return "score-eagle";
    if (score === p - 1) return "score-birdie";
    return "";
  }

  function row(name: string, scores: (number | null)[], total: number) {
    return (
      <div className="grid items-center" style={{ gridTemplateColumns: "60px repeat(9, minmax(0, 1fr)) 44px" }}>
        <div
          className="font-sans text-[10px] font-semibold pl-3"
          style={{ color: INK, letterSpacing: "0.18em", textTransform: "uppercase" }}
        >
          {name}
        </div>
        {scores.map((s, i) => (
          <div
            key={i}
            className={`text-center font-sans text-[13px] font-semibold tabular-nums py-2 mx-px rounded-[3px] ${cellClass(s, par[i]!)}`}
            style={{
              color: s === null ? "transparent" : INK,
              background: s === null ? "rgba(0,0,0,0.04)" : undefined,
            }}
          >
            {s ?? "·"}
          </div>
        ))}
        <div
          className="text-right font-serif text-[15px] font-semibold tabular-nums pr-3"
          style={{ color: INK }}
        >
          {total}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative mx-auto w-full max-w-[420px]"
      style={{ transform: "rotate(-1.4deg)" }}
    >
      {/* Brass corner stamp */}
      <div
        className="absolute -top-3 -right-3 z-10 flex items-center justify-center rounded-full"
        style={{
          width: 64,
          height: 64,
          background: `radial-gradient(circle at 30% 30%, ${BRASS} 0%, ${BRASS_DEEP} 70%)`,
          boxShadow: `0 6px 18px -6px hsla(42, 60%, 50%, 0.6), inset 0 -2px 4px hsla(0,0%,0%,0.2)`,
          color: INK,
        }}
      >
        <div className="text-center leading-none">
          <div className="font-sans text-[8px] font-bold tracking-[0.2em]">THRU</div>
          <div className="font-serif text-xl font-bold">7</div>
        </div>
      </div>

      <div
        className="rounded-[14px] overflow-hidden"
        style={{
          background: CREAM,
          border: `1px solid hsl(38 25% 78%)`,
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.6) inset, 0 2px 0 rgba(0,0,0,0.05), 0 30px 60px -20px rgba(0,0,0,0.6), 0 12px 24px -12px rgba(0,0,0,0.5)",
        }}
      >
        {/* Card header */}
        <div
          className="px-4 py-3 flex items-center justify-between"
          style={{ borderBottom: `1px dashed hsl(38 25% 70%)`, background: "hsl(42 40% 88%)" }}
        >
          <div>
            <div
              className="font-sans text-[9px] font-bold"
              style={{ color: INK_SOFT, letterSpacing: "0.28em" }}
            >
              OAKWOOD G.C.
            </div>
            <div className="font-serif text-base font-semibold leading-tight" style={{ color: INK }}>
              Round 2 · Net
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-1.5 w-1.5">
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: BIRDIE, animation: "ping 1.6s cubic-bezier(0,0,0.2,1) infinite" }}
              />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5" style={{ background: BIRDIE }} />
            </span>
            <span
              className="font-sans text-[9px] font-bold"
              style={{ color: INK_SOFT, letterSpacing: "0.22em" }}
            >
              LIVE
            </span>
          </div>
        </div>

        {/* Hole numbers */}
        <div
          className="grid items-center py-2"
          style={{
            gridTemplateColumns: "60px repeat(9, minmax(0, 1fr)) 44px",
            background: "hsl(42 35% 86%)",
            borderBottom: `1px solid hsl(38 25% 78%)`,
          }}
        >
          <div
            className="font-sans text-[9px] font-bold pl-3"
            style={{ color: INK_SOFT, letterSpacing: "0.22em" }}
          >
            HOLE
          </div>
          {holes.map(h => (
            <div
              key={h}
              className="text-center font-sans text-[11px] font-bold tabular-nums"
              style={{ color: INK_SOFT }}
            >
              {h}
            </div>
          ))}
          <div
            className="text-right font-sans text-[9px] font-bold pr-3"
            style={{ color: INK_SOFT, letterSpacing: "0.22em" }}
          >
            OUT
          </div>
        </div>

        {/* Par row */}
        <div
          className="grid items-center py-1.5"
          style={{
            gridTemplateColumns: "60px repeat(9, minmax(0, 1fr)) 44px",
            background: "hsl(42 30% 84%)",
            borderBottom: `1px solid hsl(38 25% 76%)`,
          }}
        >
          <div
            className="font-sans text-[9px] font-bold pl-3 italic"
            style={{ color: INK_SOFT, letterSpacing: "0.18em" }}
          >
            PAR
          </div>
          {par.map((p, i) => (
            <div
              key={i}
              className="text-center font-sans text-[11px] font-semibold tabular-nums italic"
              style={{ color: INK_SOFT }}
            >
              {p}
            </div>
          ))}
          <div
            className="text-right font-sans text-[11px] font-bold tabular-nums italic pr-3"
            style={{ color: INK_SOFT }}
          >
            36
          </div>
        </div>

        {/* Player rows */}
        <div className="py-1">{row("Kev", kev, 26)}</div>
        <div style={{ borderTop: `1px solid hsl(38 25% 84%)` }} className="py-1">
          {row("Mike", mike, 31)}
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2.5 flex items-center justify-between"
          style={{ background: "hsl(42 40% 88%)", borderTop: `1px solid hsl(38 25% 76%)` }}
        >
          <div className="font-sans text-[9px] font-bold" style={{ color: INK_SOFT, letterSpacing: "0.22em" }}>
            LEADER
          </div>
          <div className="flex items-center gap-1.5">
            <Trophy size={11} style={{ color: BRASS_DEEP }} strokeWidth={2} />
            <span className="font-serif text-sm font-semibold" style={{ color: INK }}>
              Kev
            </span>
            <span className="font-sans text-[10px] font-semibold tabular-nums" style={{ color: INK_SOFT }}>
              −5
            </span>
          </div>
        </div>
      </div>

      {/* Whisper of a second card behind */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 rounded-[14px]"
        style={{
          transform: "translate(8px, 10px) rotate(2.6deg)",
          background: "hsl(42 35% 84%)",
          border: `1px solid hsl(38 25% 72%)`,
          opacity: 0.55,
        }}
      />
    </div>
  );
}

export default function LandingPage() {
  const [, navigate] = useLocation();
  const session = useAuthSession();
  const [signInOpen, setSignInOpen] = useState(false);

  function handlePrimaryCTA() {
    if (session) {
      navigate("/me/trips");
    } else {
      navigate("/trips");
    }
  }

  return (
    <div className="min-h-screen" style={{ background: FOREST_BG, color: CREAM_FG }}>
      <style>{`
        @keyframes society-rise {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .rise { opacity: 0; animation: society-rise 720ms cubic-bezier(0.22, 1, 0.36, 1) forwards; }
      `}</style>

      {/* ============== HERO ============== */}
      <section
        className="relative overflow-hidden"
        style={{
          background: `radial-gradient(ellipse 120% 70% at 50% 0%, hsl(158 50% 16%) 0%, ${FOREST_BG} 65%)`,
        }}
      >
        {/* Decorative serif glyph */}
        <div
          aria-hidden
          className="pointer-events-none absolute select-none font-serif italic"
          style={{
            top: "-2rem",
            right: "-1.5rem",
            fontSize: "18rem",
            lineHeight: 1,
            color: BRASS,
            opacity: 0.05,
            fontWeight: 700,
          }}
        >
          G
        </div>

        <div className="relative max-w-lg mx-auto px-6 pt-10 pb-14">
          <div className="rise" style={{ animationDelay: "60ms" }}>
            <Eyebrow>The Society · Est. on the first tee</Eyebrow>
          </div>

          <h1
            className="font-serif mt-5 leading-[0.98] tracking-tight rise"
            style={{
              color: CREAM_FG,
              fontSize: "clamp(2.6rem, 11vw, 4.25rem)",
              fontWeight: 600,
              animationDelay: "180ms",
            }}
          >
            Live scoring{" "}
            <span style={{ color: BRASS, fontStyle: "italic", fontWeight: 500 }}>
              for your golf trip.
            </span>
          </h1>

          <p
            className="font-sans text-[15px] mt-5 max-w-md rise"
            style={{ color: BRASS_MUTED, lineHeight: 1.55, animationDelay: "300ms" }}
          >
            Stableford. Skins. Nassau. Net Stroke. Everyone in the group sees the leaderboard
            update as fast as you tap a score — built for the post-round texts, not the tour.
          </p>

          <div
            className="mt-8 flex flex-col items-start gap-3 rise"
            style={{ animationDelay: "420ms" }}
          >
            <PrimaryCTA onClick={handlePrimaryCTA}>
              {session ? `Open ${session.user.fullName.split(" ")[0]}'s trips` : "Start a trip"}
            </PrimaryCTA>
            {!session && (
              <button
                onClick={() => setSignInOpen(true)}
                className="font-sans text-xs hover:opacity-80 transition-opacity ml-1"
                style={{ color: BRASS_MUTED, letterSpacing: "0.06em" }}
              >
                Already in a group?{" "}
                <span style={{ color: BRASS, textDecoration: "underline", textUnderlineOffset: 3 }}>
                  Sign in
                </span>
              </button>
            )}
          </div>

          {/* Hero scorecard */}
          <div className="mt-12 rise" style={{ animationDelay: "560ms" }}>
            <HeroScorecard />
          </div>

          {/* Course caption */}
          <div className="mt-6 flex items-center justify-center gap-2 rise" style={{ animationDelay: "720ms" }}>
            <Flag size={11} style={{ color: BRASS_FAINT }} strokeWidth={1.6} />
            <span
              className="font-sans text-[10px]"
              style={{ color: BRASS_FAINT, letterSpacing: "0.22em", textTransform: "uppercase" }}
            >
              A round in progress · just now
            </span>
          </div>
        </div>
      </section>

      {/* ============== FEATURES ============== */}
      <section className="relative" style={{ background: FOREST_DEEP }}>
        <div className="max-w-lg mx-auto px-6 py-16">
          <Ornament className="mb-5" />
          <Eyebrow>What's in the bag</Eyebrow>
          <h2
            className="font-serif mt-3 mb-10 leading-[1.05]"
            style={{ color: CREAM_FG, fontSize: "clamp(1.85rem, 7vw, 2.5rem)", fontWeight: 500 }}
          >
            Four formats. <span style={{ color: BRASS, fontStyle: "italic" }}>One scorecard.</span>
          </h2>

          <div className="space-y-4">
            <FeatureRow
              numeral="i"
              title="Live leaderboards"
              body="Auto-refreshing standings the whole group can pull up between holes. No reload, no spreadsheet."
              icon={<Activity size={14} strokeWidth={2} style={{ color: BRASS }} />}
            />
            <FeatureRow
              numeral="ii"
              title="Net scoring, done properly"
              body="WHS Course Handicaps applied per round, per tee. Strokes drop on the right holes — automatically."
              icon={<Trophy size={14} strokeWidth={2} style={{ color: BRASS }} />}
            />
            <FeatureRow
              numeral="iii"
              title="Skins, Nassau & Stableford"
              body="Carry-overs handled. Front, back, and overall settled cleanly. The bar tab math is finally easy."
              icon={<Coins size={14} strokeWidth={2} style={{ color: BRASS }} />}
            />
            <FeatureRow
              numeral="iv"
              title="Built for the trip"
              body="Multiple players, multiple rounds, group chat-friendly links. Designed for the four guys you actually play with."
              icon={<Swords size={14} strokeWidth={2} style={{ color: BRASS }} />}
            />
          </div>
        </div>
      </section>

      {/* ============== HOW IT WORKS ============== */}
      <section style={{ background: FOREST_BG }}>
        <div className="max-w-lg mx-auto px-6 py-16">
          <Ornament className="mb-5" />
          <Eyebrow>The order of play</Eyebrow>
          <h2
            className="font-serif mt-3 mb-10 leading-[1.05]"
            style={{ color: CREAM_FG, fontSize: "clamp(1.85rem, 7vw, 2.5rem)", fontWeight: 500 }}
          >
            Three steps. <span style={{ color: BRASS, fontStyle: "italic" }}>Then go play.</span>
          </h2>

          <ol className="relative space-y-7">
            <span
              aria-hidden
              className="absolute left-[15px] top-2 bottom-2 w-px"
              style={{ background: `linear-gradient(to bottom, ${BRASS_DEEP}, transparent)` }}
            />
            <Step n={1} title="Create the trip" body="Name it. The Family Cup. Bachelor 8. Whatever." />
            <Step n={2} title="Add players & handicap indices" body="One per friend. We'll do the Course Handicap math each round." />
            <Step n={3} title="Tap pars and scores in the 18-hole grid" body="Everyone watching the leaderboard sees it the moment you do." />
          </ol>
        </div>
      </section>

      {/* ============== CLOSING CTA ============== */}
      <section
        className="relative overflow-hidden"
        style={{
          background: `linear-gradient(180deg, ${FOREST_BG} 0%, ${FOREST_DEEP} 100%)`,
        }}
      >
        <div className="max-w-lg mx-auto px-6 py-20 text-center">
          <div
            className="inline-flex items-center justify-center mb-6"
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: FOREST_ACCENT,
              border: `1px solid ${BRASS_DEEP}`,
              boxShadow: `0 0 0 6px hsla(42, 52%, 59%, 0.06)`,
            }}
          >
            <Flag size={20} style={{ color: BRASS }} strokeWidth={1.6} />
          </div>
          <h2
            className="font-serif leading-[1.04] mb-4"
            style={{ color: CREAM_FG, fontSize: "clamp(2rem, 8vw, 2.75rem)", fontWeight: 500 }}
          >
            Tee it up.{" "}
            <span style={{ color: BRASS, fontStyle: "italic" }}>The card's already drawn.</span>
          </h2>
          <p
            className="font-sans text-sm max-w-xs mx-auto mb-8"
            style={{ color: BRASS_MUTED, lineHeight: 1.6 }}
          >
            Free to start. No app to install. Works on the phone in your pocket on the cart path.
          </p>
          <PrimaryCTA onClick={handlePrimaryCTA}>
            {session ? "Open my trips" : "Start a trip"}
          </PrimaryCTA>
        </div>
      </section>

      {/* ============== FOOTER ============== */}
      <footer
        className="px-6 py-8 text-center"
        style={{ background: FOREST_DEEP, borderTop: `1px solid ${FOREST_ACCENT}` }}
      >
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-center gap-2 mb-3">
            <Trophy size={13} style={{ color: BRASS }} strokeWidth={1.6} />
            <span
              className="font-serif text-sm"
              style={{ color: BRASS_MUTED, letterSpacing: "0.04em" }}
            >
              Golf Trip Scorecard
            </span>
          </div>
          <Link
            href="/privacy"
            className="font-sans text-xs hover:underline"
            style={{ color: BRASS_FAINT }}
          >
            Privacy Policy & Terms
          </Link>
          <p className="font-sans text-[11px] mt-2" style={{ color: "hsl(42 18% 42%)" }}>
            © Reminiscent Technologies LLC
          </p>
        </div>
      </footer>

      <SignInModal
        open={signInOpen}
        onClose={() => setSignInOpen(false)}
        onSignedIn={() => {
          setSignInOpen(false);
          navigate("/me/trips");
        }}
      />
    </div>
  );
}

function FeatureRow({
  numeral,
  title,
  body,
  icon,
}: {
  numeral: string;
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl px-5 py-5 flex items-start gap-4"
      style={{
        background: "hsla(158, 40%, 14%, 0.6)",
        border: `1px solid hsl(158 35% 18%)`,
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        className="shrink-0 flex items-center justify-center"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background: "hsl(158 45% 12%)",
          border: `1px solid ${BRASS_DEEP}`,
        }}
      >
        <span
          className="font-serif italic text-sm"
          style={{ color: BRASS, letterSpacing: "0.04em" }}
        >
          {numeral}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <h3
            className="font-serif text-[17px] font-semibold leading-tight"
            style={{ color: CREAM_FG }}
          >
            {title}
          </h3>
        </div>
        <p className="font-sans text-[13px] leading-[1.55]" style={{ color: BRASS_MUTED }}>
          {body}
        </p>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="relative pl-12">
      <div
        className="absolute left-0 top-0 flex items-center justify-center font-serif font-semibold tabular-nums"
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: FOREST_DEEP,
          border: `1px solid ${BRASS_DEEP}`,
          color: BRASS,
          fontSize: 14,
        }}
      >
        {n}
      </div>
      <h3 className="font-serif text-[18px] font-semibold leading-tight" style={{ color: CREAM_FG }}>
        {title}
      </h3>
      <p className="font-sans text-[13.5px] mt-1.5 leading-[1.55]" style={{ color: BRASS_MUTED }}>
        {body}
      </p>
    </li>
  );
}
