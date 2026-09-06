import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Plus } from "lucide-react";
import { getFeed, type FeedPage, type FeedItem, useListMyBuddies, getListMyBuddiesQueryKey } from "@workspace/api-client-react";
import { FeedCard } from "@/components/feed-card";
import { useAuthSession } from "@/lib/auth";
import { SoloRoundModal } from "@/components/solo-round-modal";
import { roundPath } from "@/lib/round-nav";

type Tab = "buddies" | "mine" | "all";

function SectionHeader({ label, live }: { label: string; live?: boolean }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      {live && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden>
          <span
            className="absolute inline-flex h-full w-full rounded-full animate-ping opacity-70 motion-reduce:hidden"
            style={{ backgroundColor: "hsl(var(--score-birdie))" }}
          />
          <span
            className="relative inline-flex h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "hsl(var(--score-birdie))" }}
          />
        </span>
      )}
      <h2
        className="font-sans text-[10px] font-semibold uppercase tracking-[0.32em]"
        style={{ color: "hsl(var(--brass-ink))" }}
      >
        {label}
      </h2>
      <span className="flex-1 border-t border-dashed border-card-border" aria-hidden />
    </div>
  );
}

export default function FeedPage() {
  const session = useAuthSession();
  const [, navigate] = useLocation();
  const { data: buddies } = useListMyBuddies({ query: { queryKey: getListMyBuddiesQueryKey(), enabled: !!session } });
  const [tab, setTab] = useState<Tab>(() => "all");
  const [soloOpen, setSoloOpen] = useState(false);

  // Default tab once buddies resolve.
  useEffect(() => {
    if (buddies && buddies.length > 0) setTab("buddies");
  }, [buddies]);

  const query = useInfiniteQuery({
    queryKey: ["feed", tab],
    queryFn: ({ pageParam }) =>
      getFeed({ tab, before: pageParam ?? undefined, limit: 20 }) as Promise<FeedPage>,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    enabled: !!session,
    refetchInterval: 30_000,
  });

  const items: FeedItem[] = useMemo(
    () => (query.data?.pages ?? []).flatMap(p => p.items),
    [query.data]
  );
  const liveItems = useMemo(() => items.filter(i => i.completedAt == null), [items]);
  const finishedItems = useMemo(() => items.filter(i => i.completedAt != null), [items]);

  if (!session) return null;

  return (
    <div className="min-h-dvh bg-background">
      <div className="max-w-lg mx-auto px-4 py-6">
        <div className="flex items-center gap-1 mb-4 border-b border-card-border">
          {(["buddies", "mine", "all"] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className="px-3 py-2 text-[11px] font-sans font-semibold uppercase tracking-[0.18em]"
              style={{
                color: tab === t ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))",
                borderBottom: tab === t ? "2px solid hsl(var(--primary))" : "2px solid transparent",
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {query.isLoading && (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-32 rounded-2xl animate-pulse bg-card border border-card-border" />)}</div>
        )}
        {!query.isLoading && items.length === 0 && (
          <p className="text-sm font-sans text-muted-foreground text-center py-12">
            {tab === "buddies" && "Play a round with someone to start seeing their rounds here."}
            {tab === "mine" && "Rounds you've played will show up here."}
            {tab === "all" && "No public rounds yet."}
          </p>
        )}
        <div className="space-y-8">
          {liveItems.length > 0 && (
            <section>
              <SectionHeader label="Live rounds" live />
              <div className="space-y-3">
                {liveItems.map(item => <FeedCard key={item.roundId} item={item} />)}
              </div>
            </section>
          )}
          {finishedItems.length > 0 && (
            <section>
              <SectionHeader label="Finished rounds" />
              <div className="space-y-3">
                {finishedItems.map(item => <FeedCard key={item.roundId} item={item} />)}
              </div>
            </section>
          )}
        </div>
        {query.hasNextPage && (
          <button
            type="button"
            onClick={() => query.fetchNextPage()}
            className="w-full mt-4 py-3 rounded-full text-sm font-sans font-semibold bg-card border border-card-border"
          >
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={() => setSoloOpen(true)}
        aria-label="Log a round"
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
      >
        <Plus size={22} aria-hidden />
      </button>
      <SoloRoundModal open={soloOpen} onClose={() => setSoloOpen(false)} onCreated={({ tripId, roundId }) => navigate(roundPath(tripId, roundId))} />
    </div>
  );
}
