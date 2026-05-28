import { useEffect, useState } from "react";
import {
  searchCourses,
  getCourseDetail,
  type CourseSearchResult,
  type CourseDetail,
  type CourseTee,
} from "@/lib/course-lookup";

type Props = {
  /** Focus the search input on mount. */
  autoFocus?: boolean;
  placeholder?: string;
  /** Fired once a course's detail has loaded (before a tee is chosen). */
  onCourseSelected?: (course: CourseDetail) => void;
  /** Fired when a tee is applied — either auto (single-tee course) or picked from the selector. */
  onTeeApplied: (tee: CourseTee, course: CourseDetail) => void;
  /** Fired when the user clears the current lookup. */
  onCleared: () => void;
};

/**
 * Debounced course-name autocomplete backed by `/api/course-lookup/*`.
 * Owns the transient lookup UI (query, results dropdown, selected-course chip,
 * tee selector); the parent owns the resolved fields (course name, tee box,
 * rating, slope, par, stroke index) via the callbacks. Shared by the round
 * Setup tab, the trip "New Round" form, and the solo "Log a round" modal so all
 * three behave identically.
 */
export function CourseSearchField({ autoFocus, placeholder, onCourseSelected, onTeeApplied, onCleared }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CourseSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCourse, setSelectedCourse] = useState<CourseDetail | null>(null);
  const [selectedTeeId, setSelectedTeeId] = useState<string>("");

  // Debounced autocomplete search. Runs after the user pauses typing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchCourses(q, ctrl.signal)
        .then(r => setResults(r.results))
        .catch(err => {
          if (ctrl.signal.aborted) return;
          setError(err?.message ?? "Search failed");
          setResults([]);
        })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query]);

  function applyTee(tee: CourseTee, course: CourseDetail) {
    setSelectedTeeId(tee.id);
    onTeeApplied(tee, course);
  }

  async function pickCourse(result: CourseSearchResult) {
    setResults([]);
    setQuery(result.clubName);
    setError(null);
    setLoading(true);
    try {
      const detail = await getCourseDetail(result.id);
      setSelectedCourse(detail);
      setSelectedTeeId("");
      onCourseSelected?.(detail);
      if (detail.tees.length === 1) applyTee(detail.tees[0], detail);
    } catch (err) {
      setError((err as Error)?.message ?? "Failed to load course");
    } finally {
      setLoading(false);
    }
  }

  function clearLookup() {
    setQuery("");
    setResults([]);
    setSelectedCourse(null);
    setSelectedTeeId("");
    setError(null);
    onCleared();
  }

  return (
    <div>
      <div className="relative">
        <input
          autoFocus={autoFocus}
          value={query}
          onChange={e => { setQuery(e.target.value); setSelectedCourse(null); setSelectedTeeId(""); }}
          placeholder={placeholder ?? "Start typing a club or course name…"}
          className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
          style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-sans" style={{ color: "hsl(38 20% 45%)" }}>…</span>
        )}
        {!selectedCourse && results.length > 0 && (
          <div className="absolute z-20 mt-1 w-full rounded-lg overflow-hidden max-h-60 overflow-y-auto"
            style={{ background: "white", border: "1.5px solid hsl(38 25% 72%)", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" }}>
            {results.map(r => (
              <button
                type="button"
                key={r.id}
                onClick={() => pickCourse(r)}
                className="w-full text-left px-3 py-2.5 text-sm font-sans hover:opacity-80"
                style={{ color: "hsl(38 30% 14%)", borderBottom: "1px solid hsl(38 25% 88%)" }}
              >
                <div className="font-semibold truncate">{r.clubName}{r.courseName ? ` — ${r.courseName}` : ""}</div>
                {r.location && (
                  <div className="text-xs truncate" style={{ color: "hsl(38 20% 45%)" }}>{r.location}</div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div className="text-xs font-sans mt-1" style={{ color: "hsl(0 55% 40%)" }}>{error}</div>
      )}
      {selectedCourse && (
        <div className="mt-2 rounded-lg pl-3 pr-1 py-1 flex items-center justify-between gap-2"
          style={{ background: "hsl(42 30% 86%)", border: "1px solid hsl(38 25% 78%)" }}>
          <div className="text-xs font-sans min-w-0 flex-1 py-1" style={{ color: "hsl(38 30% 14%)" }}>
            <div className="font-semibold truncate">{selectedCourse.clubName}</div>
            {selectedCourse.courseName && (
              <div className="truncate" style={{ color: "hsl(38 20% 45%)" }}>{selectedCourse.courseName}</div>
            )}
          </div>
          <button type="button" onClick={clearLookup}
            className="text-xs font-sans font-semibold uppercase tracking-wider px-3 py-2 rounded-md flex-shrink-0 hover:opacity-70"
            style={{ color: "hsl(38 25% 30%)" }}>
            Clear
          </button>
        </div>
      )}
      {selectedCourse && selectedCourse.tees.length > 0 && (
        <div className="mt-3">
          <label className="block text-xs font-sans font-semibold uppercase tracking-widest mb-1" style={{ color: "hsl(38 20% 38%)" }}>
            Tee box ({selectedCourse.tees.length})
          </label>
          <select
            value={selectedTeeId}
            onChange={e => {
              const tee = selectedCourse.tees.find(t => t.id === e.target.value);
              if (tee) applyTee(tee, selectedCourse);
            }}
            className="w-full px-3 py-2 rounded-lg text-sm font-sans outline-none"
            style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
          >
            <option value="">Select a tee…</option>
            {selectedCourse.tees.map(t => {
              const parts = [t.name];
              if (t.gender) parts.push(t.gender);
              const meta = [
                t.rating != null ? `CR ${t.rating}` : null,
                t.slope != null ? `SR ${t.slope}` : null,
                t.totalYards != null ? `${t.totalYards} yds` : null,
              ].filter(Boolean).join(" · ");
              return (
                <option key={t.id} value={t.id}>
                  {parts.join(" · ")}{meta ? ` (${meta})` : ""}
                </option>
              );
            })}
          </select>
        </div>
      )}
    </div>
  );
}
