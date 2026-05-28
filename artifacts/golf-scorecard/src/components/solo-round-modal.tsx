import { useState } from "react";
import { useCreateSoloRound } from "@workspace/api-client-react";
import { X } from "lucide-react";
import { CourseSearchField } from "@/components/course-search-field";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (ids: { tripId: number; roundId: number; playerId: number }) => void;
};

export function SoloRoundModal({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  // Resolved from the course lookup; submitted so net scoring works out of the box.
  const [teeBox, setTeeBox] = useState<string | null>(null);
  const [courseRating, setCourseRating] = useState<number | null>(null);
  const [courseSlope, setCourseSlope] = useState<number | null>(null);
  const [par, setPar] = useState<number[] | null>(null);
  const [holeHcp, setHoleHcp] = useState<number[] | null>(null);
  const create = useCreateSoloRound();

  if (!open) return null;

  function reset() {
    setName("");
    setCourse("");
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
          name: n,
          course: c || null,
          teeBox,
          courseRating,
          courseSlope,
          ...(par ? { par } : {}),
          ...(holeHcp ? { holeHcp } : {}),
        },
      },
      { onSuccess: (resp) => { onCreated(resp); onClose(); reset(); } }
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <form onSubmit={submit} className="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-serif text-lg text-card-foreground">Log a round</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1"><X size={18} /></button>
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
