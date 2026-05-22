import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useUpdateMe, useGetMyStats, type MyStatsResponse } from "@workspace/api-client-react";
import { ArrowLeft, User as UserIcon, Trophy } from "lucide-react";
import { RequireSignIn } from "@/components/require-sign-in";
import { useAuthSession, updateSessionUser } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { goBackOr } from "@/lib/back-nav";

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

const FOCUS_RING_ON_CREAM =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card";
const FOCUS_RING_ON_FOREST =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

// Brass on cream: use --brass-ink (32% lightness) to pass WCAG AA on cream surfaces.
// The bright --primary brass is forest-context only.
const BRASS_INK_STYLE = { color: "hsl(var(--brass-ink))" } as const;

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
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-10 pb-6 bg-sidebar">
        <div className="max-w-lg mx-auto">
          <button
            type="button"
            onClick={() => goBackOr("/", navigate)}
            className={`inline-flex items-center gap-1.5 text-xs font-sans mb-3 min-h-11 -mx-2 px-2 rounded transition-opacity hover:opacity-70 ${FOCUS_RING_ON_FOREST}`}
            style={{ color: "hsl(var(--brass-muted))" }}
          >
            <ArrowLeft size={14} aria-hidden />
            Back
          </button>
          <h1 className="text-3xl font-serif text-primary">Profile</h1>
          <p
            className="text-sm font-sans mt-1"
            style={{ color: "hsl(var(--brass-faint))" }}
          >
            Your handicap will autofill when you join new trips.
          </p>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <IdentitySection
          fullName={session.user.fullName}
          phone={session.user.phone}
          hcp={hcp}
          setHcp={setHcp}
          onSubmit={handleSubmit}
          saving={updateMe.isPending}
        />
        <StatsSection />
        <SettingsSection />
      </main>
    </div>
  );
}

type IdentitySectionProps = Readonly<{
  fullName: string;
  phone: string;
  hcp: string;
  setHcp: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  saving: boolean;
}>;

