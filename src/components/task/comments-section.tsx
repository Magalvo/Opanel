"use client";

import { useId, useState } from "react";

import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import type { Comment } from "@/lib/schemas/comments";
import { commentBodySchema } from "@/lib/schemas/comments";

import { addComment, listComments } from "./api";

/**
 * A task's comments, oldest first, as Markdown, and the form to add one (WS-038 section 2,
 * WT-03 question 2: comments are not edited or deleted).
 */
export function CommentsSection({
  taskKey,
  initial,
  initialCursor,
  canComment,
  busy,
  setBusy,
  onAdded,
  onFailure,
}: Readonly<{
  taskKey: string;
  initial: readonly Comment[];
  initialCursor: string | null;
  canComment: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onAdded: () => void;
  onFailure: (failure: unknown, fallback: string) => void;
}>) {
  const id = useId();
  const [comments, setComments] = useState<readonly Comment[]>(initial);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  async function loadMore() {
    if (cursor === null) return;
    try {
      const page = await listComments(taskKey, cursor);
      setComments((current) => [...current, ...page.items]);
      setCursor(page.nextCursor);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = commentBodySchema.safeParse(body);
    if (!parsed.success) {
      setError(body.trim() === "" ? "Write something." : "Use at most 10 000 characters.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const added = await addComment(taskKey, parsed.data);
      setComments((current) => [...current, added]);
      setBody("");
      onAdded();
    } catch (failure) {
      onFailure(failure, "Could not add the comment. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-3">
      <h3 id={`${id}-heading`} className="font-semibold">
        Comments
      </h3>
      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <div className="grid gap-3">
          {comments.map((comment) => (
            <article key={comment.id} className="grid min-w-0 gap-1 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {comment.author?.name ?? "Opanel"}
                </span>{" "}
                · {new Date(comment.createdAt).toLocaleString()}
              </p>
              <Markdown>{comment.body}</Markdown>
            </article>
          ))}
        </div>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load more comments.
        </p>
      )}
      {cursor !== null && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}
      {canComment && (
        <form onSubmit={(event) => void submit(event)} className="grid gap-2" noValidate>
          <MarkdownEditor
            label="New comment"
            value={body}
            error={error}
            rows={4}
            onChange={setBody}
          />
          <div>
            <Button type="submit" disabled={busy}>
              Add comment
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
