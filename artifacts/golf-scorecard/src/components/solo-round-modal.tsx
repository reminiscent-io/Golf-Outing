import { useEffect, useState } from "react";
import { useCreateRoundV2 } from "@workspace/api-client-react";
import { X } from "lucide-react";
import { CourseSearchField } from "@/components/course-search-field";
import { TripPicker } from "@/components/trip-picker";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (ids: { tripId: number | null; roundId: number; playerId: number }) => void;
};

export function SoloRoundModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const [tripId, setTripId] = useState<number | null>(null);
  const [teeBox, setTeeBox] = useState<string | null>(null);
  const [courseRating, setCourseRating] = useState<number | null>(null);
  const [courseSlope, setCourseSlope] = useState<number | null>(null);
  const [par, setPar] = useState<number[] | null>(null);
  const [holeHcp, setHoleHcp] = useState<number[] | null>(null);
  const create = useCreateRoundV2();
  // Don't let a stray tap or keypress dismiss the sheet while the round is
  // being created — the request would still land, leaving a round the user
  // thinks they cancelled.
  const busy = create.isPending;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  function reset() {
    setName("");
    setCourse("");
    setTripId(null);
    setTeeBox(null);
    setCourseRating(null);
    setCourseSlope(null);
    setPar(null);
    setHoleHcp(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c = course.trim();
    const n = name.trim() || (c || "New round");
    create.mutate(
      {
        data: {
          tripId,
          name: n,
          course: c || null,
          teeBox,
          courseRating,
          courseSlope,
          ...(par ? { par } : {}),
          ...(holeHcp ? { holeHcp } : {}),
        },
      },
      {
        onSuccess: (resp) => {
          onCreated({ tripId: resp.tripId ?? null, roundId: resp.roundId, playerId: resp.playerId });
          onClose();
          reset();
        },
      }
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={() => { if (!busy) onClose(); }}
    >
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="solo-round-title"
        className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-card p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="solo-round-title" className="font-serif text-lg text-card-foreground">Log a round</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="-m-2 p-2 rounded-full text-muted-foreground transition-colors hover:text-card-foreground disabled:opacity-40"
          >
            <X size={20} />
          </button>
        </div>
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Course</label>
        <div className="mb-3">
          <CourseSearchField
            autoFocus
            placeholder="Search for a club or course…"
            onCourseSelected={(detail) => setCourse(detail.clubName)}
            onTeeApplied={(tee, detail) => {
              setCourse(detail.clubName);
              setTeeBox(tee.name);
              setCourseRating(tee.rating);
              setCourseSlope(tee.slope);
              setPar(tee.par);
              setHoleHcp(tee.holeHcp);
            }}
            onCleared={() => {
              setCourse("");
              setTeeBox(null);
              setCourseRating(null);
              setCourseSlope(null);
              setPar(null);
              setHoleHcp(null);
            }}
          />
        </div>
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Course name</label>
        <input
          value={course}
          onChange={e => setCourse(e.target.value)}
          placeholder="e.g. Bethpage Black"
          className="w-full px-3 py-2.5 rounded-lg bg-popover text-card-foreground text-sm font-sans mb-4"
          style={{ border: "1.5px solid hsl(var(--input))" }}
        />
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Trip (optional)</label>
        <div className="mb-4">
          <TripPicker value={tripId} onChange={setTripId} />
        </div>
        <label className="block text-[10px] font-sans font-semibold uppercase tracking-[0.32em] text-muted-foreground mb-2">Round name (optional)</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={course.trim() ? `Defaults to "${course.trim()}"` : "Defaults to the course name"}
          className="w-full px-3 py-2.5 rounded-lg bg-popover text-card-foreground text-sm font-sans mb-5"
          style={{ border: "1.5px solid hsl(var(--input))" }}
        />
        <button
          type="submit"
          disabled={create.isPending}
          className="w-full py-3 rounded-full bg-primary text-primary-foreground font-sans font-semibold text-sm disabled:opacity-50"
        >
          {create.isPending ? "Starting…" : "Start round"}
        </button>
      </form>
    </div>
  );
}
