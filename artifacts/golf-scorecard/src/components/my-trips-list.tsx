import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyTrips,
  useDeleteTrip,
  getListMyTripsQueryKey,
  type UserTripAssociation,
} from "@workspace/api-client-react";
import type { AuthSession } from "@/lib/auth";
import { Flag, ChevronRight, Plus, Trash2, Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const BRASS = "hsl(42 52% 59%)";
const BRASS_MUTED = "hsl(42 35% 70%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const CREAM = "hsl(42 45% 91%)";
const CREAM_BORDER = "hsl(38 25% 78%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";
const FOREST_HAIRLINE = "hsl(158 30% 28%)";
const DANGER = "hsl(2 62% 44%)";

export function MyTripsList({ session }: Readonly<{ session: AuthSession }>) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { data: items, isLoading } = useListMyTrips();
  const deleteTrip = useDeleteTrip();

  function handleDeleteTrip(tripId: number) {
    deleteTrip.mutate(
      { tripId },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMyTripsQueryKey() }) },
    );
  }

  const myUserId = session.user.id;
  const trips = items ?? [];
  const hasAny = trips.length > 0;

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

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-20 rounded-xl animate-pulse" style={{ background: "hsl(158 40% 15%)" }} />
        ))}
      </div>
    );
  }
  if (!hasAny) {
    return (
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
    );
  }

  return (
    <div>
      {created.length > 0 && (
        <Section label="Created">
          {created.map(item => (
            <TripRow
              key={item.trip.id}
              item={item}
              variant="primary"
              onClick={() => navigate(`/trips/${item.trip.id}`)}
              onDelete={() => handleDeleteTrip(item.trip.id)}
              deletePending={deleteTrip.isPending && deleteTrip.variables?.tripId === item.trip.id}
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
  );
}

function Section({ label, children }: Readonly<{ label: string; children: React.ReactNode }>) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="flex items-center gap-3 mb-3 px-1">
        <span className="text-[10px] font-sans font-bold uppercase" style={{ color: BRASS, letterSpacing: "0.32em" }}>
          {label}
        </span>
        <span className="flex-1 border-t border-dashed" style={{ borderColor: FOREST_HAIRLINE }} />
      </div>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

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
  onDelete,
  deletePending,
}: Readonly<{
  item: UserTripAssociation;
  variant: "primary" | "watching";
  onClick: () => void;
  onDelete?: () => void;
  deletePending?: boolean;
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
          <div className="font-serif font-medium text-[17px] leading-tight truncate" style={{ color: INK }}>
            {item.trip.name}
          </div>
          {dateLabel && (
            <div className="text-xs mt-1 truncate" style={{ color: INK_SOFT }}>
              {dateLabel}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {onDelete && (
          <DeleteTripButton tripName={item.trip.name} pending={!!deletePending} onConfirm={onDelete} />
        )}
        <ChevronRight size={18} style={{ color: "hsl(38 20% 50%)" }} />
      </div>
    </div>
  );
}

function DeleteTripButton({
  tripName,
  pending,
  onConfirm,
}: Readonly<{ tripName: string; pending: boolean; onConfirm: () => void }>) {
  const [open, setOpen] = useState(false);
  function handleConfirm(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    onConfirm();
  }
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Delete ${tripName}`}
          disabled={pending}
          onClick={(e) => e.stopPropagation()}
          className="rounded-lg p-2 transition-colors hover:bg-black/5 disabled:opacity-60"
          style={{ color: DANGER }}
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{tripName}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes the trip and everything attached to it — all rounds,
            players, scores, comments and kudos. This can&apos;t be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={(e) => e.stopPropagation()}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className="bg-[hsl(2_62%_44%)] hover:bg-[hsl(2_62%_38%)] focus-visible:ring-[hsl(2_62%_44%)]"
          >
            Delete trip
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
