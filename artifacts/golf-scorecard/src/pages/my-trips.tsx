import { useLocation } from "wouter";
import { useListMyTrips, type UserTripAssociation } from "@workspace/api-client-react";
import { useAuthSession, type AuthSession } from "@/lib/auth";
import { ArrowLeft, Flag, ChevronRight, Plus } from "lucide-react";
import { RequireSignIn } from "@/components/require-sign-in";

const BRASS = "hsl(42 52% 59%)";
const BRASS_MUTED = "hsl(42 35% 70%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const CREAM = "hsl(42 45% 91%)";
const CREAM_BORDER = "hsl(38 25% 78%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";
const FOREST_HAIRLINE = "hsl(158 30% 28%)";

function MyTripsContent({ session }: Readonly<{ session: AuthSession }>) {
  const [, navigate] = useLocation();
  const { data: items, isLoading } = useListMyTrips();

  const myUserId = session.user.id;
  const trips = items ?? [];
  const hasAny = trips.length > 0;

  // Bucket trips by attachment state so each section can read at a glance
  // without per-row badges. Owner takes precedence over player; saved-only
  // falls through to "watching". The server already returns the list ordered
  // most-recent-played first, so the buckets inherit that order.
  const created: UserTripAssociation[] = [];
  const joined: UserTripAssociation[] = [];
  const watching: UserTripAssociation[] = [];
  for (const item of trips) {
    const isOwn = item.trip.createdByUserId === myUserId;
    const isPlayer = item.via === "player" || item.via === "both";
    if (isOwn) created.push(item);
    else if (isPlayer) joined.push(item);
    else watching.push(item);
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            Home
          </button>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-serif" style={{ color: BRASS }}>My Trips</h1>
              <p className="text-sm font-sans mt-1" style={{ color: BRASS_FAINT }}>
                Trips you created, joined, or are watching.
              </p>
            </div>
            <button
              onClick={() => navigate("/trips/new")}
              aria-label="Start a new trip"
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full font-sans text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-90 active:opacity-80"
              style={{
                background: BRASS,
                color: "hsl(38 30% 12%)",
                boxShadow: "0 1px 0 hsl(42 60% 48%) inset, 0 8px 18px -8px hsla(42, 60%, 50%, 0.55)",
                letterSpacing: "0.12em",
              }}
            >
              <Plus size={14} strokeWidth={2.25} />
              New
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "hsl(158 40% 15%)" }} />
            ))}
          </div>
        ) : hasAny ? (
          <div>
            {created.length > 0 && (
              <Section label="Created">
                {created.map(item => (
                  <TripRow
                    key={item.trip.id}
                    item={item}
                    variant="primary"
                    onClick={() => navigate(`/trips/${item.trip.id}`)}
                  />
                ))}
              </Section>
            )}
            {joined.length > 0 && (
              <Section label="Joined">
                {joined.map(item => (
                  <TripRow
                    key={item.trip.id}
                    item={item}
                    variant="primary"
                    onClick={() => navigate(`/trips/${item.trip.id}`)}
                  />
                ))}
              </Section>
            )}
            {watching.length > 0 && (
              <Section label="Watching">
                {watching.map(item => (
                  <TripRow
                    key={item.trip.id}
                    item={item}
                    variant="watching"
                    onClick={() => navigate(`/trips/${item.trip.id}`)}
                  />
                ))}
              </Section>
            )}
          </div>
        ) : (
          <div className="text-center py-16">
            <div
              className="w-14 h-14 mx-auto mb-5 rounded-full flex items-center justify-center"
              style={{ background: FOREST_ACCENT, border: "1px solid hsl(42 60% 48%)" }}
            >
              <Flag size={22} style={{ color: BRASS }} strokeWidth={1.6} />
            </div>
            <p className="font-sans text-sm mb-6 max-w-xs mx-auto" style={{ color: BRASS_FAINT, lineHeight: 1.55 }}>
              You haven't joined or saved any trips yet. Start one and invite the group.
            </p>
            <button
              onClick={() => navigate("/trips/new")}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-sans font-semibold text-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
              style={{
                background: BRASS,
                color: "hsl(38 30% 12%)",
                boxShadow: "0 1px 0 hsl(42 60% 48%) inset, 0 14px 30px -12px hsla(42, 60%, 50%, 0.55), 0 2px 0 hsla(0,0%,0%,0.18)",
                letterSpacing: "0.04em",
              }}
            >
              <Plus size={16} strokeWidth={2.25} />
              New Trip
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="flex items-center gap-3 mb-3 px-1">
        <span
          className="text-[10px] font-sans font-bold uppercase"
          style={{ color: BRASS, letterSpacing: "0.32em" }}
        >
          {label}
        </span>
        <span className="flex-1 border-t border-dashed" style={{ borderColor: FOREST_HAIRLINE }} />
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

// Parse a "YYYY-MM-DD" round.date string as a local-time Date so month/day
// labels match what the user picked, regardless of the browser timezone.
function parseLocalDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function formatTripDates(range: UserTripAssociation["dateRange"]): string | null {
  if (!range) return null;
  const start = parseLocalDate(range.start);
  const end = parseLocalDate(range.end);
  if (!start || !end) return null;
  const sameDay = range.start === range.end;
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  const monthDay = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const monthDayYear = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (sameDay) return monthDayYear(start);
  if (sameMonth) return `${monthDay(start)}–${end.getDate()}, ${end.getFullYear()}`;
  if (sameYear) return `${monthDay(start)} – ${monthDay(end)}, ${end.getFullYear()}`;
  return `${monthDayYear(start)} – ${monthDayYear(end)}`;
}

function TripRow({
  item,
  variant,
  onClick,
}: Readonly<{
  item: UserTripAssociation;
  variant: "primary" | "watching";
  onClick: () => void;
}>) {
  const dateLabel = formatTripDates(item.dateRange);

  if (variant === "watching") {
    return (
      <div
        onClick={onClick}
        className="rounded-xl px-4 py-3 cursor-pointer flex items-center justify-between gap-3 group transition-opacity hover:opacity-90"
        style={{ background: FOREST_ACCENT, border: `1px solid ${FOREST_HAIRLINE}` }}
      >
        <div className="min-w-0 flex-1">
          <div className="font-sans font-semibold text-sm truncate" style={{ color: BRASS_MUTED }}>
            {item.trip.name}
          </div>
          {dateLabel && (
            <div className="text-xs mt-0.5 truncate" style={{ color: BRASS_FAINT }}>
              {dateLabel}
            </div>
          )}
        </div>
        <ChevronRight size={16} style={{ color: "hsl(42 25% 45%)" }} />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="rounded-xl px-5 py-4 cursor-pointer flex items-center justify-between gap-3 group transition-transform hover:scale-[1.005]"
      style={{ background: CREAM, border: `1px solid ${CREAM_BORDER}` }}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="rounded-lg p-2" style={{ background: FOREST_ACCENT }}>
          <Flag size={16} style={{ color: BRASS }} />
        </div>
        <div className="min-w-0 flex-1">
          <div
            className="font-serif font-medium text-[17px] leading-tight truncate"
            style={{ color: INK }}
          >
            {item.trip.name}
          </div>
          {dateLabel && (
            <div className="text-xs mt-1 truncate" style={{ color: INK_SOFT }}>
              {dateLabel}
            </div>
          )}
        </div>
      </div>
      <ChevronRight size={18} style={{ color: "hsl(38 20% 50%)" }} />
    </div>
  );
}

export default function MyTripsPage() {
  const session = useAuthSession();
  if (!session) {
    return <RequireSignIn mandatory>{null}</RequireSignIn>;
  }
  return <MyTripsContent session={session} />;
}
