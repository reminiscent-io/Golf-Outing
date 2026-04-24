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

type TouchDragState = {
  playerId: number;
  source: Source;
  startX: number;
  startY: number;
  isDragging: boolean;
  ghost: HTMLElement | null;
  playerName: string;
};

type Props = {
  tripId: number;
  roundId: number;
};

const SLOTS_PER_GROUP = 4;

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

  function moveToSlot(playerId: number, source: Source, target: { groupNumber: number; slotIndex: number }) {
    const existing = serverAssignments.filter(a => a.playerId !== playerId);
    const occupantId = slotAt.get(`${target.groupNumber}:${target.slotIndex}`) ?? null;

    let working = existing.filter(a => !(occupantId != null && a.playerId === occupantId));
    working.push({ playerId, groupNumber: target.groupNumber, slotIndex: target.slotIndex });

    if (occupantId != null) {
      if (source.from === "slot") {
        working.push({ playerId: occupantId, groupNumber: source.groupNumber, slotIndex: source.slotIndex });
      }
    }

    save(working);
  }

  function moveToUnassigned(playerId: number) {
    save(serverAssignments.filter(a => a.playerId !== playerId));
  }

  // Tap-to-assign: place player in the next open slot across all groups in order
  function tapAssign(playerId: number) {
    for (const gn of allGroupNumbers) {
      for (let si = 1; si <= SLOTS_PER_GROUP; si++) {
        if (!slotAt.has(`${gn}:${si}`)) {
          moveToSlot(playerId, { from: "unassigned" }, { groupNumber: gn, slotIndex: si });
          return;
        }
      }
    }
  }

  function addGroup() {
    const nextNumber = (allGroupNumbers[allGroupNumbers.length - 1] ?? 0) + 1;
    setExtraGroups(prev => [...prev, nextNumber]);
  }

  function removeEmptyGroup(groupNumber: number) {
    if (serverAssignments.some(a => a.groupNumber === groupNumber)) return;
    setExtraGroups(prev => prev.filter(n => n !== groupNumber));
  }

  // ── Desktop drag-and-drop ──────────────────────────────────────────────────

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

  // ── Mobile touch drag-and-drop ─────────────────────────────────────────────

  const touchDragRef = useRef<TouchDragState | null>(null);

  // Keep stable refs to the action functions so document listeners don't go stale
  const moveToSlotRef = useRef(moveToSlot);
  const moveToUnassignedRef = useRef(moveToUnassigned);
  const tapAssignRef = useRef(tapAssign);
  useEffect(() => {
    moveToSlotRef.current = moveToSlot;
    moveToUnassignedRef.current = moveToUnassigned;
    tapAssignRef.current = tapAssign;
  });

  useEffect(() => {
    function onTouchMove(e: TouchEvent) {
      const state = touchDragRef.current;
      if (!state) return;

      const touch = e.touches[0];
      const dx = touch.clientX - state.startX;
      const dy = touch.clientY - state.startY;

      if (!state.isDragging) {
        if (Math.sqrt(dx * dx + dy * dy) < 8) return;
        state.isDragging = true;

        const ghost = document.createElement("div");
        ghost.textContent = state.playerName;
        ghost.style.cssText = [
          "position:fixed",
          "pointer-events:none",
          "z-index:9999",
          "padding:8px 10px",
          "border-radius:8px",
          "font-size:14px",
          "font-family:sans-serif",
          "background:hsl(42 45% 91%)",
          "color:hsl(38 30% 14%)",
          "opacity:0.85",
          "box-shadow:0 4px 16px rgba(0,0,0,0.35)",
          "white-space:nowrap",
          "transform:translateX(-50%) translateY(-50%)",
        ].join(";");
        ghost.style.left = touch.clientX + "px";
        ghost.style.top = touch.clientY + "px";
        document.body.appendChild(ghost);
        state.ghost = ghost;
      }

      if (state.isDragging && state.ghost) {
        e.preventDefault();
        state.ghost.style.left = touch.clientX + "px";
        state.ghost.style.top = touch.clientY + "px";
      }
    }

    function onTouchEnd(e: TouchEvent) {
      const state = touchDragRef.current;
      if (!state) return;
      touchDragRef.current = null;

      if (state.ghost) {
        state.ghost.remove();
      }

      if (!state.isDragging) {
        // It was a tap
        if (state.source.from === "unassigned") {
          tapAssignRef.current(state.playerId);
        } else {
          moveToUnassignedRef.current(state.playerId);
        }
        return;
      }

      // It was a drag — find the drop target under the finger
      const touch = e.changedTouches[0];
      let el = document.elementFromPoint(touch.clientX, touch.clientY) as HTMLElement | null;

      while (el) {
        if (el.dataset.dropSlot) {
          const [gnStr, siStr] = el.dataset.dropSlot.split(":");
          moveToSlotRef.current(state.playerId, state.source, {
            groupNumber: Number(gnStr),
            slotIndex: Number(siStr),
          });
          return;
        }
        if (el.dataset.dropUnassigned) {
          moveToUnassignedRef.current(state.playerId);
          return;
        }
        el = el.parentElement;
      }
    }

    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", onTouchEnd);
    return () => {
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  function onTouchStart(e: React.TouchEvent, playerId: number, source: Source, playerName: string) {
    const touch = e.touches[0];
    touchDragRef.current = {
      playerId,
      source,
      startX: touch.clientX,
      startY: touch.clientY,
      isDragging: false,
      ghost: null,
      playerName,
    };
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

type UnassignedProps = {
  players: Array<{ id: number; name: string }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onTouchStart: (e: React.TouchEvent, playerId: number, source: Source, playerName: string) => void;
};

function UnassignedColumn({ players, onDragStart, onDragOver, onDrop, onTouchStart }: UnassignedProps) {
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
      <div className="mb-1 text-[10px] font-sans" style={{ color: "hsl(42 20% 50%)" }}>
        Tap to assign
      </div>
      <div className="space-y-2 min-h-[40px]">
        {players.map(p => (
          <div
            key={p.id}
            draggable
            onDragStart={e => onDragStart(e, p.id, { from: "unassigned" })}
            onTouchStart={e => onTouchStart(e, p.id, { from: "unassigned" }, p.name)}
            className="px-2.5 py-2 rounded-lg cursor-grab active:cursor-grabbing text-sm font-sans select-none"
            style={{ background: "hsl(42 45% 91%)", color: "hsl(38 30% 14%)", touchAction: "none" }}
          >
            {p.name}
          </div>
        ))}
      </div>
    </div>
  );
}

type GroupProps = {
  groupNumber: number;
  teamA: number;
  teamB: number;
  slots: Array<{ slotIndex: number; playerId: number | null; player: { id: number; name: string } | null }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
  onTouchStart: (e: React.TouchEvent, playerId: number, source: Source, playerName: string) => void;
  onRemove?: () => void;
};

function GroupColumn({ groupNumber, teamA, teamB, slots, onDragStart, onDragOver, onDropSlot, onTouchStart, onRemove }: GroupProps) {
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
      <TeamSection label={`Team ${teamA}`} groupNumber={groupNumber} slots={teamASlots} onDragStart={onDragStart} onDragOver={onDragOver} onDropSlot={onDropSlot} onTouchStart={onTouchStart} />
      <div className="my-2 text-[10px] font-sans text-center uppercase tracking-widest" style={{ color: "hsl(42 20% 45%)" }}>
        vs
      </div>
      <TeamSection label={`Team ${teamB}`} groupNumber={groupNumber} slots={teamBSlots} onDragStart={onDragStart} onDragOver={onDragOver} onDropSlot={onDropSlot} onTouchStart={onTouchStart} />
    </div>
  );
}

type TeamSectionProps = {
  label: string;
  groupNumber: number;
  slots: Array<{ slotIndex: number; playerId: number | null; player: { id: number; name: string } | null }>;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
  onTouchStart: (e: React.TouchEvent, playerId: number, source: Source, playerName: string) => void;
};

function TeamSection({ label, groupNumber, slots, onDragStart, onDragOver, onDropSlot, onTouchStart }: TeamSectionProps) {
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
          />
        ))}
      </div>
    </div>
  );
}

