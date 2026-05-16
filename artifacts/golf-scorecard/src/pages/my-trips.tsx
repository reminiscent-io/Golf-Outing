import { useLocation } from "wouter";
import { useListMyTrips, type UserTripAssociation } from "@workspace/api-client-react";
import { useAuthSession, type AuthSession } from "@/lib/auth";
import { ArrowLeft, Flag, ChevronRight, Plus } from "lucide-react";
import { RequireSignIn } from "@/components/require-sign-in";

const BRASS = "hsl(42 52% 59%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const CREAM = "hsl(42 45% 91%)";
const CREAM_BORDER = "hsl(38 25% 78%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";

function MyTripsContent({ session }: { session: AuthSession }) {
  const [, navigate] = useLocation();
  const { data: items, isLoading } = useListMyTrips();

  const myUserId = session.user.id;
  const rounds = items ?? [];
  const hasAny = rounds.length > 0;

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
                Trips you made, joined, or are watching.
              </p>
            </div>
            <button
              onClick={() => navigate("/trips?new=1")}
              aria-label="Start a new round"
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
          <div className="space-y-3">
            {rounds.map(item => (
              <TripRow
                key={item.trip.id}
                item={item}
                isOwn={item.trip.createdByUserId === myUserId}
                onClick={() => navigate(`/trips/${item.trip.id}`)}
              />
            ))}
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
              onClick={() => navigate("/trips?new=1")}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-sans font-semibold text-sm transition-transform hover:-translate-y-0.5 active:translate-y-0"
              style={{
                background: BRASS,
                color: "hsl(38 30% 12%)",
                boxShadow: "0 1px 0 hsl(42 60% 48%) inset, 0 14px 30px -12px hsla(42, 60%, 50%, 0.55), 0 2px 0 hsla(0,0%,0%,0.18)",
                letterSpacing: "0.04em",
              }}
            >
              <Plus size={16} strokeWidth={2.25} />
              Create a Round
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function viaLabelFor(item: UserTripAssociation, isOwn: boolean): string {
  if (isOwn) return "Yours";
  if (item.via === "saved") return "Watching";
  if (item.via === "both") return "Player + Saved";
  return "Player";
}

function TripRow({
  item,
  isOwn,
  onClick,
}: Readonly<{
  item: UserTripAssociation;
  isOwn: boolean;
  onClick: () => void;
}>) {
  const isObserverOnly = item.via === "saved";
  const viaLabel = viaLabelFor(item, isOwn);
  const badgeMuted = isObserverOnly && !isOwn;
  return (
    <div
      onClick={onClick}
      className="rounded-xl px-5 py-4 cursor-pointer flex items-center justify-between group transition-all hover:scale-[1.01]"
      style={{ background: CREAM, border: `1px solid ${CREAM_BORDER}` }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="rounded-lg p-2" style={{ background: FOREST_ACCENT }}>
          <Flag size={16} style={{ color: BRASS }} />
        </div>
        <div className="min-w-0">
          <div className="font-sans font-semibold text-sm truncate" style={{ color: INK }}>
            {item.trip.name}
          </div>
          <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: INK_SOFT }}>
            <span
              className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
              style={{
                background: badgeMuted ? "hsl(42 30% 80%)" : FOREST_ACCENT,
                color: badgeMuted ? "hsl(38 30% 20%)" : BRASS,
              }}
            >
              {viaLabel}
            </span>
            {item.players.length > 0 && (
              <span className="truncate">as {item.players.map(p => p.name).join(", ")}</span>
            )}
          </div>
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
