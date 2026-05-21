import { useGetUserProfile, useFollowUser, useUnfollowUser, getGetUserProfileQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, UserPlus, UserMinus } from "lucide-react";
import { useLocation } from "wouter";
import { FeedCard } from "@/components/feed-card";

export default function UserProfilePage({ userId }: { userId: number }) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data, isLoading } = useGetUserProfile(userId);
  const follow = useFollowUser();
  const unfollow = useUnfollowUser();

  if (isLoading || !data) {
    return <div className="min-h-dvh bg-background grid place-items-center"><div className="text-sm font-sans text-muted-foreground">Loading…</div></div>;
  }

  const isPrivate = data.profileVisibility === "private" && !data.viewerRelation.isSelf;

  function toggleFollow() {
    const mutate = data.viewerRelation.isFollowing ? unfollow.mutate : follow.mutate;
    mutate({ userId }, { onSettled: () => qc.invalidateQueries({ queryKey: getGetUserProfileQueryKey(userId) }) });
  }

  return (
    <div className="min-h-dvh bg-background">
      <header className="px-6 pt-8 pb-5 bg-sidebar">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate("/")} className="text-xs font-sans mb-3 flex items-center gap-1.5" style={{ color: "hsl(var(--brass-muted))" }}>
            <ArrowLeft size={14} /> Back
          </button>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-serif text-primary">{data.fullName}</h1>
              {!isPrivate && data.handicap != null && (
                <p className="text-sm font-sans mt-1 text-[hsl(var(--brass-faint))]">Handicap {data.handicap.toFixed(1)}</p>
              )}
            </div>
            {!data.viewerRelation.isSelf && !isPrivate && (
              <button
                type="button"
                onClick={toggleFollow}
                aria-pressed={data.viewerRelation.isFollowing}
                className="px-4 py-2 rounded-full text-[11px] font-sans font-semibold uppercase tracking-[0.18em]"
                style={{
                  background: data.viewerRelation.isFollowing ? "transparent" : "hsl(var(--primary))",
                  color: data.viewerRelation.isFollowing ? "hsl(var(--brass-muted))" : "hsl(var(--primary-foreground))",
                  border: data.viewerRelation.isFollowing ? "1px solid hsla(42,52%,59%,0.45)" : "none",
                }}
              >
                {data.viewerRelation.isFollowing ? <><UserMinus size={12} className="inline mr-1" />Following</> : <><UserPlus size={12} className="inline mr-1" />Follow</>}
              </button>
            )}
          </div>
          {!isPrivate && (
            <div className="flex gap-5 mt-3 text-xs font-sans text-[hsl(var(--brass-faint))]">
              <span><strong className="text-[hsl(var(--brass-muted))]">{data.followerCount}</strong> followers</span>
              <span><strong className="text-[hsl(var(--brass-muted))]">{data.followingCount}</strong> following</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-6 space-y-3">
        {isPrivate ? (
          <p className="text-sm font-sans text-muted-foreground text-center py-12">This profile is private.</p>
        ) : (
          <>
            {data.stats && (
              <div className="rounded-2xl bg-card border border-card-border px-5 py-4 grid grid-cols-3 gap-3 text-center">
                <Stat label="Rounds" value={String(data.stats.roundsPlayed)} />
                <Stat label="Courses" value={String(data.stats.coursesPlayed)} />
                <Stat label="Best net" value={data.stats.bestNet == null ? "—" : String(data.stats.bestNet)} />
              </div>
            )}
            {(data.recentRounds ?? []).length > 0 ? (
              <div className="space-y-3">
                {(data.recentRounds ?? []).map(item => <FeedCard key={item.roundId} item={item} />)}
              </div>
            ) : (
              <p className="text-sm font-sans text-muted-foreground text-center py-12">No public rounds yet.</p>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-serif text-lg font-semibold tabular-nums text-card-foreground">{value}</div>
      <div className="font-sans text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}
