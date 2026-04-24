import { useMemo, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRoundGroups,
  usePutRoundGroups,
  useListPlayers,
  getListRoundGroupsQueryKey,
  getListPlayersQueryKey,
} from "@workspace/api-client-react";
import { Plus, X } from "lucide-react";

type Assignment = { playerId: number; groupNumber: number };

type Props = {
  tripId: number;
  roundId: number;
};

export function RoundGroupsEditor({ tripId, roundId }: Props) {
  const queryClient = useQueryClient();
  const { data: players } = useListPlayers(tripId, {
    query: { queryKey: getListPlayersQueryKey(tripId), enabled: !!tripId },
  });
  const { data: groupsData } = useListRoundGroups(tripId, roundId, {
    query: { queryKey: getListRoundGroupsQueryKey(tripId, roundId), enabled: !!tripId && !!roundId },
  });
  const putGroups = usePutRoundGroups({
    mutation: {
      onMutate: async ({ tripId: tid, roundId: rid, data }) => {
        const qk = getListRoundGroupsQueryKey(tid, rid);
        await queryClient.cancelQueries({ queryKey: qk });
        const prev = queryClient.getQueryData(qk);
        queryClient.setQueryData(qk, data);
        return { prev, qk };
      },
      onError: (_err, { tripId: tid, roundId: rid }, ctx) => {
        const qk = getListRoundGroupsQueryKey(tid, rid);
        if (ctx?.prev !== undefined) {
          queryClient.setQueryData(qk, ctx.prev);
        }
        queryClient.invalidateQueries({ queryKey: qk });
      },
      onSettled: (_data, _err, { tripId: tid, roundId: rid }) => {
        queryClient.invalidateQueries({ queryKey: getListRoundGroupsQueryKey(tid, rid) });
      },
    },
  });

  const serverAssignments: Assignment[] = groupsData?.assignments ?? [];

  // Derive the set of group numbers that should be shown. Start with server
  // groups; the user can locally append an empty Group N+1 via "Add group".
  const serverGroupNumbers = useMemo(() => {
    const s = new Set<number>(serverAssignments.map(a => a.groupNumber));
    // Always show at least Group 1 so there's somewhere to drop.
    s.add(1);
    return Array.from(s).sort((a, b) => a - b);
  }, [serverAssignments]);

  const [extraGroups, setExtraGroups] = useState<number[]>([]);

  // Drop any "extra" groups that have since been populated on the server.
  useEffect(() => {
    setExtraGroups(prev => prev.filter(n => !serverGroupNumbers.includes(n)));
  }, [serverGroupNumbers]);

  const allGroupNumbers = useMemo(() => {
    const s = new Set<number>([...serverGroupNumbers, ...extraGroups]);
    return Array.from(s).sort((a, b) => a - b);
  }, [serverGroupNumbers, extraGroups]);

  const assignmentByPlayer = useMemo(() => {
    const m = new Map<number, number>();
    serverAssignments.forEach(a => m.set(a.playerId, a.groupNumber));
    return m;
  }, [serverAssignments]);

  const unassignedPlayers = (players ?? []).filter(p => !assignmentByPlayer.has(p.id));

  function save(nextAssignments: Assignment[]) {
    putGroups.mutate({ tripId, roundId, data: { assignments: nextAssignments } });
  }

  function movePlayer(playerId: number, toGroup: number | "unassigned") {
    const others = serverAssignments.filter(a => a.playerId !== playerId);
    const next = toGroup === "unassigned" ? others : [...others, { playerId, groupNumber: toGroup }];
    save(next);
  }

  function addGroup() {
    const nextNumber = (allGroupNumbers[allGroupNumbers.length - 1] ?? 0) + 1;
    setExtraGroups(prev => [...prev, nextNumber]);
  }

  function removeEmptyGroup(groupNumber: number) {
    // Only allowed for empty groups; handler skipped if any assignment matches.
    if (serverAssignments.some(a => a.groupNumber === groupNumber)) return;
    setExtraGroups(prev => prev.filter(n => n !== groupNumber));
  }

  function onDragStart(e: React.DragEvent, playerId: number) {
    e.dataTransfer.setData("text/plain", String(playerId));
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function onDrop(e: React.DragEvent, target: number | "unassigned") {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const playerId = Number(raw);
    if (!playerId) return;
    movePlayer(playerId, target);
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max py-2">
        <GroupColumn
          title="Unassigned"
          players={unassignedPlayers.map(p => ({ id: p.id, name: p.name }))}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={e => onDrop(e, "unassigned")}
        />
        {allGroupNumbers.map(gn => {
          const assigned = serverAssignments
            .filter(a => a.groupNumber === gn)
            .map(a => {
              const p = players?.find(pl => pl.id === a.playerId);
              return p ? { id: p.id, name: p.name } : null;
            })
            .filter((x): x is { id: number; name: string } => x !== null);
          const canRemove = assigned.length === 0 && extraGroups.includes(gn);
          return (
            <GroupColumn
              key={gn}
              title={`Group ${gn}`}
              players={assigned}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={e => onDrop(e, gn)}
              onRemove={canRemove ? () => removeEmptyGroup(gn) : undefined}
            />
          );
        })}
        <button
          onClick={addGroup}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg self-start font-sans text-xs font-600"
          style={{ background: "hsl(158 35% 20%)", color: "hsl(42 52% 59%)" }}
        >
          <Plus size={14} />
          Add group
        </button>
      </div>
    </div>
  );
}

type GroupColumnProps = {
  title: string;
  players: Array<{ id: number; name: string }>;
  onDragStart: (e: React.DragEvent, playerId: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onRemove?: () => void;
};

function GroupColumn({ title, players, onDragStart, onDragOver, onDrop, onRemove }: GroupColumnProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="min-w-[180px] w-[180px] rounded-xl p-3"
      style={{ background: "hsl(158 35% 14%)", border: "1px solid hsl(158 40% 20%)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-sans font-600 uppercase tracking-widest" style={{ color: "hsl(42 52% 59%)" }}>
          {title}
        </div>
        {onRemove && (
          <button onClick={onRemove} className="hover:opacity-80" style={{ color: "hsl(42 20% 55%)" }}>
            <X size={14} />
          </button>
        )}
      </div>
      <div className="space-y-2 min-h-[40px]">
        {players.map(p => (
          <div
            key={p.id}
            draggable
            onDragStart={e => onDragStart(e, p.id)}
            className="px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing text-sm font-sans"
            style={{ background: "hsl(42 45% 91%)", color: "hsl(38 30% 14%)" }}
          >
            {p.name}
          </div>
        ))}
      </div>
    </div>
  );
}
