import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useParams, useLocation, Link } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Flag, LogOut } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import TripsPage from "@/pages/trips";
import TripHubPage from "@/pages/trip-hub";
import RoundPage from "@/pages/round";
import PrivacyPage from "@/pages/privacy";
import MyTripsPage from "@/pages/my-trips";
import ProfilePage from "@/pages/profile";
import { TripAuthGate } from "@/components/trip-auth-gate";
import { useAuthSession, clearSession, maybeRefreshSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5000,
      retry: 1,
    },
  },
});

function GatedTripHub() {
  const { tripId } = useParams<{ tripId: string }>();
  const id = Number(tripId);
  if (!id) return <NotFound />;
  return (
    <TripAuthGate tripId={id}>
      <TripHubPage />
    </TripAuthGate>
  );
}

function GatedRound() {
  const { tripId } = useParams<{ tripId: string; roundId: string }>();
  const id = Number(tripId);
  if (!id) return <NotFound />;
  return (
    <TripAuthGate tripId={id}>
      <RoundPage />
    </TripAuthGate>
  );
}

const BRASS = "hsl(42 52% 59%)";
const BRASS_MUTED = "hsl(42 35% 65%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const CREAM_FG = "hsl(42 45% 88%)";
const NAV_BG = "hsl(158 65% 9%)";
const NAV_BORDER = "hsl(158 40% 18%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";

function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "·";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts.at(-1)?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase();
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  const space = trimmed.indexOf(" ");
  return space === -1 ? trimmed : trimmed.slice(0, space);
}

function NavBar() {
  const session = useAuthSession();
  const [location] = useLocation();
  const [signInOpen, setSignInOpen] = useState(false);

  const isMyTrips = location === "/me/trips";

  return (
    <header
      aria-label="Primary"
      className="w-full pt-safe pl-safe pr-safe"
      style={{ background: NAV_BG, borderBottom: `1px solid ${NAV_BORDER}` }}
    >
      <div className="mx-auto flex h-12 items-center justify-between gap-3 px-3 sm:px-4">
        {/* Brand — anchored home */}
        <Link
          href="/"
          aria-label="Scorecard, home"
          className="group inline-flex h-10 items-center gap-2 -ml-1 px-2 rounded-md hover-elevate active-elevate transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(42_52%_59%)]"
          style={{ color: BRASS }}
        >
          <Flag size={14} strokeWidth={2} aria-hidden />
          <span
            className="font-serif italic text-[15px] leading-none"
            style={{ letterSpacing: "0.005em" }}
          >
            Scorecard
          </span>
        </Link>

        {/* Right cluster */}
        <div className="flex items-center gap-1">
          {session ? (
            <>
              {/* Primary nav: My Trips with active state */}
              <Link
                href="/me/trips"
                aria-current={isMyTrips ? "page" : undefined}
                className="relative inline-flex h-10 items-center px-2.5 rounded-md font-sans text-[11px] font-semibold uppercase hover-elevate active-elevate transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(42_52%_59%)]"
                style={{
                  color: isMyTrips ? BRASS : BRASS_MUTED,
                  letterSpacing: "0.18em",
                }}
              >
                My Trips
                {isMyTrips && (
                  <span
                    aria-hidden
                    className="absolute left-2.5 right-2.5 -bottom-px h-px rounded-full"
                    style={{ background: BRASS }}
                  />
                )}
              </Link>

              {/* Divider */}
              <span
                aria-hidden
                className="mx-1 h-5 w-px"
                style={{ background: NAV_BORDER }}
              />

              {/* Identity — links to profile */}
              <Link
                href="/profile"
                aria-label="Profile"
                title={session.user.fullName}
                className="inline-flex h-10 items-center gap-2 px-1.5 rounded-md hover-elevate active-elevate transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(42_52%_59%)]"
              >
                <span
                  aria-hidden
                  className="inline-flex items-center justify-center h-6 w-6 rounded-full font-serif text-[10px] font-semibold tabular-nums"
                  style={{
                    background: FOREST_ACCENT,
                    color: BRASS,
                    border: `1px solid hsla(42, 52%, 59%, 0.35)`,
                    letterSpacing: "0.02em",
                  }}
                >
                  {initials(session.user.fullName)}
                </span>
                <span
                  className="font-sans text-xs truncate max-w-[7rem] hidden sm:inline"
                  style={{ color: CREAM_FG }}
                >
                  {firstName(session.user.fullName)}
                </span>
              </Link>

              {/* Sign out — icon button */}
              <button
                type="button"
                onClick={() => clearSession()}
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover-elevate active-elevate transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(42_52%_59%)]"
                style={{ color: BRASS_FAINT }}
              >
                <LogOut size={15} strokeWidth={1.75} aria-hidden />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setSignInOpen(true)}
                className="inline-flex h-9 items-center rounded-full px-3.5 font-sans text-[11px] font-semibold uppercase transition-colors hover-elevate active-elevate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(42_52%_59%)]"
                style={{
                  background: "transparent",
                  color: BRASS,
                  border: `1px solid hsla(42, 52%, 59%, 0.45)`,
                  letterSpacing: "0.18em",
                }}
              >
                Sign in
              </button>
              <SignInModal
                open={signInOpen}
                onClose={() => setSignInOpen(false)}
                onSignedIn={() => setSignInOpen(false)}
              />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function Router() {
  return (
    <>
      <NavBar />
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/trips" component={TripsPage} />
        <Route path="/privacy" component={PrivacyPage} />
        <Route path="/me/trips" component={MyTripsPage} />
        <Route path="/profile" component={ProfilePage} />
        <Route path="/trips/:tripId" component={GatedTripHub} />
        <Route path="/trips/:tripId/rounds/:roundId" component={GatedRound} />
        <Route component={NotFound} />
      </Switch>
    </>
  );
}

function App() {
  useEffect(() => {
    void maybeRefreshSession();
  }, []);
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
