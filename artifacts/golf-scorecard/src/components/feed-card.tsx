import { useState } from "react";
import { useGiveKudos, useRevokeKudos, type FeedItem } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Heart, MessageCircle, Flag, ChevronDown } from "lucide-react";

const COLLAPSED_PLAYER_COUNT = 4;

type Props = { item: FeedItem };

// Round dates arrive as "YYYY-MM-DD" (or an ISO timestamp). Parse the date part
// in local time so a UTC-midnight value never slips to the previous day.
function shortDate(d?: string | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return null;
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FeedCard({ item }: Props) {
  const qc = useQueryClient();
  const give = useGiveKudos();
  const revoke = useRevokeKudos();
  const [, navigate] = useLocation();
  const [expanded, setExpanded] = useState(false);

  const isLive = item.completedAt == null;
  // Lowest gross first; players without a score yet fall to the bottom.
  const players = [...item.players].sort((a, b) => {
    if (a.gross == null) return b.gross == null ? 0 : 1;
    if (b.gross == null) return -1;
    return a.gross - b.gross;
  });
  const hiddenCount = Math.max(0, players.length - COLLAPSED_PLAYER_COUNT);
  const visiblePlayers = expanded ? players : players.slice(0, COLLAPSED_PLAYER_COUNT);
  const href = item.tripId == null ? `/rounds/${item.roundId}` : `/trips/${item.tripId}/rounds/${item.roundId}`;
  const title = item.course || item.name;
  // Secondary line: the round name (only when it isn't already the title) and a short date.
  const meta = [item.course && item.name !== item.course ? item.name : null, shortDate(item.date)]
    .filter(Boolean)
    .join(" · ");

  function toggleKudos() {
    const mutate = item.viewerHasKudosed ? revoke.mutate : give.mutate;
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
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => navigate(href)} className="block min-w-0 flex-1 text-left">
          <h3 className="font-serif text-lg font-semibold text-card-foreground leading-tight truncate">{title}</h3>
          {meta && <p className="mt-0.5 text-xs font-sans text-muted-foreground truncate">{meta}</p>}
        </button>
        {isLive && (
          <span
            className="shrink-0 inline-flex items-center gap-1.5 text-[10px] font-sans font-semibold uppercase tracking-[0.18em] pt-1"
            style={{ color: "hsl(var(--brass-ink))" }}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span
                className="absolute inline-flex h-full w-full rounded-full animate-ping opacity-70 motion-reduce:hidden"
                style={{ backgroundColor: "hsl(var(--score-birdie))" }}
              />
              <span
                className="relative inline-flex h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: "hsl(var(--score-birdie))" }}
              />
            </span>
            thru {item.summary.holesPlayed}
            <span className="opacity-50">·{item.summary.totalHoles}</span>
          </span>
        )}
      </div>

      {players.length > 0 && (
        <ul className="mt-3 space-y-1">
          {visiblePlayers.map(p => {
            const isLeader = item.summary.leaderName != null && p.playerName === item.summary.leaderName;
            return (
              <li key={p.playerId} className="flex items-end gap-2 text-sm font-sans leading-tight">
                <span className="inline-flex items-center gap-1 shrink-0 text-card-foreground">
                  {p.userId ? (
                    <Link href={`/users/${p.userId}`} className="hover:underline">{p.playerName}</Link>
                  ) : (
                    <span>{p.playerName}</span>
                  )}
                  {isLeader && (
                    <Flag size={11} aria-label="Leading" style={{ color: "hsl(var(--brass-ink))" }} fill="currentColor" />
                  )}
                </span>
                <span className="flex-1 border-b border-dotted border-card-border mb-1" aria-hidden />
                <span
                  className="shrink-0 tabular-nums text-card-foreground"
                  style={isLeader ? { color: "hsl(var(--brass-ink))", fontWeight: 600 } : undefined}
                >
                  {p.gross ?? "–"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          className="mt-2 inline-flex items-center gap-1 text-xs font-sans text-muted-foreground hover:text-card-foreground"
        >
          {expanded ? "Show less" : `See ${hiddenCount} more`}
          <ChevronDown
            size={13}
            aria-hidden
            className="transition-transform duration-200"
            style={expanded ? { transform: "rotate(180deg)" } : undefined}
          />
        </button>
      )}

      <div className="mt-4 flex items-center gap-4 pt-3 border-t border-card-border/60">
        <button
          type="button"
          onClick={toggleKudos}
          aria-pressed={item.viewerHasKudosed}
          aria-label={item.viewerHasKudosed ? "Remove kudos" : "Give kudos"}
          className="flex items-center gap-1.5 text-xs font-sans"
          style={{ color: item.viewerHasKudosed ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
        >
          <Heart size={15} aria-hidden fill={item.viewerHasKudosed ? "currentColor" : "none"} />
          <span className="tabular-nums">{item.kudosCount}</span>
        </button>
        <button
          type="button"
          onClick={() => navigate(href)}
          aria-label="View comments"
          className="flex items-center gap-1.5 text-xs font-sans text-muted-foreground"
        >
          <MessageCircle size={15} aria-hidden />
          <span className="tabular-nums">{item.commentCount}</span>
        </button>
      </div>
    </article>
  );
}
