import { Link, useLocation } from "wouter";
import { useListMyTrips } from "@workspace/api-client-react";
import { useAuthSession } from "@/lib/auth";
import { ArrowLeft, Flag, ChevronRight } from "lucide-react";
import { RequireSignIn } from "@/components/require-sign-in";

function MyTripsContent() {
  const [, navigate] = useLocation();
  const { data: items, isLoading } = useListMyTrips();

  return (
    <div className="min-h-screen bg-background">
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
          <h1 className="text-3xl font-serif" style={{ color: "hsl(42 52% 59%)" }}>My Trips</h1>
          <p className="text-sm font-sans mt-1" style={{ color: "hsl(42 25% 60%)" }}>
            Every trip you joined or saved.
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "hsl(158 40% 15%)" }} />
            ))}
          </div>
        ) : items && items.length > 0 ? (
          <div className="space-y-3">
            {items.map(item => (
              <div
                key={item.trip.id}
                onClick={() => navigate(`/trips/${item.trip.id}`)}
                className="rounded-xl px-5 py-4 cursor-pointer flex items-center justify-between group transition-all hover:scale-[1.01]"
                style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="rounded-lg p-2" style={{ background: "hsl(158 35% 20%)" }}>
                    <Flag size={16} style={{ color: "hsl(42 52% 59%)" }} />
                  </div>
                  <div className="min-w-0">
                    <div className="font-sans font-semibold text-sm truncate" style={{ color: "hsl(38 30% 14%)" }}>
                      {item.trip.name}
                    </div>
                    <div className="text-xs mt-0.5 flex items-center gap-2" style={{ color: "hsl(38 20% 38%)" }}>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
                        style={{
                          background: item.via === "saved" ? "hsl(42 30% 80%)" : "hsl(158 35% 20%)",
                          color: item.via === "saved" ? "hsl(38 30% 20%)" : "hsl(42 52% 59%)",
                        }}
                      >
                        {item.via === "saved" ? "Saved" : item.via === "both" ? "Player + Saved" : "Player"}
                      </span>
                      {item.players.length > 0 && (
                        <span className="truncate">as {item.players.map(p => p.name).join(", ")}</span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "hsl(38 20% 50%)" }} />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="font-sans text-sm" style={{ color: "hsl(42 25% 60%)" }}>
              You haven't joined or saved any trips yet.
            </p>
            <Link
              href="/"
              className="inline-block mt-4 text-xs font-sans underline"
              style={{ color: "hsl(42 35% 65%)" }}
            >
              Go to home
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MyTripsPage() {
  const session = useAuthSession();
  if (!session) {
    return <RequireSignIn mandatory>{null}</RequireSignIn>;
  }
  return <MyTripsContent />;
}
