import { useState } from "react";
import { Copy, Check, MessageSquare, Share2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onClose: () => void;
  tripName: string;
  tripUrl: string;
};

const BRASS = "hsl(42 52% 59%)";
const FOREST_ACCENT = "hsl(158 35% 20%)";
const INK = "hsl(38 30% 14%)";
const INK_SOFT = "hsl(38 20% 38%)";

export function ShareTripModal({ open, onClose, tripName, tripUrl }: Props) {
  const [copied, setCopied] = useState(false);

  const smsBody = `Join my golf trip "${tripName}" — live scoring + leaderboard: ${tripUrl}`;
  const smsHref = `sms:?&body=${encodeURIComponent(smsBody)}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(tripUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — leave the URL visible so user can long-press to copy.
    }
  }

  function handleNativeShare() {
    if (typeof navigator.share !== "function") return;
    void navigator.share({ url: tripUrl, text: smsBody, title: tripName }).catch(() => {});
  }

  const hasNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md" style={{ background: "hsl(42 45% 91%)" }}>
        <DialogHeader>
          <DialogTitle className="font-serif" style={{ color: INK }}>
            Invite to {tripName}
          </DialogTitle>
        </DialogHeader>

        <p className="font-sans text-xs" style={{ color: INK_SOFT }}>
          Anyone with the link can sign in and join as a player, or just watch the leaderboard.
        </p>

        {/* Link + copy */}
        <div className="flex items-center gap-2 rounded-lg p-2" style={{ background: "white", border: "1px solid hsl(38 25% 78%)" }}>
          <input
            readOnly
            value={tripUrl}
            onFocus={e => e.currentTarget.select()}
            className="flex-1 px-2 py-1.5 font-mono text-xs outline-none bg-transparent"
            style={{ color: INK }}
          />
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy link"
            className="inline-flex items-center gap-1 px-3 py-2 min-h-[40px] rounded-md font-sans text-xs font-semibold"
            style={{ background: copied ? FOREST_ACCENT : BRASS, color: copied ? BRASS : INK }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        {/* Action row */}
        <div className="flex flex-col gap-2 mt-2">
          <a
            href={smsHref}
            className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg font-sans font-semibold text-sm"
            style={{ background: FOREST_ACCENT, color: BRASS }}
          >
            <MessageSquare size={14} />
            Send by text
          </a>
          {hasNativeShare && (
            <button
              type="button"
              onClick={handleNativeShare}
              className="inline-flex items-center justify-center gap-2 py-2.5 rounded-lg font-sans font-semibold text-sm"
              style={{ background: "transparent", color: INK_SOFT, border: "1px dashed hsl(38 25% 72%)" }}
            >
              <Share2 size={14} />
              More share options
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
