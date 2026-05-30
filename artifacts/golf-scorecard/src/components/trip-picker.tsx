import { useListMyTrips } from "@workspace/api-client-react";

type Props = {
  value: number | null;
  onChange: (next: number | null) => void;
};

export function TripPicker({ value, onChange }: Readonly<Props>) {
  const { data: trips } = useListMyTrips();
  const choices = (trips ?? []).filter(t => t.via === "player" || t.via === "both");

  return (
    <select
      value={value === null ? "" : String(value)}
      onChange={e => {
        const raw = e.target.value;
        onChange(raw === "" ? null : Number(raw));
      }}
      className="w-full px-3 py-2.5 rounded-lg bg-popover text-card-foreground text-sm font-sans"
      style={{ border: "1.5px solid hsl(var(--input))" }}
    >
      <option value="">None (solo)</option>
      {choices.map(c => (
        <option key={c.trip.id} value={c.trip.id}>{c.trip.name}</option>
      ))}
    </select>
  );
}
