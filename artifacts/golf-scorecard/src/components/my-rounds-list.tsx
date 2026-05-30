import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useListMyRounds, type MyRoundsItem } from "@workspace/api-client-react";
import { Flag, ChevronRight } from "lucide-react";

const BRASS = "hsl(42 52% 59%)";
const BRASS_FAINT = "hsl(42 25% 60%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 50%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";
const CREAM_BORDER = "hsl(38 25% 88%)";
const AMBER_BG = "hsl(42 80% 90%)";
const AMBER_FG = "hsl(35 60% 30%)";
const UNDER_PAR = "hsl(150 50% 30%)";

type Filter = "all" | "solo" | "trip";

export function MyRoundsList() {
  const [filter, setFilter] = useState<Filter>("all");
  const { data: items, isLoading } = useListMyRounds({ filter });
  const safeItems: MyRoundsItem[] = items ?? [];

  const { allCount, soloCount, tripCount } = useMemo(() => {
    let solo = 0, trip = 0;
    for (const it of safeItems) {
      if (it.trip == null) solo++;
      else trip++;
    }
    return { allCount: safeItems.length, soloCount: solo, tripCount: trip };
  }, [safeItems]);

  const grouped = useMemo(() => groupByMonth(safeItems), [safeItems]);

  if (isLoading) {
    return (
      <div className="space-y-2 px-5 py-4">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="h-16 rounded-md animate-pulse" style={{ background: "hsl(38 30% 90%)" }} />
        ))}
      </div>
    );
  }

  return (
    <div>
      <FilterChips filter={filter} onChange={setFilter} all={allCount} solo={soloCount} trip={tripCount} />
      {safeItems.length === 0 ? <EmptyState filter={filter} /> : (
        <div>
          {grouped.map(g => (
            <section key={g.label}>
              <div
                className="text-[10px] font-sans font-bold uppercase pt-4 pb-2 px-5"
                style={{ color: "hsl(42 50% 40%)", letterSpacing: "0.32em" }}
              >
                {g.label}
              </div>
              {g.items.map(item => <RoundRow key={item.round.id} item={item} />)}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChips({
  filter, onChange, all, solo, trip,
}: Readonly<{ filter: Filter; onChange: (f: Filter) => void; all: number; solo: number; trip: number }>) {
  const chips: { value: Filter; label: string; count: number }[] = [
    { value: "all", label: "All", count: all },
    { value: "solo", label: "Solo", count: solo },
    { value: "trip", label: "Trip", count: trip },
  ];
  return (
    <div className="flex gap-2 px-5 py-3 border-b" style={{ borderColor: CREAM_BORDER }}>
      {chips.map(c => {
        const active = filter === c.value;
        return (
          <button
            key={c.value}
            type="button"
            onClick={() => onChange(c.value)}
            aria-pressed={active}
            className="text-[11px] font-sans font-semibold uppercase tracking-[0.08em] px-3 py-1.5 rounded-full transition-colors"
            style={{
              background: active ? "hsl(158 65% 9%)" : "white",
              color: active ? BRASS : "hsl(38 20% 38%)",
              border: active ? "1px solid hsl(158 65% 9%)" : "1px solid hsl(38 25% 78%)",
            }}
          >
            {c.label} <span style={{ opacity: 0.6, fontWeight: 500 }}>{c.count}</span>
          </button>
        );
      })}
    </div>
  );
}

function EmptyState({ filter }: Readonly<{ filter: Filter }>) {
  const msg = filter === "solo" ? "No solo rounds yet."
    : filter === "trip" ? "No trip rounds yet."
    : "You haven't logged any rounds yet. Log one to get started.";
  return (
    <div className="text-center py-16 px-5">
      <div className="w-14 h-14 mx-auto mb-5 rounded-full flex items-center justify-center"
        style={{ background: FOREST_ACCENT, border: "1px solid hsl(42 60% 48%)" }}>
        <Flag size={22} style={{ color: BRASS }} strokeWidth={1.6} />
      </div>
      <p className="font-sans text-sm" style={{ color: BRASS_FAINT, lineHeight: 1.55 }}>{msg}</p>
    </div>
  );
}

function RoundRow({ item }: Readonly<{ item: MyRoundsItem }>) {
  const [, navigate] = useLocation();
  const r = item.round;
  const trip = item.trip;
  const inProgress = !r.completedAt;
  const detailHref = trip == null ? `/rounds/${r.id}` : `/trips/${trip.id}/rounds/${r.id}`;

  const dateInfo = parseDateForRow(r.date ?? r.createdAt);
  const grossLabel = inProgress ? "—" : (item.gross != null ? String(item.gross) : "—");
  const netLabel = inProgress
    ? "play"
    : (item.net != null ? `${item.net > 0 ? "+" : item.net < 0 ? "−" : ""}${Math.abs(item.net)} net` : "");

  return (
    <div
      onClick={() => navigate(detailHref)}
      className="flex items-start gap-3 px-5 py-3.5 cursor-pointer transition-colors hover:bg-black/[0.02] border-t"
      style={{ borderColor: CREAM_BORDER, background: "white" }}
    >
      <div className="w-9 flex-shrink-0 text-center">
        <div className="font-serif text-[22px] leading-none" style={{ color: INK }}>{dateInfo.day}</div>
        <div className="text-[9px] tracking-[0.18em] mt-0.5 uppercase" style={{ color: INK_SOFT }}>{dateInfo.weekday}</div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-serif text-[15px] font-medium" style={{ color: INK }}>{r.course ?? r.name}</div>
        <div className="flex items-center gap-2 mt-1 text-[11px]" style={{ color: INK_SOFT }}>
          {inProgress && (
            <>
              <span className="font-bold uppercase tracking-[0.1em] text-[9px] px-1.5 py-0.5 rounded-full"
                style={{ background: AMBER_BG, color: AMBER_FG }}>In progress</span>
              <span>· {item.holesPlayed} of 18 holes</span>
            </>
          )}
          {!inProgress && trip != null && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); navigate(`/trips/${trip.id}`); }}
              className="font-bold uppercase tracking-[0.12em] text-[9px] px-1.5 py-0.5 rounded-full transition-opacity hover:opacity-85"
              style={{ background: FOREST_ACCENT, color: BRASS }}
            >
              {trip.name}
            </button>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <div className="font-serif text-[18px] font-medium" style={{ color: INK }}>{grossLabel}</div>
        <div className="text-[11px] mt-0.5" style={{ color: item.net != null && item.net < 0 ? UNDER_PAR : INK_SOFT }}>
          {netLabel}
        </div>
      </div>
      <ChevronRight size={18} style={{ color: "hsl(38 25% 65%)" }} className="self-center ml-1" />
    </div>
  );
}

type Grouped = { label: string; items: MyRoundsItem[] };

function groupByMonth(items: MyRoundsItem[]): Grouped[] {
  const byKey = new Map<string, Grouped>();
  for (const it of items) {
    const raw = it.round.date ?? it.round.createdAt;
    const d = parseLocalOrIso(raw);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, "0")}`;
    const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    const bucket = byKey.get(key) ?? { label, items: [] };
    bucket.items.push(it);
    byKey.set(key, bucket);
  }
  return Array.from(byKey.values());
}

function parseLocalOrIso(s: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateForRow(s: string): { day: string; weekday: string } {
  const d = parseLocalOrIso(s);
  if (!d) return { day: "—", weekday: "" };
  return {
    day: String(d.getDate()).padStart(2, "0"),
    weekday: d.toLocaleDateString(undefined, { weekday: "short" }),
  };
}
