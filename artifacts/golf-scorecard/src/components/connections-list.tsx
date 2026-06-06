import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyConnections, getListMyConnectionsQueryKey,
  useCreatePlayerInvite, useUpdatePlayer,
  type ConnectionPending,
} from "@workspace/api-client-react";

const BRASS = "hsl(42 52% 59%)";
const FAINT = "hsl(42 25% 60%)";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() || "·";
}

function shareUrl(code: string): string {
  const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  return `${globalThis.location.origin}${base}claim/${code}`;
}

function PendingRow({ p }: { readonly p: ConnectionPending }) {
  const qc = useQueryClient();
  const createInvite = useCreatePlayerInvite();
  const updatePlayer = useUpdatePlayer();
  const [phone, setPhone] = useState("");
  const [showPhone, setShowPhone] = useState(false);
  const playerId = p.playerIds[0];
  // The invite route is player-id-centric (ignores tripId); the phone PATCH needs the real
  // trip, which is unambiguous here because "Add phone" only shows for phone-less groups,
  // and those are grouped per-trip. Fall back to 0 only to satisfy the route's path param.
  const tripId = p.tripId ?? 0;

  async function onShare() {
    let url: string;
    try {
      const resp = await createInvite.mutateAsync({ tripId, playerId });
      url = shareUrl(resp.code);
    } catch {
      // Mint failed (e.g. the trip/player changed underneath us). TanStack Query records the
      // error state on `createInvite`; just bail rather than leak an unhandled rejection.
      return;
    }
    try {
      if (navigator.share) await navigator.share({ title: "Claim your golf scores", url });
      else if (navigator.clipboard) await navigator.clipboard.writeText(url);
    } catch { /* user cancelled the share sheet */ }
    qc.invalidateQueries({ queryKey: getListMyConnectionsQueryKey() });
  }

  function onSavePhone() {
    if (!phone.trim()) return;
    updatePlayer.mutate(
      { tripId, playerId, data: { invitedPhone: phone.trim() } },
      { onSuccess: () => { setShowPhone(false); setPhone(""); qc.invalidateQueries({ queryKey: getListMyConnectionsQueryKey() }); } },
    );
  }

  return (
    <li className="py-2">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="grid place-items-center h-9 w-9 rounded-full text-xs font-semibold"
              style={{ background: "hsl(42 20% 86%)", color: "hsl(42 30% 38%)" }}>{initials(p.name)}</span>
        <span className="flex-1 min-w-0">
          <span className="block font-serif text-[15px] truncate" style={{ color: "hsl(158 30% 18%)" }}>{p.name}</span>
          <span className="block text-xs font-sans" style={{ color: FAINT }}>
            {p.sharedRounds} round{p.sharedRounds === 1 ? "" : "s"} together{p.hasInvite ? " · invite sent" : ""}
          </span>
        </span>
        <button type="button" onClick={onShare} disabled={createInvite.isPending}
                className="text-[11px] font-sans font-semibold uppercase tracking-wider px-2 py-1 rounded-md"
                style={{ color: BRASS, border: `1px solid ${BRASS}` }}>
          {createInvite.isPending ? "…" : "Share"}
        </button>
        {!p.hasPhone && (
          <button type="button" onClick={() => setShowPhone(v => !v)}
                  className="text-[11px] font-sans px-2 py-1" style={{ color: FAINT }}>Add phone</button>
        )}
      </div>
      {showPhone && (
        <div className="flex gap-2 mt-2 pl-12">
          <input type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)}
                 aria-label={`Phone number for ${p.name}`}
                 placeholder="Their phone number"
                 className="flex-1 rounded-md border px-3 py-1.5 text-sm font-sans" style={{ borderColor: "hsl(42 20% 80%)" }} />
          <button type="button" onClick={onSavePhone} disabled={updatePlayer.isPending}
                  className="text-[11px] font-sans font-semibold uppercase tracking-wider px-2 rounded-md"
                  style={{ background: BRASS, color: "hsl(38 30% 12%)" }}>Save</button>
        </div>
      )}
    </li>
  );
}

export function ConnectionsList() {
  const { data, isLoading } = useListMyConnections({ query: { queryKey: getListMyConnectionsQueryKey() } });

  if (isLoading) return <div className="px-6 py-10 text-sm font-sans" style={{ color: FAINT }}>Loading…</div>;
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
                  <span aria-hidden="true" className="grid place-items-center h-9 w-9 rounded-full text-xs font-semibold"
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
          <ul className="space-y-1">
            {pending.map(p => (<PendingRow key={p.id} p={p} />))}
          </ul>
        </section>
      )}
    </div>
  );
}
