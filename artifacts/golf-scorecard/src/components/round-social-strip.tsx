import { useState } from "react";
import {
  useGetRoundSocial,
  useGiveKudos,
  useRevokeKudos,
  useCreateRoundComment,
  useDeleteRoundComment,
  getGetRoundSocialQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Heart, Trash2 } from "lucide-react";
import { useAuthSession } from "@/lib/auth";

export function RoundSocialStrip({ roundId }: { roundId: number }) {
  const session = useAuthSession();
  const qc = useQueryClient();
  const { data } = useGetRoundSocial(roundId);
  const give = useGiveKudos();
  const revoke = useRevokeKudos();
  const createComment = useCreateRoundComment();
  const deleteComment = useDeleteRoundComment();
  const [text, setText] = useState("");

  function invalidate() {
    qc.invalidateQueries({ queryKey: getGetRoundSocialQueryKey(roundId) });
  }
  function toggleKudos() {
    const mutate = data?.kudos.viewerHasKudosed ? revoke.mutate : give.mutate;
    mutate({ roundId }, { onSettled: invalidate });
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    createComment.mutate(
      { roundId, data: { body: text.trim() } },
      { onSuccess: () => { setText(""); invalidate(); } }
    );
  }

  if (!data) return null;
  return (
    <section className="rounded-2xl bg-card border border-card-border px-5 py-4">
      <div className="flex items-center gap-4 mb-3">
        <button
          type="button"
          onClick={toggleKudos}
          className="flex items-center gap-1 text-sm font-sans"
          style={{ color: data.kudos.viewerHasKudosed ? "hsl(var(--primary))" : "hsl(var(--muted-foreground))" }}
        >
          <Heart size={16} fill={data.kudos.viewerHasKudosed ? "currentColor" : "none"} />
          <span className="tabular-nums">{data.kudos.count}</span>
        </button>
        <div className="flex gap-1 text-xs font-sans text-muted-foreground">
          {data.kudos.recentUsers.slice(0, 3).map(u => (
            <Link key={u.id} href={`/users/${u.id}`} className="hover:underline">{u.fullName}</Link>
          ))}
          {data.kudos.count > 3 && <span>+{data.kudos.count - 3} more</span>}
        </div>
      </div>

      <ul className="space-y-2 mb-3">
        {data.comments.items.map(c => (
          <li key={c.id} className="flex items-start gap-2">
            <Link href={`/users/${c.userId}`} className="font-sans text-sm font-semibold text-card-foreground hover:underline shrink-0">
              {c.userFullName}
            </Link>
            <p className="font-sans text-sm text-card-foreground flex-1">{c.body}</p>
            {session?.user.id === c.userId && (
              <button
                type="button"
                onClick={() => deleteComment.mutate({ commentId: c.id }, { onSettled: invalidate })}
                aria-label="Delete comment"
                className="text-muted-foreground"
              >
                <Trash2 size={14} />
              </button>
            )}
          </li>
        ))}
        {data.comments.items.length === 0 && (
          <li className="text-xs font-sans text-muted-foreground italic">Be the first to leave a comment.</li>
        )}
      </ul>

      {session && (
        <form onSubmit={submit} className="flex gap-2">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Add a comment…"
            maxLength={1000}
            className="flex-1 px-3 py-2 rounded-lg bg-popover text-card-foreground text-sm font-sans"
            style={{ border: "1.5px solid hsl(var(--input))" }}
          />
          <button
            type="submit"
            disabled={!text.trim() || createComment.isPending}
            className="px-4 rounded-lg bg-primary text-primary-foreground text-sm font-sans font-semibold disabled:opacity-50"
          >
            Send
          </button>
        </form>
      )}
    </section>
  );
}
