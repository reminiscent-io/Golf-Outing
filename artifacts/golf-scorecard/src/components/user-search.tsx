import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useSearchUsers, getSearchUsersQueryKey } from "@workspace/api-client-react";
import { Search } from "lucide-react";

const DEBOUNCE_MS = 200;

export function UserSearchBar() {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    globalThis.addEventListener("mousedown", onDown);
    return () => globalThis.removeEventListener("mousedown", onDown);
  }, []);

  const params = { q: debounced, limit: 20 };
  const { data: results } = useSearchUsers(params, {
    query: { queryKey: getSearchUsersQueryKey(params), enabled: debounced.length > 0 },
  });

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 px-3 h-10 rounded-full" style={{ background: "hsl(var(--accent))", border: "1px solid hsl(var(--card-border))" }}>
        <Search size={14} aria-hidden style={{ color: "hsl(var(--muted-foreground))" }} />
        <input
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search golfers…"
          className="flex-1 bg-transparent text-sm font-sans outline-none"
        />
      </div>
      {open && debounced.length > 0 && (
        <div className="absolute z-40 mt-2 w-full rounded-lg overflow-hidden" style={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--card-border))", boxShadow: "0 10px 24px -8px rgba(0,0,0,0.18)" }}>
          {(results ?? []).length === 0 ? (
            <div className="px-4 py-3 text-xs font-sans" style={{ color: "hsl(var(--muted-foreground))" }}>No matches</div>
          ) : (
            (results ?? []).map(u => (
              <button
                key={u.id}
                type="button"
                onClick={() => { setOpen(false); setQ(""); navigate(`/users/${u.id}`); }}
                className="w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-accent transition-colors"
              >
                <span className="font-sans text-sm text-card-foreground">{u.fullName}</span>
                <span className="font-sans text-xs tabular-nums text-muted-foreground">
                  {u.handicap == null ? "—" : `hcp ${u.handicap.toFixed(1)}`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
