import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Trip = { id: number; name: string };

type Props = {
  trip: Trip | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (tripId: number) => void;
};

export function DeleteTripDialog({ trip, pending, onCancel, onConfirm }: Props) {
  const open = trip !== null;
  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && !pending) onCancel();
      }}
    >
      <AlertDialogContent
        className="border-0 shadow-2xl"
        style={{ background: "hsl(42 45% 91%)", color: "hsl(38 30% 14%)" }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle
            className="font-serif text-xl"
            style={{ color: "hsl(38 30% 14%)" }}
          >
            Delete "{trip?.name ?? ""}"?
          </AlertDialogTitle>
          <AlertDialogDescription
            className="font-sans text-sm"
            style={{ color: "hsl(38 20% 38%)" }}
          >
            This permanently deletes the trip along with every round, score, and
            player record attached to it. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="px-4 py-2.5 rounded-lg font-sans text-sm font-semibold transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: "hsl(42 20% 82%)", color: "hsl(38 30% 18%)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => trip && onConfirm(trip.id)}
            disabled={pending || !trip}
            className="px-4 py-2.5 rounded-lg font-sans text-sm font-semibold transition-opacity hover:opacity-85 disabled:opacity-60"
            style={{ background: "hsl(0 55% 38%)", color: "hsl(42 45% 95%)" }}
          >
            {pending ? "Deleting..." : "Delete trip"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
