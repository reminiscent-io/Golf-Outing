import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTrips,
  useCreateTrip,
  useDeleteTrip,
  useListMyTrips,
  useSaveTrip,
  useUnsaveTrip,
  getListTripsQueryKey,
  getListMyTripsQueryKey,
} from "@workspace/api-client-react";
import { Plus, Flag, Trash2, ChevronRight, Trophy, Bookmark, BookmarkCheck } from "lucide-react";
import { useAuthSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";
import { DeleteTripDialog } from "@/components/delete-trip-dialog";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";

export default function TripsPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const session = useAuthSession();
  const { toast } = useToast();
  const { data: trips, isLoading } = useListTrips();
  const createTrip = useCreateTrip();
  const deleteTrip = useDeleteTrip();
  const [showCreate, setShowCreate] = useState(false);
  const [tripName, setTripName] = useState("");
  const [signInOpen, setSignInOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

  // My-trips data lets us mark each card as already-saved or already-linked
  // via a player record. Lookup is by trip id, value is the `via` field.
  const { data: myTrips } = useListMyTrips({
    query: { queryKey: getListMyTripsQueryKey(), enabled: !!session },
  });
  const myTripsByTripId = new Map(
    (myTrips ?? []).map(item => [item.trip.id, item.via] as const)
  );
  const saveTrip = useSaveTrip();
  const unsaveTrip = useUnsaveTrip();

  function handleSaveToggle(tripId: number, tripName: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!session) {
      setSignInOpen(true);
      return;
    }
    const via = myTripsByTripId.get(tripId);
    const isSaved = via === "saved" || via === "both";
    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() });

    if (isSaved) {
      unsaveTrip.mutate(
        { tripId },
        {
          onSuccess: () => {
            invalidate();
            toast({ description: `Removed "${tripName}" from My Trips` });
          },
          onError: () => {
            toast({
              variant: "destructive",
              description: "Couldn't remove that trip. Try again?",
            });
          },
        }
      );
    } else {
      saveTrip.mutate(
        { tripId },
        {
          onSuccess: () => {
            invalidate();
            toast({
              description: `Saved "${tripName}" to My Trips`,
              action: (
                <ToastAction altText="View My Trips" onClick={() => navigate("/me/trips")}>
                  View
                </ToastAction>
              ),
            });
          },
          onError: () => {
            toast({
              variant: "destructive",
              description: "Couldn't save that trip. Try again?",
            });
          },
        }
      );
    }
  }

  // Auto-open the create form when arriving with ?new=1 (e.g. from the empty
  // state on /me/trips). If the visitor isn't signed in, surface the sign-in
  // modal instead — the existing onSignedIn handler will then flip showCreate.
  useEffect(() => {
    const params = new URLSearchParams(globalThis.location.search);
    if (params.get("new") !== "1") return;
    if (session) {
      setShowCreate(true);
    } else {
      setSignInOpen(true);
    }
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("new");
    globalThis.history.replaceState({}, "", url.toString());
  }, []);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tripName.trim()) return;
    createTrip.mutate(
      { data: { name: tripName.trim() } },
      {
        onSuccess: (trip) => {
          queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
          setShowCreate(false);
          setTripName("");
          navigate(`/trips/${trip.id}`);
        },
      }
    );
  }

  function handleDeleteClick(trip: { id: number; name: string }, e: React.MouseEvent) {
    e.stopPropagation();
    setDeleteTarget(trip);
  }

  function handleDeleteConfirm(id: number) {
    deleteTrip.mutate(
      { tripId: id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListTripsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() });
          setDeleteTarget(null);
          toast({ description: "Trip deleted" });
        },
        onError: () => {
          toast({
            variant: "destructive",
            description: "Couldn't delete that trip. Try again?",
          });
        },
      }
    );
  }

  function handleNewTripClick() {
    if (!session) {
      setSignInOpen(true);
      return;
    }
    setShowCreate(true);
  }

  return (
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <Trophy className="text-primary" size={28} strokeWidth={1.5} />
            <h1 className="text-3xl font-serif text-primary">Golf Trips</h1>
          </div>
          <p className="text-sm font-sans" style={{ color: "hsl(42 25% 60%)" }}>
            Live scoring for your group
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        {/* Create button */}
        {!showCreate && (
          <button
            onClick={handleNewTripClick}
            className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-sans font-semibold text-sm mb-6 transition-all hover:opacity-90 active:scale-98"
            style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
          >
            <Plus size={18} />
            New Golf Trip
          </button>
        )}

        {/* Create form — only visible when signed in */}
        {showCreate && session && (
          <form onSubmit={handleCreate} className="mb-6 rounded-xl p-4" style={{ background: "hsl(42 45% 91%)" }}>
            <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2" style={{ color: "hsl(38 20% 38%)" }}>
              Trip Name
            </label>
            <input
              autoFocus
              value={tripName}
              onChange={e => setTripName(e.target.value)}
              placeholder="The Family Cup 2025..."
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-3"
              style={{
                background: "white",
                color: "hsl(38 30% 14%)",
                border: "1.5px solid hsl(38 25% 72%)",
              }}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={createTrip.isPending}
                className="flex-1 py-2.5 rounded-lg font-sans font-semibold text-sm transition-all hover:opacity-90"
                style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
              >
                {createTrip.isPending ? "Creating..." : "Create Trip"}
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="px-4 py-2.5 rounded-lg font-sans text-sm"
                style={{ background: "hsl(42 20% 82%)", color: "hsl(38 30% 18%)" }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <SignInModal
          open={signInOpen}
          onClose={() => setSignInOpen(false)}
          onSignedIn={() => { setSignInOpen(false); setShowCreate(true); }}
          title="Sign in to create a trip"
        />

        {/* Trips list */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "hsl(158 40% 15%)" }} />
            ))}
          </div>
        ) : trips && trips.length > 0 ? (
          <div className="space-y-3">
            {trips.map(trip => {
              const via = myTripsByTripId.get(trip.id);
              const hasPlayer = via === "player" || via === "both";
              const isSaved = via === "saved" || via === "both";
              const showSave = !!session && !hasPlayer;
              return (
                <div
                  key={trip.id}
                  onClick={() => navigate(`/trips/${trip.id}`)}
                  className="rounded-xl px-5 py-4 cursor-pointer flex items-center justify-between transition-all hover:scale-[1.01]"
                  style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg p-2" style={{ background: "hsl(158 35% 20%)" }}>
                      <Flag size={16} style={{ color: "hsl(42 52% 59%)" }} />
                    </div>
                    <div>
                      <div className="font-sans font-semibold text-sm" style={{ color: "hsl(38 30% 14%)" }}>
                        {trip.name}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: "hsl(38 20% 38%)" }}>
                        {new Date(trip.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {showSave && (
                      <button
                        onClick={e => handleSaveToggle(trip.id, trip.name, e)}
                        disabled={saveTrip.isPending || unsaveTrip.isPending}
                        aria-label={isSaved ? "Remove from My Trips" : "Save to My Trips"}
                        aria-pressed={isSaved}
                        className="inline-flex items-center gap-1.5 px-2.5 py-2 min-h-[44px] rounded-lg text-xs font-sans font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
                        style={{
                          background: isSaved ? "hsl(42 52% 59%)" : "hsl(158 35% 20%)",
                          color: isSaved ? "hsl(38 30% 12%)" : "hsl(42 52% 59%)",
                        }}
                      >
                        {isSaved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />}
                        <span>{isSaved ? "Saved" : "Save"}</span>
                      </button>
                    )}
                    <button
                      onClick={e => handleDeleteClick({ id: trip.id, name: trip.name }, e)}
                      aria-label={`Delete ${trip.name}`}
                      className="p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg transition-opacity opacity-70 hover:opacity-100"
                      style={{ color: "hsl(0 50% 35%)" }}
                    >
                      <Trash2 size={16} />
                    </button>
                    <ChevronRight size={18} style={{ color: "hsl(38 20% 50%)" }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-12 h-12 mx-auto mb-4 rounded-full opacity-30 flex items-center justify-center" style={{ background: "hsl(158 40% 20%)" }}>
              <Flag size={20} style={{ color: "hsl(42 52% 59%)" }} />
            </div>
            <p className="font-sans text-sm" style={{ color: "hsl(42 25% 60%)" }}>
              No trips yet. Create your first one above.
            </p>
          </div>
        )}

        <div className="mt-10 pt-6 text-center" style={{ borderTop: "1px solid hsl(158 30% 18%)" }}>
          <Link
            href="/privacy"
            className="text-xs font-sans hover:underline"
            style={{ color: "hsl(42 25% 60%)" }}
          >
            Privacy Policy & Terms
          </Link>
          <p className="text-xs font-sans mt-2" style={{ color: "hsl(42 18% 45%)" }}>
            © Reminiscent Technologies LLC
          </p>
        </div>

        <DeleteTripDialog
          trip={deleteTarget}
          pending={deleteTrip.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteConfirm}
        />
      </div>
    </div>
  );
}