type SlotCellProps = {
  groupNumber: number;
  slotIndex: number;
  player: { id: number; name: string } | null;
  onDragStart: (e: React.DragEvent, playerId: number, source: Source) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDropSlot: (e: React.DragEvent, groupNumber: number, slotIndex: number) => void;
  onTouchStart: (e: React.TouchEvent, playerId: number, source: Source, playerName: string) => void;
};

function SlotCell({ groupNumber, slotIndex, player, onDragStart, onDragOver, onDropSlot, onTouchStart }: SlotCellProps) {
  const filled = player != null;
  return (
    <div
      data-drop-slot={`${groupNumber}:${slotIndex}`}
      onDragOver={onDragOver}
      onDrop={e => onDropSlot(e, groupNumber, slotIndex)}
      className="px-2.5 py-2 rounded-lg text-sm font-sans select-none"
      style={
        filled
          ? { background: "hsl(42 45% 91%)", color: "hsl(38 30% 14%)", touchAction: "none" }
          : { background: "transparent", color: "hsl(42 20% 50%)", border: "1.5px dashed hsl(158 40% 22%)" }
      }
      draggable={filled}
      onDragStart={filled && player ? e => onDragStart(e, player.id, { from: "slot", groupNumber, slotIndex }) : undefined}
      onTouchStart={
        filled && player
          ? e => onTouchStart(e, player.id, { from: "slot", groupNumber, slotIndex }, player.name)
          : undefined
      }
    >
      {filled ? player!.name : "—"}
    </div>
  );
}
