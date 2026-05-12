import { Switch, Route, Router as WouterRouter, useParams } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import TripsPage from "@/pages/trips";
import TripHubPage from "@/pages/trip-hub";
import RoundPage from "@/pages/round";
import PrivacyPage from "@/pages/privacy";
import { TripAuthGate } from "@/components/trip-auth-gate";

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

function Router() {
  return (
    <Switch>
      <Route path="/" component={TripsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/trips/:tripId" component={GatedTripHub} />
      <Route path="/trips/:tripId/rounds/:roundId" component={GatedRound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
