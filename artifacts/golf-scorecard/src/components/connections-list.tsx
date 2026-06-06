import { Link } from "wouter";
import { useListMyConnections, getListMyConnectionsQueryKey } from "@workspace/api-client-react";

const BRASS = "hsl(42 52% 59%)";
const FAINT = "hsl(42 25% 55%)";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "·";
}

export function ConnectionsList() {
  const { data, isLoading } = useListMyConnections({
    query: { queryKey: getListMyConnectionsQueryKey() },
  });

  if (isLoading) {
    return <div className="px-6 py-10 text-sm font-sans" style={{ color: FAINT }}>Loading…</div>;
  }
  const accounts = data?.accounts ?? [];
  const pending = data?.pending ?? [];
  if (accounts.length === 0 && pending.length === 0) {
    return (
      <div className="px-6 py-10 text-sm font-sans" style={{ color: FAINT }}>
        No connections yet. Players you tag in rounds show up here — invite them to claim their scores.
      </div>
    );
  }

  return (
    <div className="px-6 py-6 space-y-8">
      {accounts.length > 0 && (
        <section>
          <h2 className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: FAINT }}>On the app</h2>
          <ul className="space-y-2">
            {accounts.map(a => (
              <li key={`user:${a.userId}`}>
                <Link href={`/users/${a.userId}`} className="flex items-center gap-3 py-2">
                  <span className="grid place-items-center h-9 w-9 rounded-full text-xs font-semibold"
                        style={{ background: "hsl(158 35% 20%)", color: BRASS }}>{initials(a.name)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-serif text-[15px] truncate" style={{ color: "hsl(158 30% 18%)" }}>{a.name}</span>
                    <span className="block text-xs font-sans" style={{ color: FAINT }}>{a.sharedRounds} round{a.sharedRounds === 1 ? "" : "s"} together</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section>
          <h2 className="text-[11px] font-sans font-semibold uppercase tracking-[0.18em] mb-3" style={{ color: FAINT }}>Not on the app yet</h2>
          <ul className="space-y-2">
            {pending.map(p => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <span className="grid place-items-center h-9 w-9 rounded-full text-xs font-semibold"
                      style={{ background: "hsl(42 20% 86%)", color: "hsl(42 30% 38%)" }}>{initials(p.name)}</span>
                <span className="flex-1 min-w-0">
                  <span className="block font-serif text-[15px] truncate" style={{ color: "hsl(158 30% 18%)" }}>{p.name}</span>
                  <span className="block text-xs font-sans" style={{ color: FAINT }}>{p.sharedRounds} round{p.sharedRounds === 1 ? "" : "s"} together</span>
                </span>
                {/* Invite affordances added in a later task */}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
