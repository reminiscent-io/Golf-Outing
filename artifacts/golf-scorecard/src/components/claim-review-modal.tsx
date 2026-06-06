import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMyClaimable, getListMyClaimableQueryKey, useSubmitClaims,
  getListMyConnectionsQueryKey,
} from "@workspace/api-client-react";
import { useAuthSession } from "@/lib/auth";

const NAV_BG = "hsl(158 65% 9%)";
const BRASS = "hsl(42 52% 59%)";
const CREAM = "hsl(42 45% 88%)";

export function ClaimReviewModal() {
  const session = useAuthSession();
  const qc = useQueryClient();
  const submit = useSubmitClaims();
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: claimable } = useListMyClaimable({
    query: { queryKey: getListMyClaimableQueryKey(), enabled: !!session },
  });

  const items = claimable ?? [];
  if (!session || dismissed || items.length === 0) return null;

  function resolve(accepts: number[], declines: number[]) {
    setError(null);
    submit.mutate({ data: { accepts, declines } }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListMyClaimableQueryKey() });
        qc.invalidateQueries({ queryKey: getListMyConnectionsQueryKey() });
        setDismissed(true);
      },
      onError: () => setError("Couldn't update right now — please try again."),
    });
  }

  const allIds = items.map(i => i.playerId);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center p-4" style={{ background: "hsla(158,40%,6%,0.7)" }}>
      <div role="dialog" aria-modal="true" aria-labelledby="claim-review-title"
           className="w-full max-w-md rounded-xl p-6" style={{ background: NAV_BG, border: "1px solid hsl(158 40% 18%)" }}>
        <h2 id="claim-review-title" className="font-serif text-xl" style={{ color: BRASS }}>You were tagged in {items.length} round{items.length === 1 ? "" : "s"}</h2>
        <p className="text-sm font-sans mt-1 mb-4" style={{ color: CREAM }}>Claim your scores so they show up on your profile.</p>
        <ul className="space-y-2 mb-5 max-h-64 overflow-auto">
          {items.map(i => (
            <li key={i.playerId} className="text-sm font-sans" style={{ color: CREAM }}>
              <span className="font-semibold">{i.rounds[0]?.name ?? i.name}</span>
              {i.tripName ? <span style={{ color: BRASS }}> · {i.tripName}</span> : null}
              {i.taggedBy ? <span className="block text-xs" style={{ color: "hsl(42 25% 65%)" }}>tagged by {i.taggedBy}</span> : null}
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <button type="button" disabled={submit.isPending} onClick={() => resolve(allIds, [])}
                  className="flex-1 rounded-full py-2.5 text-xs font-sans font-semibold uppercase tracking-wider disabled:opacity-60"
                  style={{ background: BRASS, color: "hsl(38 30% 12%)" }}>{submit.isPending ? "Claiming…" : "Claim all"}</button>
          <button type="button" disabled={submit.isPending} onClick={() => resolve([], allIds)}
                  className="rounded-full px-4 py-2.5 text-xs font-sans uppercase tracking-wider disabled:opacity-60"
                  style={{ color: CREAM, border: "1px solid hsl(158 40% 25%)" }}>Not me</button>
        </div>
        {error ? <p className="mt-3 text-xs font-sans" style={{ color: "hsl(8 60% 65%)" }}>{error}</p> : null}
      </div>
    </div>
  );
}
