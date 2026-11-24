"use client";

import { useId, useState } from "react";

import { AccountName } from "@/components/account-name";
import { Markdown } from "@/components/markdown";
import { MarkdownEditor } from "@/components/markdown-editor";
import { useProjectEventListener } from "@/components/projects/project-events";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { usePagedList } from "@/hooks/use-paged-list";
import type { ActivityItem, ActivityPage } from "@/lib/schemas/activity";
import { commentBodySchema } from "@/lib/schemas/comments";

import { ActivityLine } from "./activity-text";
import { addComment, listActivity } from "./api";

/** An activity item with the id the paged list keys it by. */
interface Shown {
  id: string;
  item: ActivityItem;
}

function shown(item: ActivityItem): Shown {
  return {
    id: item.kind === "comment" ? `comment:${item.comment.id}` : `event:${item.id}`,
    item,
  };
}

function toShown(page: ActivityPage) {
  return { items: page.items.map(shown), nextCursor: page.nextCursor };
}

/** The events of a task's own changes, which bring new activity (WS-119 section 5). */
const TASK_EVENTS = new Set([
  "task.updated",
  "task.moved",
  "task.deleted",
  "task.restored",
  "comment.created",
]);

/**
 * A task's activity: its comments and its changes, oldest first, and the form to add a
 * comment (WS-119, replacing the comments list of WS-038).
 */
export function ActivitySection({
  taskKey,
  taskId,
  initial,
  canComment,
  busy,
  setBusy,
  onAdded,
  onFailure,
}: Readonly<{
  taskKey: string;
  taskId: string;
  initial: ActivityPage;
  canComment: boolean;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onAdded: () => void;
  onFailure: (failure: unknown, fallback: string) => void;
}>) {
  const id = useId();
  const list = usePagedList<Shown>(toShown(initial));
  const { items, nextCursor: cursor, loadingMore } = list;
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [commentsOnly, setCommentsOnly] = useState(false);
  const now = new Date();

  /** Reads the activity again from the start, until `count` items or the end (WS-049). */
  async function reloadShown(count: number) {
    const read: Shown[] = [];
    let next: string | null = null;
    try {
      do {
        const page = await listActivity(taskKey, next ?? undefined);
        read.push(...page.items.map(shown));
        next = page.nextCursor;
      } while (next !== null && read.length < count);
      list.show({ items: read, nextCursor: next });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  // New activity appears once every page is shown; until then it comes with "Load more".
  // One's own comment is already shown, so its event reads nothing again.
  useProjectEventListener({
    onEvent: (event) => {
      if (!TASK_EVENTS.has(event.type)) return;
      const own =
        event.type === "comment.created" ? event.taskId === taskId : event.entityId === taskId;
      if (!own || cursor !== null) return;
      if (
        event.type === "comment.created" &&
        items.some((entry) => entry.id === `comment:${event.entityId}`)
      ) {
        return;
      }
      void reloadShown(Number.POSITIVE_INFINITY);
    },
    onReconnect: () => void reloadShown(items.length),
  });

  async function loadMore() {
    try {
      await list.loadMore(async (next) => toShown(await listActivity(taskKey, next)));
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
      // Its event may have brought it in already (WS-049). If "Load more" returns it later,
      // it moves to its place there, once (WS-080).
      list.add(shown({ kind: "comment", comment: added }));
      setBody("");
      onAdded();
    } catch (failure) {
      onFailure(failure, "Could not add the comment. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const visible = commentsOnly ? items.filter((entry) => entry.item.kind === "comment") : items;

  return (
    <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-heading`} className="font-semibold">
          Activity
        </h3>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={commentsOnly}
            onCheckedChange={setCommentsOnly}
            aria-label="Comments only"
          />
          Comments only
        </label>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {commentsOnly ? "No comments yet." : "No activity yet."}
        </p>
      ) : (
        <ol className="grid gap-3">
          {visible.map(({ id: key, item }) => (
            <li key={key} className="min-w-0">
              {item.kind === "comment" ? (
                <article className="grid min-w-0 gap-1 rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {item.comment.author === null ? (
                        "Opanel"
                      ) : (
                        <AccountName account={item.comment.author} />
                      )}
                    </span>{" "}
                    · {new Date(item.comment.createdAt).toLocaleString()}
                  </p>
                  <Markdown>{item.comment.body}</Markdown>
                </article>
              ) : (
                <ActivityLine event={item} now={now} />
              )}
            </li>
          ))}
        </ol>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load more activity.
        </p>
      )}
      {cursor !== null && (
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
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
