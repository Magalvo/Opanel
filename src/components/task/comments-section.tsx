"use client";

import { useId, useState } from "react";

import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useProjectEventListener } from "@/components/projects/project-events";
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
  taskId,
  initial,
  initialCursor,
  canComment,
  busy,
  setBusy,
  onAdded,
  onFailure,
}: Readonly<{
  taskKey: string;
  taskId: string;
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

  /**
   * Reads the comments again from the start, until at least `count` are read or there are
   * no more (WS-049 section 3).
   */
  async function reloadShown(count: number) {
    const read: Comment[] = [];
    let next: string | null = null;
    try {
      do {
        const page = await listComments(taskKey, next ?? undefined);
        read.push(...page.items);
        next = page.nextCursor;
      } while (next !== null && read.length < count);
      setComments(read);
      setCursor(next);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  // A comment someone else added appears once every page is shown; until then it comes
  // with "Load more". One's own comment is already shown, so it is not read again.
  useProjectEventListener({
    onEvent: (event) => {
      if (event.type !== "comment.created" || event.taskId !== taskId) return;
      if (cursor !== null || comments.some((item) => item.id === event.entityId)) return;
      void reloadShown(Number.POSITIVE_INFINITY);
    },
    onReconnect: () => void reloadShown(comments.length),
  });

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
      // Its event may have brought it in already (WS-049).
      setComments((current) =>
        current.some((item) => item.id === added.id) ? current : [...current, added],
      );
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
