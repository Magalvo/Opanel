"use client";

import { useEffect, useState } from "react";

import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { Button } from "@/components/ui/button";
import type { Comment } from "@/lib/schemas/comments";

import { addComment, listComments } from "./api";

export interface CommentsSectionProps {
  taskKey: string;
  canComment: boolean;
  onMessage: (message: string) => void;
}

/** A task's comments, oldest first, and a form to add one (WS-038). They are never edited. */
export function CommentsSection({
  taskKey,
  canComment,
  onMessage,
}: Readonly<CommentsSectionProps>) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listComments(taskKey).then(
      (page) => {
        if (cancelled) return;
        setComments(page.items);
        setNextCursor(page.nextCursor);
      },
      () => {
        if (!cancelled) setLoadFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [taskKey]);

  async function loadMore() {
    if (nextCursor === null) return;
    try {
      const page = await listComments(taskKey, nextCursor);
      setComments((current) => [...(current ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      onMessage("Could not load more comments. Try again.");
    }
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft.trim() === "") {
      onMessage("Write something first.");
      return;
    }
    setPending(true);
    try {
      const created = await addComment(taskKey, draft);
      setComments((current) => [...(current ?? []), created]);
      setDraft("");
      onMessage("Added your comment.");
    } catch {
      onMessage("Could not add the comment. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="comments-heading" className="grid gap-3">
      <h2 id="comments-heading" className="text-lg font-semibold">
        Comments
      </h2>
      {loadFailed && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the comments.
        </p>
      )}
      {comments !== null && comments.length === 0 && (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      )}
      {comments !== null && comments.length > 0 && (
        <ul aria-label="Comments" className="grid gap-3">
          {comments.map((comment) => (
            <li key={comment.id} className="grid gap-1 rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  {comment.author?.name ?? "System"}
                </span>{" "}
                · {new Date(comment.createdAt).toLocaleString()}
              </p>
              <Markdown>{comment.body}</Markdown>
            </li>
          ))}
        </ul>
      )}
      {nextCursor !== null && (
        <div>
          <Button variant="outline" size="sm" onClick={() => void loadMore()}>
            Load more comments
          </Button>
        </div>
      )}
      {canComment && (
        <form onSubmit={(event) => void submit(event)} className="grid gap-2" noValidate>
          <MarkdownEditor noun="comment" label="New comment" value={draft} onChange={setDraft} />
          <div>
            <Button type="submit" disabled={pending}>
              Add comment
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
