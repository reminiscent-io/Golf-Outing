import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useGetClaimPreview, getGetClaimPreviewQueryKey, useSubmitClaims } from "@workspace/api-client-react";
import { useAuthSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";

const NAV_BG = "hsl(158 65% 9%)";
const BRASS = "hsl(42 52% 59%)";
const CREAM = "hsl(42 45% 88%)";

export default function ClaimLandingPage() {
  const { code } = useParams<{ code: string }>();
  const session = useAuthSession();
  const submit = useSubmitClaims();
  const [, navigate] = useLocation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: preview, isLoading, isError } = useGetClaimPreview(code, {
    query: { queryKey: getGetClaimPreviewQueryKey(code) },
  });

  function claim() {
    if (!preview) return;
    setError(null);
    submit.mutate({ data: { accepts: [preview.playerId], code } }, {
      onSuccess: () => { setDone(true); navigate("/my-golf?tab=connections", { replace: true }); },
      onError: () => setError("Couldn't claim right now — please try again."),
    });
  }

  return (
    <div className="min-h-dvh grid place-items-center p-6" style={{ background: NAV_BG }}>
      <div className="w-full max-w-md text-center">
        {isLoading && <p className="font-sans text-sm" style={{ color: CREAM }}>Loading…</p>}
        {isError && <p className="font-sans text-sm" style={{ color: CREAM }}>This invite is no longer valid.</p>}
        {preview && (
          <>
            <h1 className="font-serif text-2xl mb-2" style={{ color: BRASS }}>Claim {preview.name}'s scores</h1>
            <p className="font-sans text-sm mb-6" style={{ color: CREAM }}>
              {preview.rounds[0]?.name ?? "A round"}{preview.tripName ? ` · ${preview.tripName}` : ""}
              {preview.taggedBy ? ` — tagged by ${preview.taggedBy}` : ""}
            </p>
            {session ? (
              <button type="button" onClick={claim} disabled={submit.isPending || done}
                      className="rounded-full px-6 py-3 text-xs font-sans font-semibold uppercase tracking-wider disabled:opacity-60"
                      style={{ background: BRASS, color: "hsl(38 30% 12%)" }}>
                {done ? "Claimed" : submit.isPending ? "Claiming…" : "Yes, this is me"}
              </button>
            ) : (
              <SignInModal open onClose={() => navigate("/", { replace: true })}
                           onSignedIn={() => claim()} title="Sign in to claim your scores" />
            )}
            {error ? <p className="mt-3 text-xs font-sans" style={{ color: "hsl(8 60% 70%)" }}>{error}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
