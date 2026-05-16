import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useUpdateMe } from "@workspace/api-client-react";
import { ArrowLeft, User as UserIcon } from "lucide-react";
import { RequireSignIn } from "@/components/require-sign-in";
import { useAuthSession, updateSessionUser } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";

function parseHandicapInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const v = parseFloat(trimmed);
  if (isNaN(v)) return null;
  return Math.round(v * 10) / 10;
}

function formatHandicap(h: number | null | undefined): string {
  if (h == null) return "";
  return (Math.round(h * 10) / 10).toFixed(1);
}

function ProfileContent() {
  const [, navigate] = useLocation();
  const session = useAuthSession();
  const { toast } = useToast();
  const updateMe = useUpdateMe();

  const [hcp, setHcp] = useState<string>(() => formatHandicap(session?.user.handicap));

  useEffect(() => {
    setHcp(formatHandicap(session?.user.handicap));
  }, [session?.user.handicap]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    const next = parseHandicapInput(hcp);
    if (next != null && (next < 0 || next > 54)) {
      toast({ description: "Handicap must be between 0 and 54", variant: "destructive" });
      return;
    }
    updateMe.mutate(
      { data: { handicap: next } },
      {
        onSuccess: (user) => {
          updateSessionUser({ handicap: user.handicap });
          toast({ description: "Handicap saved", duration: 2000 });
        },
        onError: () => {
          toast({ description: "Could not save handicap", variant: "destructive" });
        },
      }
    );
  }

  if (!session) return null;

  return (
    <div className="min-h-dvh" style={{ background: "hsl(158 60% 11%)" }}>
      <div className="px-6 pt-10 pb-6" style={{ background: "hsl(158 65% 9%)" }}>
        <div className="max-w-lg mx-auto">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-xs font-sans mb-4 transition-opacity hover:opacity-70"
            style={{ color: "hsl(42 35% 65%)" }}
          >
            <ArrowLeft size={14} />
            Home
          </button>
          <h1 className="text-3xl font-serif" style={{ color: "hsl(42 52% 59%)" }}>
            Profile
          </h1>
          <p className="text-sm font-sans mt-1" style={{ color: "hsl(42 25% 60%)" }}>
            Your handicap will autofill when you join new trips.
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-6">
        <div
          className="rounded-xl p-6"
          style={{ background: "hsl(42 45% 91%)", border: "1px solid hsl(38 25% 78%)" }}
        >
          {/* Identity block */}
          <div className="flex items-center gap-3 mb-5 pb-5" style={{ borderBottom: "1px dashed hsl(38 25% 78%)" }}>
            <div
              className="inline-flex items-center justify-center rounded-full"
              style={{
                width: 44,
                height: 44,
                background: "hsl(158 35% 20%)",
                border: "1px solid hsla(42, 52%, 59%, 0.35)",
                color: "hsl(42 52% 59%)",
              }}
            >
              <UserIcon size={20} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="font-serif text-base font-semibold" style={{ color: "hsl(38 30% 14%)" }}>
                {session.user.fullName}
              </div>
              <div className="font-sans text-xs tabular-nums" style={{ color: "hsl(38 20% 38%)" }}>
                {session.user.phone}
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <label
              htmlFor="profile-handicap"
              className="block text-xs font-sans font-semibold uppercase tracking-widest mb-2"
              style={{ color: "hsl(38 20% 38%)" }}
            >
              Handicap index
            </label>
            <input
              id="profile-handicap"
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={54}
              placeholder="e.g. 12.4"
              value={hcp}
              onChange={e => setHcp(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm font-sans outline-none mb-2"
              style={{ background: "white", color: "hsl(38 30% 14%)", border: "1.5px solid hsl(38 25% 72%)" }}
            />
            <p className="text-xs font-sans mb-5" style={{ color: "hsl(38 20% 45%)" }}>
              Decimals OK. Leave empty to clear.
            </p>

            <button
              type="submit"
              disabled={updateMe.isPending}
              className="w-full py-2.5 rounded-lg font-sans font-semibold text-sm disabled:opacity-50"
              style={{ background: "hsl(42 52% 59%)", color: "hsl(38 30% 12%)" }}
            >
              {updateMe.isPending ? "Saving…" : "Save"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <RequireSignIn modalTitle="Sign in to view your profile">
      <ProfileContent />
    </RequireSignIn>
  );
}
