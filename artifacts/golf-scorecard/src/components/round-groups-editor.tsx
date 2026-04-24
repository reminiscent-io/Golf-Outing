import { useMemo, useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRoundGroups,
  usePutRoundGroups,
  useListPlayers,
  getListRoundGroupsQueryKey,
  getListPlayersQueryKey,
} from "@workspace/api-client-react";
import { Plus, X } from "lucide-react";

type Assignment = { playerId: number; groupNumber: number; slotIndex: number };
type Source = { from: "unassigned" } | { from: "slot"; groupNumber: number; slotIndex: number };

type Props = {
  tripId: number;
  roundId: number;
};

const SLOTS_PER_GROUP = 4;
const TOUCH_ACTIVATE_PX = 6;

type TouchDrag = {
  playerId: number;
  source: Source;
  name: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
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
        if (ctx?.prev !== undefined) queryClient.setQueryData(qk, ctx.prev);
        queryClient.invalidateQueries({ queryKey: qk });
      },
      onSettled: (_data, _err, { tripId: tid, roundId: rid }) => {
        queryClient.invalidateQueries({ queryKey: getListRoundGroupsQueryKey(tid, rid) });
      },
    },
  });

  const serverAssignments: Assignment[] = groupsData?.assignments ?? [];

  // Group numbers currently in use. Always include at least Group 1.
  const serverGroupNumbers = useMemo(() => {
    const s = new Set<number>(serverAssignments.map(a => a.groupNumber));
    s.add(1);
    return Array.from(s).sort((a, b) => a - b);
  }, [serverAssignments]);

  const [extraGroups, setExtraGroups] = useState<number[]>([]);
  useEffect(() => {
    setExtraGroups(prev => prev.filter(n => !serverGroupNumbers.includes(n)));
  }, [serverGroupNumbers]);

  const allGroupNumbers = useMemo(() => {
    const s = new Set<number>([...serverGroupNumbers, ...extraGroups]);
    return Array.from(s).sort((a, b) => a - b);
  }, [serverGroupNumbers, extraGroups]);

  // slotAt.get(`${groupNumber}:${slotIndex}`) = playerId
  const slotAt = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of serverAssignments) m.set(`${a.groupNumber}:${a.slotIndex}`, a.playerId);
    return m;
  }, [serverAssignments]);

  const assignedPlayerIds = useMemo(
    () => new Set(serverAssignments.map(a => a.playerId)),
    [serverAssignments]
  );
  const unassignedPlayers = (players ?? []).filter(p => !assignedPlayerIds.has(p.id));

  function save(next: Assignment[]) {
    putGroups.mutate({ tripId, roundId, data: { assignments: next } });
  }

  // Move a player into a specific slot, possibly swapping with the current occupant.
  function moveToSlot(playerId: number, source: Source, target: { groupNumber: number; slotIndex: number }) {
    const existing = serverAssignments.filter(a => a.playerId !== playerId);
    const occupantId = slotAt.get(`${target.groupNumber}:${target.slotIndex}`) ?? null;

    let working = existing.filter(a => !(occupantId != null && a.playerId === occupantId));

    working.push({ playerId, groupNumber: target.groupNumber, slotIndex: target.slotIndex });

    if (occupantId != null) {
      if (source.from === "slot") {
        working.push({ playerId: occupantId, groupNumber: source.groupNumber, slotIndex: source.slotIndex });
      }
      // If source was unassigned, displaced occupant goes to unassigned — no append needed.
    }

    save(working);
  }

  function moveToUnassigned(playerId: number) {
    save(serverAssignments.filter(a => a.playerId !== playerId));
  }

  function placeInNextOpenSlot(playerId: number, source: Source) {
    for (const gn of allGroupNumbers) {
      for (let i = 1; i <= SLOTS_PER_GROUP; i++) {
        if (!slotAt.has(`${gn}:${i}`)) {
          moveToSlot(playerId, source, { groupNumber: gn, slotIndex: i });
          return;
        }
      }
    }
    // All existing groups are full — add a new group and drop into its first slot.
    const nextNumber = (allGroupNumbers[allGroupNumbers.length - 1] ?? 0) + 1;
    setExtraGroups(prev => [...prev, nextNumber]);
    moveToSlot(playerId, source, { groupNumber: nextNumber, slotIndex: 1 });
  }

  function addGroup() {
    const nextNumber = (allGroupNumbers[allGroupNumbers.length - 1] ?? 0) + 1;
    setExtraGroups(prev => [...prev, nextNumber]);
  }

  function removeEmptyGroup(groupNumber: number) {
    if (serverAssignments.some(a => a.groupNumber === groupNumber)) return;
    setExtraGroups(prev => prev.filter(n => n !== groupNumber));
  }

  // ---------- HTML5 drag-and-drop (desktop) ----------

  function onDragStart(e: React.DragEvent, playerId: number, source: Source) {
    e.dataTransfer.setData("text/plain", JSON.stringify({ playerId, source }));
    e.dataTransfer.effectAllowed = "move";
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function readDrag(e: React.DragEvent): { playerId: number; source: Source } | null {
    const raw = e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.playerId !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function onDropSlot(e: React.DragEvent, groupNumber: number, slotIndex: number) {
    e.preventDefault();
    const drag = readDrag(e);
    if (!drag) return;
    moveToSlot(drag.playerId, drag.source, { groupNumber, slotIndex });
  }

  function onDropUnassigned(e: React.DragEvent) {
    e.preventDefault();
    const drag = readDrag(e);
    if (!drag) return;
    moveToUnassigned(drag.playerId);
  }

  // ---------- Tap + touch drag (mobile) ----------

  const [touchDrag, setTouchDrag] = useState<TouchDrag | null>(null);
  const suppressClickRef = useRef(false);

  // Prevent page scroll while actively dragging.
  useEffect(() => {
    if (!touchDrag?.active) return;
    function preventScroll(e: TouchEvent) {
      e.preventDefault();
    }
    document.addEventListener("touchmove", preventScroll, { passive: false });
    return () => document.removeEventListener("touchmove", preventScroll);
  }, [touchDrag?.active]);

  function onTouchStart(e: React.TouchEvent, playerId: number, source: Source, name: string) {
    const t = e.touches[0];
    if (!t) return;
    setTouchDrag({
      playerId,
      source,
      name,
      startX: t.clientX,
      startY: t.clientY,
      x: t.clientX,
      y: t.clientY,
      active: false,
    });
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    if (!t) return;
    setTouchDrag(prev => {
      if (!prev) return prev;
      const dx = t.clientX - prev.startX;
      const dy = t.clientY - prev.startY;
      const active =
        prev.active || dx * dx + dy * dy >= TOUCH_ACTIVATE_PX * TOUCH_ACTIVATE_PX;
      return { ...prev, x: t.clientX, y: t.clientY, active };
    });
  }

  function onTouchEnd() {
    setTouchDrag(prev => {
      if (!prev) return null;
      if (prev.active) {
        const target = findDropTargetAt(prev.x, prev.y);
        if (target?.kind === "slot") {
          moveToSlot(prev.playerId, prev.source, {
            groupNumber: target.groupNumber,
            slotIndex: target.slotIndex,
          });
        } else if (target?.kind === "unassigned") {
          moveToUnassigned(prev.playerId);
        }
        // Swallow the synthesized click that follows touchend.
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 400);
      }
      return null;
    });
  }

  function onTouchCancel() {
    setTouchDrag(null);
  }

  function onTapUnassignedPlayer(playerId: number) {
    if (suppressClickRef.current) return;
    placeInNextOpenSlot(playerId, { from: "unassigned" });
  }

  function onTapSlotPlayer(playerId: number) {
    if (suppressClickRef.current) return;
    moveToUnassigned(playerId);
  }

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-3 min-w-max py-2">
        {unassignedPlayers.length > 0 && (
          <UnassignedColumn
            players={unassignedPlayers.map(p => ({ id: p.id, name: p.name }))}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDropUnassigned}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            onTapPlayer={onTapUnassignedPlayer}
          />
        )}
        {allGroupNumbers.map(gn => {
          const teamA = (gn - 1) * 2 + 1;
          const teamB = (gn - 1) * 2 + 2;
          const slots = Array.from({ length: SLOTS_PER_GROUP }, (_, i) => {
            const slotIndex = i + 1;
            const playerId = slotAt.get(`${gn}:${slotIndex}`) ?? null;
            const player = playerId != null ? players?.find(p => p.id === playerId) ?? null : null;
            return { slotIndex, playerId, player };
          });
          const isEmpty = slots.every(s => s.playerId == null);
          const canRemove = isEmpty && extraGroups.includes(gn);
          return (
            <GroupColumn
              key={gn}
              groupNumber={gn}
              teamA={teamA}
              teamB={teamB}
              slots={slots}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDropSlot={onDropSlot}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onTouchCancel={onTouchCancel}
              onTapPlayer={onTapSlotPlayer}
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

      {touchDrag?.active && <DragGhost x={touchDrag.x} y={touchDrag.y} name={touchDrag.name} />}
    </div>
  );
}

// Walks up from the element under the point, looking for a drop-target marker.
function findDropTargetAt(
  x: number,
  y: number
):
  | { kind: "slot"; groupNumber: number; slotIndex: number }
  | { kind: "unassigned" }
  | null {
  const el = document.elementFromPoint(x, y);
  let node: Element | null = el;
  while (node) {
    if (node instanceof HTMLElement) {
      const slot = node.dataset.dropSlot;
      if (slot) {
        const [g, s] = slot.split(":").map(Number);
        if (Number.isFinite(g) && Number.isFinite(s)) {
          return { kind: "slot", groupNumber: g, slotIndex: s };
        }
      }
      if (node.dataset.dropUnassigned === "true") {
        return { kind: "unassigned" };
      }
    }
    node = node.parentElement;
  }
  return null;
}

type TouchHandlers = {
  onTouchStart: (e: React.TouchEvent, playerId: number, source: Source, name: string) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
};

type UnassignedProps = TouchHandlers & {
  players: Array<{ id: number; name: string }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onTapPlayer: (playerId: number) => void;
};

function UnassignedColumn({
  players,
  onDragStart,
  onDragOver,
  onDrop,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onTapPlayer,
}: UnassignedProps) {
  return (
    <div
      data-drop-unassigned="true"
      onDragOver={onDragOver}
      onDrop={onDrop}
      className="min-w-[180px] w-[180px] rounded-xl p-3"
      style={{ background: "hsl(158 35% 14%)", border: "1px solid hsl(158 40% 20%)" }}
    >
      <div className="mb-2 text-xs font-sans font-600 uppercase tracking-widest" style={{ color: "hsl(42 52% 59%)" }}>
        Unassigned
      </div>
      <div className="space-y-2 min-h-[40px]">
        {players.map(p => (
          <div
            key={p.id}
            draggable
            onDragStart={e => onDragStart(e, p.id, { from: "unassigned" })}
            onTouchStart={e => onTouchStart(e, p.id, { from: "unassigned" }, p.name)}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            onClick={() => onTapPlayer(p.id)}
            className="px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing text-sm font-sans select-none"
            style={{
              background: "hsl(42 45% 91%)",
              color: "hsl(38 30% 14%)",
              touchAction: "none",
            }}
          >
            {p.name}
          </div>
        ))}
      </div>
    </div>
  );
}

type GroupProps = TouchHandlers & {
  groupNumber: number;
  teamA: number;
  teamB: number;
  slots: Array<{ slotIndex: number; playerId: number | null; player: { id: number; name: string } | null }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
  onTapPlayer: (playerId: number) => void;
  onRemove?: () => void;
};

function GroupColumn({
  groupNumber,
  teamA,
  teamB,
  slots,
  onDragStart,
  onDragOver,
  onDropSlot,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onTapPlayer,
  onRemove,
}: GroupProps) {
  const teamASlots = slots.filter(s => s.slotIndex <= 2);
  const teamBSlots = slots.filter(s => s.slotIndex >= 3);

  return (
    <div
      className="min-w-[180px] w-[180px] rounded-xl p-3"
      style={{ background: "hsl(158 35% 14%)", border: "1px solid hsl(158 40% 20%)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-sans font-600 uppercase tracking-widest" style={{ color: "hsl(42 52% 59%)" }}>
          Group {groupNumber}
        </div>
        {onRemove && (
          <button onClick={onRemove} className="hover:opacity-80" style={{ color: "hsl(42 20% 55%)" }}>
            <X size={14} />
          </button>
        )}
      </div>
      <TeamSection
        label={`Team ${teamA}`}
        groupNumber={groupNumber}
        slots={teamASlots}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDropSlot={onDropSlot}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onTapPlayer={onTapPlayer}
      />
      <div className="my-2 text-[10px] font-sans text-center uppercase tracking-widest" style={{ color: "hsl(42 20% 45%)" }}>
        vs
      </div>
      <TeamSection
        label={`Team ${teamB}`}
        groupNumber={groupNumber}
        slots={teamBSlots}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDropSlot={onDropSlot}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchCancel}
        onTapPlayer={onTapPlayer}
      />
    </div>
  );
}

type TeamSectionProps = TouchHandlers & {
  label: string;
  groupNumber: number;
  slots: Array<{ slotIndex: number; playerId: number | null; player: { id: number; name: string } | null }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
  onTapPlayer: (playerId: number) => void;
};

function TeamSection({
  label,
  groupNumber,
  slots,
  onDragStart,
  onDragOver,
  onDropSlot,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onTapPlayer,
}: TeamSectionProps) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-sans font-600 uppercase tracking-widest" style={{ color: "hsl(42 35% 60%)" }}>
        {label}
      </div>
      <div className="space-y-1.5">
        {slots.map(s => (
          <SlotCell
            key={s.slotIndex}
            groupNumber={groupNumber}
            slotIndex={s.slotIndex}
            player={s.player}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDropSlot={onDropSlot}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
            onTapPlayer={onTapPlayer}
          />
        ))}
      </div>
    </div>
  );
}

type SlotCellProps = TouchHandlers & {
  groupNumber: number;
  slotIndex: number;
  player: { id: number; name: string } | null;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
  onTapPlayer: (playerId: number) => void;
};

function SlotCell({
  groupNumber,
  slotIndex,
  player,
  onDragStart,
  onDragOver,
  onDropSlot,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
  onTapPlayer,
}: SlotCellProps) {
  const filled = player != null;
  return (
    <div
      data-drop-slot={`${groupNumber}:${slotIndex}`}
      onDragOver={onDragOver}
      onDrop={e => onDropSlot(e, groupNumber, slotIndex)}
      className="px-2.5 py-2 rounded-lg text-sm font-sans select-none"
      style={
        filled
          ? {
              background: "hsl(42 45% 91%)",
              color: "hsl(38 30% 14%)",
              touchAction: "none",
            }
          : {
              background: "transparent",
              color: "hsl(42 20% 50%)",
              border: "1.5px dashed hsl(158 40% 22%)",
            }
      }
      draggable={filled}
      onDragStart={filled && player ? e => onDragStart(e, player.id, { from: "slot", groupNumber, slotIndex }) : undefined}
      onTouchStart={
        filled && player
          ? e => onTouchStart(e, player.id, { from: "slot", groupNumber, slotIndex }, player.name)
          : undefined
      }
      onTouchMove={filled ? onTouchMove : undefined}
      onTouchEnd={filled ? onTouchEnd : undefined}
      onTouchCancel={filled ? onTouchCancel : undefined}
      onClick={filled && player ? () => onTapPlayer(player.id) : undefined}
    >
      {filled ? player!.name : "—"}
    </div>
  );
}

function DragGhost({ x, y, name }: { x: number; y: number; name: string }) {
  return (
    <div
      className="pointer-events-none fixed z-50 px-2.5 py-2 rounded-lg text-sm font-sans shadow-lg"
      style={{
        left: x,
        top: y,
        transform: "translate(-50%, -50%)",
        background: "hsl(42 45% 91%)",
        color: "hsl(38 30% 14%)",
        opacity: 0.92,
      }}
    >
      {name}
    </div>
  );
}
