import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTrip,
  getListMyTripsQueryKey,
} from "@workspace/api-client-react";
import { ArrowLeft, Trophy } from "lucide-react";
import { useAuthSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";
import { goBackOr } from "@/lib/back-nav";

function defaultRoundName(): string {
  return new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function NewTripPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const createTrip = useCreateTrip();
  const [tripName, setTripName] = useState(defaultRoundName());
  const [signInOpen, setSignInOpen] = useState(!session);

  useEffect(() => {
    if (!session) setSignInOpen(true);
  }, [session]);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!session) { setSignInOpen(true); return; }
    if (!tripName.trim()) return;
    createTrip.mutate(
      { data: { name: tripName.trim() } },
      {
        onSuccess: (trip) => {
          queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() });
          navigate(`/trips/${trip.id}`);
        },
      }
    );
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => goBackOr("/me/trips", navigate)}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            Back
          </button>
          <div className="flex items-center gap-3 mb-1">
            <Trophy className="text-primary" size={28} strokeWidth={1.5} />
            <h1 className="text-3xl font-serif text-primary">New Trip</h1>
          </div>
          <p className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>
            Name your trip — you'll add players inside.
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {session && (
          <form
            onSubmit={handleCreate}
            className="rounded-xl p-4"
            style={{ background: "hsl(42 45% 91%)" }}
          >
            <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Trip Name
            </label>
            <input
              autoFocus
              value={tripName}
              onChange={e => setTripName(e.target.value)}
              onFocus={e => e.currentTarget.select()}
              placeholder="The Family Cup 2025..."
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{
                background: "white",
                color: "hsl(38 30% 14%)",
                border: "1.5px solid hsl(38 25% 72%)",
              }}
            />
            <button
              type="submit"
              disabled={createTrip.isPending || !tripName.trim()}
              className="w-full py-2.5 rounded-lg font-sans font-semibold text-sm transition-all hover:opacity-90 disabled:opacity-50"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {createTrip.isPending ? "Creating..." : "Create Trip"}
            </button>
          </form>
        )}

        <SignInModal
          open={signInOpen}
          onClose={() => navigate("/")}
          onSignedIn={() => setSignInOpen(false)}
          title="Sign in to create a trip"
        />
      </div>
    </div>
  );
}
