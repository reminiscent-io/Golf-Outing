import { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, Plus } from "lucide-react";
import { RequireSignIn } from "@/components/require-sign-in";
import { useAuthSession, type AuthSession } from "@/lib/auth";
import { MyRoundsList } from "@/components/my-rounds-list";
import { MyTripsList } from "@/components/my-trips-list";
import { SoloRoundModal } from "@/components/solo-round-modal";
import { ConnectionsList } from "@/components/connections-list";
import { roundPath } from "@/lib/round-nav";

type Tab = "rounds" | "trips" | "connections";

const BRASS = "hsl(42 52% 59%)";
const BRASS_FAINT = "hsl(42 25% 60%)";

export default function MyGolfPage() {
  const session = useAuthSession();
  if (!session) {
    return <RequireSignIn mandatory>{null}</RequireSignIn>;
  }
  return <MyGolfContent session={session} />;
}

function MyGolfContent({ session }: Readonly<{ session: AuthSession }>) {
  const [, navigate] = useLocation();
  // wouter's `useLocation` returns only the pathname, so read the query string
  // reactively via `useSearch` (otherwise the active tab never updates on click).
  const search = useSearch();
  const tab: Tab = useMemo(() => {
    const t = new URLSearchParams(search).get("tab");
    return t === "trips" ? "trips" : t === "connections" ? "connections" : "rounds";
  }, [search]);
  const [logRoundOpen, setLogRoundOpen] = useState(false);

  function setTab(next: Tab) {
    navigate(next === "rounds" ? "/my-golf" : `/my-golf?tab=${next}`, { replace: true });
  }

  function handlePrimaryCTA() {
    if (tab === "rounds") setLogRoundOpen(true);
    else if (tab === "trips") navigate("/trips/new");
    // connections tab has no primary CTA in this task
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="px-6 pt-10 pb-0" style={{ background: "hsl(158 65% 9%)" }}>
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
              <h1 className="text-3xl font-serif" style={{ color: BRASS }}>My Golf</h1>
              <p className="text-sm font-sans mt-1" style={{ color: BRASS_FAINT }}>Your rounds and trips.</p>
            </div>
            {/* Connections has its own purpose-built invite affordances; no generic "+" CTA there. */}
            {tab !== "connections" && (
              <button
                onClick={handlePrimaryCTA}
                aria-label={tab === "rounds" ? "Log a round" : "Start a new trip"}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full font-sans text-xs font-semibold uppercase tracking-wider transition-opacity hover:opacity-90 active:opacity-80"
                style={{
                  background: BRASS,
                  color: "hsl(38 30% 12%)",
                  boxShadow: "0 1px 0 hsl(42 60% 48%) inset, 0 8px 18px -8px hsla(42, 60%, 50%, 0.55)",
                  letterSpacing: "0.12em",
                }}
              >
                <Plus size={14} strokeWidth={2.25} />
                {tab === "rounds" ? "Log round" : "New trip"}
              </button>
            )}
          </div>
          <div className="flex gap-5 mt-6 -mb-px">
            <TabButton active={tab === "rounds"} onClick={() => setTab("rounds")}>Rounds</TabButton>
            <TabButton active={tab === "trips"} onClick={() => setTab("trips")}>Trips</TabButton>
            <TabButton active={tab === "connections"} onClick={() => setTab("connections")}>Connections</TabButton>
          </div>
        </div>
      </div>

      <div className="max-w-lg mx-auto" style={{ background: "hsl(38 40% 96%)" }}>
        {tab === "rounds" ? <MyRoundsList /> : tab === "connections" ? <ConnectionsList /> : (
          <div className="px-6 py-6">
            <MyTripsList session={session} />
          </div>
        )}
      </div>

      <SoloRoundModal
        open={logRoundOpen}
        onClose={() => setLogRoundOpen(false)}
        onCreated={({ tripId, roundId }) => navigate(roundPath(tripId, roundId))}
      />
    </div>
  );
}

function TabButton({ active, onClick, children }: Readonly<{ active: boolean; onClick: () => void; children: React.ReactNode }>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] pb-3"
      style={{
        color: active ? BRASS : "hsl(42 25% 55%)",
        borderBottom: active ? `2px solid ${BRASS}` : "2px solid transparent",
      }}
    >
      {children}
    </button>
  );
}