function IdentitySection({ fullName, phone, hcp, setHcp, onSubmit, saving }: IdentitySectionProps) {
  return (
    <section
      aria-labelledby="profile-identity-heading"
      className="bg-card border border-card-border rounded-2xl px-6 py-6"
    >
      <div className="flex items-center gap-3 pb-5 mb-5 border-b border-dashed border-card-border">
        <div
          className="inline-flex items-center justify-center rounded-full w-11 h-11 bg-accent text-primary shrink-0"
          style={{ border: "1px solid hsl(var(--primary) / 0.35)" }}
          aria-hidden
        >
          <UserIcon size={20} strokeWidth={1.75} />
        </div>
        <div className="min-w-0">
          <h2
            id="profile-identity-heading"
            className="font-serif text-base font-semibold text-card-foreground truncate"
          >
            {fullName}
          </h2>
          <div
            className="font-sans text-xs tabular-nums text-muted-foreground"
            aria-label={`Phone number ${phone}`}
          >
            {phone}
          </div>
        </div>
      </div>

      <form onSubmit={onSubmit} noValidate>
        <label
          htmlFor="profile-handicap"
          className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] mb-2"
          style={BRASS_INK_STYLE}
        >
          Handicap Index
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
          aria-describedby="profile-handicap-help"
          className={`w-full px-3 py-3 rounded-lg text-sm font-sans bg-popover text-card-foreground transition-shadow ${FOCUS_RING_ON_CREAM}`}
          style={{
            outline: "none",
            border: "1.5px solid hsl(var(--input))",
          }}
        />
        <p
          id="profile-handicap-help"
          className="text-xs font-sans mt-1.5 mb-5 text-muted-foreground"
        >
          Decimals OK. Leave empty to clear.
        </p>

        <button
          type="submit"
          disabled={saving}
          className={`inline-flex items-center justify-center w-full min-h-11 px-7 py-3 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm transition-transform hover:-translate-y-0.5 active:translate-y-0 motion-reduce:transition-none motion-reduce:hover:translate-y-0 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING_ON_CREAM}`}
          style={{
            boxShadow:
              "0 1px 0 hsl(var(--brass-deep)) inset, 0 14px 30px -12px hsla(42, 60%, 50%, 0.55), 0 2px 0 hsla(0, 0%, 0%, 0.18)",
            letterSpacing: "0.04em",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </form>
    </section>
  );
}

function StatsSection() {
  const { data, isLoading, isError } = useGetMyStats();

  return (
    <section
      aria-labelledby="profile-stats-heading"
      className="bg-card border border-card-border rounded-2xl px-6 py-6"
    >
      <div className="flex items-center gap-1.5 mb-2" style={BRASS_INK_STYLE}>
        <Trophy size={11} strokeWidth={2.25} aria-hidden />
        <span className="font-sans text-[10px] font-semibold tracking-[0.32em] uppercase">
          Career Card
        </span>
      </div>
      <h2
        id="profile-stats-heading"
        className="font-serif text-lg font-semibold text-card-foreground"
      >
        Your Stats
      </h2>
      <p className="font-sans text-xs text-muted-foreground mt-1">
        Across every round you've played.
      </p>

      {isLoading && <StatsSkeleton />}
      {!isLoading && isError && (
        <output className="block text-sm font-sans text-muted-foreground mt-6">
          Couldn't load stats right now.
        </output>
      )}
      {!isLoading && !isError && data && <StatsBody stats={data} />}
    </section>
  );
}

function StatsSkeleton() {
  const widths = ["88%", "76%", "84%", "92%", "70%"];
  return (
    <div
      className="mt-6 space-y-3"
      role="status"
      aria-live="polite"
      aria-label="Loading stats"
    >
      {widths.map(w => (
        <div
          key={w}
          className="h-4 rounded-sm motion-safe:animate-pulse"
          style={{ background: "hsl(var(--paper-band))", width: w }}
        />
      ))}
    </div>
  );
}

function StatsBody({ stats }: Readonly<{ stats: MyStatsResponse }>) {
  const { tripsCreated, roundsPlayed, holesPlayed, scoring, holeOutcomes, playersPlayedWith } = stats;
  const noHistory = roundsPlayed === 0 && tripsCreated === 0;

  if (noHistory) {
    return (
      <p
        className="text-sm font-sans text-muted-foreground mt-6"
        style={{ lineHeight: 1.55 }}
      >
        No rounds yet. Join a trip and enter scores to start tracking eagles, birdies, and more.
      </p>
    );
  }

  return (
    <div className="mt-2">
      <CardSection eyebrow="Overview">
        <dl>
          <LeaderRow label="Trips made" value={String(tripsCreated)} />
          <LeaderRow label="Rounds played" value={String(roundsPlayed)} />
          <LeaderRow label="Holes" value={String(holesPlayed)} />
        </dl>
      </CardSection>

      <CardSection eyebrow="Scoring · 18 Holes">
        {scoring.completedRounds === 0 ? (
          <p className="font-sans text-xs italic text-muted-foreground">
            Finish a full 18-hole round to unlock scoring totals.
          </p>
        ) : (
          <dl>
            <LeaderRow label="Best" value={fmt(scoring.bestGross)} />
            <LeaderRow label="Average" value={fmtAvg(scoring.avgGross)} />
            <LeaderRow label="Worst" value={fmt(scoring.worstGross)} />
          </dl>
        )}
      </CardSection>

      <CardSection eyebrow="Hole Results · vs Par">
        <OutcomesScorecard outcomes={holeOutcomes} total={holesPlayed} />
      </CardSection>

      <CardSection eyebrow="Played With" last>
        {playersPlayedWith.length === 0 ? (
          <p className="font-sans text-sm text-muted-foreground">No co-players yet.</p>
        ) : (
          <dl>
            {playersPlayedWith.slice(0, 12).map(p => (
              <LeaderRow
                key={p.name}
                label={p.name}
                value={`${p.rounds} ${p.rounds === 1 ? "round" : "rounds"}`}
              />
            ))}
            {playersPlayedWith.length > 12 && (
              <p className="font-sans text-[11px] pt-2 text-muted-foreground">
                + {playersPlayedWith.length - 12} more
              </p>
            )}
          </dl>
        )}
      </CardSection>
    </div>
  );
}

function CardSection({
  eyebrow,
  children,
  last = false,
}: Readonly<{ eyebrow: string; children: React.ReactNode; last?: boolean }>) {
  return (
    <div className={`pt-5 ${last ? "" : "pb-5 border-b border-dashed border-card-border"}`}>
      <div
        className="font-sans text-[10px] font-semibold tracking-[0.32em] uppercase mb-3"
        style={BRASS_INK_STYLE}
      >
        {eyebrow}
      </div>
      {children}
    </div>
  );
}

function LeaderRow({ label, value }: Readonly<{ label: string; value: string }>) {
  return (
    <div className="flex items-baseline gap-2 py-1.5 first:pt-0 last:pb-0">
      <dt className="font-sans text-sm text-card-foreground truncate min-w-0">{label}</dt>
      <span
        aria-hidden
        className="flex-1 self-end mb-1.5 border-b border-dotted shrink"
        style={{ borderColor: "hsl(var(--muted-foreground) / 0.45)" }}
      />
      <dd className="font-serif text-base font-semibold tabular-nums text-card-foreground shrink-0">
        {value}
      </dd>
    </div>
  );
}

type Outcomes = MyStatsResponse["holeOutcomes"];

type OutcomeCell = {
  key: string;
  short: string;
  full: string;
  count: number;
  bg: string;
  fg: string;
};

function OutcomesScorecard({ outcomes, total }: Readonly<{ outcomes: Outcomes; total: number }>) {
  const cells: OutcomeCell[] = [
    { key: "eagles",   short: "Eag+", full: "Eagle or better", count: outcomes.eagles,   bg: "hsl(var(--score-eagle))",  fg: "hsl(38 30% 12%)" },
    { key: "birdies",  short: "Bird", full: "Birdie",          count: outcomes.birdies,  bg: "hsl(var(--score-birdie))", fg: "hsl(42 45% 93%)" },
    { key: "pars",     short: "Par",  full: "Par",             count: outcomes.pars,     bg: "hsl(var(--score-par))",    fg: "hsl(38 30% 18%)" },
    { key: "bogeys",   short: "Bog",  full: "Bogey",           count: outcomes.bogeys,   bg: "hsl(var(--score-bogey))",  fg: "hsl(38 30% 18%)" },
    { key: "doubles",  short: "Dbl",  full: "Double bogey",    count: outcomes.doubles,  bg: "hsl(var(--score-double))", fg: "hsl(0 0% 98%)" },
    { key: "triples",  short: "Tpl",  full: "Triple bogey",    count: outcomes.triples,  bg: "hsl(var(--score-triple))", fg: "hsl(0 0% 98%)" },
    { key: "quadPlus", short: "Q+",   full: "Quad or worse",   count: outcomes.quadPlus, bg: "hsl(var(--score-quad))",   fg: "hsl(0 0% 98%)" },
    { key: "total",    short: "All",  full: "Total holes",     count: total,             bg: "hsl(var(--accent))",       fg: "hsl(var(--primary))" },
  ];

  return (
    <table
      className="w-full border-collapse"
      style={{ border: "1px solid hsl(var(--card-border))", borderRadius: 6, overflow: "hidden", borderSpacing: 0 }}
    >
      <caption className="sr-only">Hole results compared to par across every round played</caption>
      <thead>
        <tr
          style={{
            background: "hsl(var(--paper-band))",
            borderBottom: "1px solid hsl(var(--card-border))",
          }}
        >
          {cells.map(c => (
            <th
              key={c.key}
              scope="col"
              className="font-sans text-[9px] font-bold uppercase text-center py-1.5"
              style={{ color: "hsl(var(--muted-foreground))", letterSpacing: "0.08em" }}
            >
              <abbr title={c.full} style={{ textDecoration: "none" }}>
                {c.short}
              </abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          {cells.map(c => (
            <td
              key={c.key}
              className="text-center py-2 font-serif text-base font-semibold tabular-nums"
              style={{ background: c.bg, color: c.fg }}
            >
              {c.count}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function fmt(n: number | null): string {
  return n == null ? "—" : String(n);
}

function fmtAvg(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(1);
}

function SettingsSection() {
  const session = useAuthSession();
  const updateMe = useUpdateMe();
  const { toast } = useToast();
  const [discoverable, setDiscoverable] = useState(!!session?.user.discoverableByPhone);
  const [profileVisibility, setProfileVisibility] = useState<"public" | "private">(session?.user.profileVisibility ?? "public");

  useEffect(() => {
    if (session) {
      setDiscoverable(!!session.user.discoverableByPhone);
      setProfileVisibility(session.user.profileVisibility);
    }
  }, [session]);

  function persist(patch: { discoverableByPhone?: boolean; profileVisibility?: "public" | "private" }) {
    updateMe.mutate(
      { data: patch },
      {
        onSuccess: (u) => {
          updateSessionUser({ discoverableByPhone: u.discoverableByPhone, profileVisibility: u.profileVisibility });
          toast({ description: "Settings saved", duration: 1500 });
        },
        onError: () => toast({ description: "Could not save", variant: "destructive" }),
      }
    );
  }

  if (!session) return null;
  return (
    <section className="bg-card border border-card-border rounded-2xl px-6 py-6">
      <h2 className="font-serif text-lg font-semibold text-card-foreground">Privacy</h2>
      <p className="font-sans text-xs text-muted-foreground mt-1 mb-4">
        Both default to safe values. Flip them deliberately if you want broader reach.
      </p>
      <div className="space-y-4">
        <ToggleRow
          label="Public profile"
          description="Off hides you from search and the All feed. People who already follow you keep access."
          checked={profileVisibility === "public"}
          onChange={(v) => { const next = v ? "public" : "private"; setProfileVisibility(next); persist({ profileVisibility: next }); }}
        />
        <ToggleRow
          label="Discoverable by phone"
          description="Off (default) blocks reverse phone lookup. On lets people who know your phone number find your profile."
          checked={discoverable}
          onChange={(v) => { setDiscoverable(v); persist({ discoverableByPhone: v }); }}
        />
      </div>
    </section>
  );
}

function ToggleRow({ label, description, checked, onChange }: Readonly<{ label: string; description: string; checked: boolean; onChange: (v: boolean) => void }>) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-sans text-sm font-semibold text-card-foreground">{label}</div>
        <div className="font-sans text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative h-6 w-11 rounded-full shrink-0 transition-colors"
        style={{ background: checked ? "hsl(var(--primary))" : "hsl(var(--muted))" }}
      >
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all" style={{ left: checked ? "1.5rem" : "0.125rem" }} />
      </button>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireSignIn modalTitle="Sign in to view your profile">
      <ProfileContent />
    </RequireSignIn>
  );
}
