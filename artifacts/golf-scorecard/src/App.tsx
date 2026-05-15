import { useEffect, useState } from "react";
import { Switch, Route, Router as WouterRouter, useParams, Link } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import LandingPage from "@/pages/landing";
import TripsPage from "@/pages/trips";
import TripHubPage from "@/pages/trip-hub";
import RoundPage from "@/pages/round";
import PrivacyPage from "@/pages/privacy";
import MyTripsPage from "@/pages/my-trips";
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

function NavBar() {
  const session = useAuthSession();
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <div
      className="w-full flex items-center justify-end gap-3 px-4 py-2"
      style={{ background: "hsl(158 65% 9%)", borderBottom: "1px solid hsl(158 40% 18%)" }}
    >
      {session ? (
        <>
          <span className="text-xs font-sans" style={{ color: "hsl(42 25% 60%)" }}>
            {session.user.fullName}
          </span>
          <Link
            href="/me/trips"
            className="text-xs font-sans underline hover:opacity-80"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            My Trips
          </Link>
          <button
            onClick={() => clearSession()}
            className="text-xs font-sans underline hover:opacity-80"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            Sign out
          </button>
        </>
      ) : (
        <>
          <button
            onClick={() => setSignInOpen(true)}
            className="text-xs font-sans underline hover:opacity-80"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            Sign in / Sign up
          </button>
          <SignInModal
            open={signInOpen}
            onClose={() => setSignInOpen(false)}
            onSignedIn={() => setSignInOpen(false)}
          />
        </>
      )}
    </div>
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
