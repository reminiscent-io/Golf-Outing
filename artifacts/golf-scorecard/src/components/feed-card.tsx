import { useGiveKudos, useRevokeKudos, type FeedItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Heart, MessageCircle, MapPin } from "lucide-react";

type Props = { item: FeedItem };

export function FeedCard({ item }: Props) {
  const qc = useQueryClient();
  const give = useGiveKudos();
  const revoke = useRevokeKudos();
  const [, navigate] = useLocation();

  const isLive = item.completedAt == null;
  const tripKindLabel = item.tripId == null ? "Solo round" : null;

  function toggleKudos() {
    const mutate = (item.viewerHasKudosed ? revoke.mutate : give.mutate);
    mutate(
      { roundId: item.roundId },
      {
        // The Feed page uses `useInfiniteQuery({ queryKey: ["feed", tab] })`,
        // not Orval's generated key. Match the page's key prefix so all three
        // tab caches refetch.
        onSettled: () => qc.invalidateQueries({ queryKey: ["feed"] }),
      }
    );
  }

  return (
    <article className="rounded-2xl bg-card border border-card-border px-5 py-4">
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em]"
          style={{ color: isLive ? "hsl(var(--brass-ink))" : "hsl(var(--muted-foreground))" }}
        >
          {isLive ? `Playing now · ${item.summary.holesPlayed}/${item.summary.totalHoles}` : "Final"}
        </span>
        {tripKindLabel && (
          <span className="text-[10px] font-sans uppercase tracking-[0.18em] text-muted-foreground">· {tripKindLabel}</span>
        )}
      </div>

      <button
        type="button"
        onClick={() => navigate(item.tripId == null ? `/rounds/${item.roundId}` : `/trips/${item.tripId}/rounds/${item.roundId}`)}
        className="block w-full text-left"
      >
        <h3 className="font-serif text-lg font-semibold text-card-foreground leading-tight">{item.name}</h3>
        {item.course && (
          <div className="flex items-center gap-1 mt-1 text-xs font-sans text-muted-foreground">
            <MapPin size={12} aria-hidden />
            {item.course}
          </div>
        )}
      </button>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs font-sans">
        {item.players.map(p => (
          p.userId ? (
            <Link key={p.playerId} href={`/users/${p.userId}`} className="text-card-foreground hover:underline">
              {p.playerName}
            </Link>
          ) : (
            <span key={p.playerId} className="text-muted-foreground">{p.playerName}</span>
          )
        ))}
      </div>

      {item.summary.leaderName && (
        <p className="mt-3 text-sm font-sans text-card-foreground">
          <span className="font-semibold">{item.summary.leaderName}</span>
          {item.summary.leaderNet != null && <> · net {item.summary.leaderNet}</>}
          {item.summary.leaderGross != null && <> · gross {item.summary.leaderGross}</>}
        </p>
      )}

      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          onClick={toggleKudos}
          aria-pressed={item.viewerHasKudosed}
          className="flex items-center gap-1 text-xs font-sans"
          style={{ color: item.viewerHasKudosed ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
        >
          <Heart size={14} aria-hidden fill={item.viewerHasKudosed ? "currentColor" : "none"} />
          <span className="tabular-nums">{item.kudosCount}</span>
        </button>
        <span className="flex items-center gap-1 text-xs font-sans text-muted-foreground">
          <MessageCircle size={14} aria-hidden />
          <span className="tabular-nums">{item.commentCount}</span>
        </span>
      </div>
    </article>
  );
}
