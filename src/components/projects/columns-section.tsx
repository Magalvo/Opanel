"use client";

import { ArrowDownIcon, ArrowUpIcon, PencilIcon, Trash2Icon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiFailure } from "@/lib/api-client";
import type { Column } from "@/lib/schemas/columns";

import {
  CATEGORY_LABELS,
  createColumn,
  deleteColumn,
  listColumns,
  moveColumn,
  updateColumn,
} from "./api";
import { ColumnDialog, type ColumnDraft } from "./column-dialog";
import { useProjectEventListener } from "./project-events";
import { useProject } from "./project-frame";

const MESSAGES: Record<string, string> = {
  last_done_column: "A project needs at least one Done column.",
  column_not_empty: "Move or delete its tasks first.",
  version_conflict: "Someone else changed the columns. The list was refreshed.",
  project_archived: "The project is archived.",
};

function explain(failure: unknown, fallback: string): string {
  if (!(failure instanceof ApiFailure) || failure.code === null) return fallback;
  return MESSAGES[failure.code] ?? fallback;
}

/** A project's columns in board order: add, edit, move, delete (WS-036 section 5). */
export function ColumnsSection({
  announce,
  readOnly,
}: Readonly<{ announce: (message: string) => void; readOnly: boolean }>) {
  const id = useId();
  const { project } = useProject();
  const projectKey = project.key;
  const list = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<Column[] | null>(null);
  const [failedToLoad, setFailedToLoad] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Column | null>(null);
  const [deleting, setDeleting] = useState<Column | null>(null);

  const reload = useCallback(async () => {
    try {
      setColumns((await listColumns(projectKey)).items);
      setFailedToLoad(false);
    } catch {
      setFailedToLoad(true);
    }
  }, [projectKey]);

  useEffect(() => {
    let cancelled = false;
    listColumns(projectKey).then(
      (loaded) => {
        if (!cancelled) setColumns(loaded.items);
      },
      () => {
        if (!cancelled) setFailedToLoad(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectKey]);

  // Live (WS-049 section 5): someone else's column change, or a reconnect, reads the list
  // again. An open add or edit dialog is not touched.
  useProjectEventListener({
    onEvent: (event) => {
      if (event.type === "column.changed") void reload();
    },
    onReconnect: () => void reload(),
  });

  /** Runs a change, announces its outcome and reads the list again either way. */
  async function change(run: () => Promise<unknown>, success: string, fallback: string) {
    try {
      await run();
      announce(success);
    } catch (failure) {
      announce(explain(failure, fallback));
    }
    await reload();
  }

  async function move(column: Column, afterColumnId: string | null, direction: "up" | "down") {
    await change(
      () => moveColumn(column.id, afterColumnId, column.version),
      `Moved ${column.name} ${direction}.`,
      "Could not move the column. Try again.",
    );
    // Keep the keyboard where it was: on the moved column, if it can still move that way.
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>("button[aria-label]") ?? [];
    const again = [...buttons].find(
      (button) =>
        button.getAttribute("aria-label") === `Move ${column.name} ${direction}` ||
        button.getAttribute("aria-label") === `Edit ${column.name}`,
    );
    again?.focus();
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-heading`} className="text-lg font-semibold">
          Columns
        </h2>
        <Button
          variant="outline"
          disabled={readOnly || columns === null}
          onClick={() => {
            setAdding(true);
          }}
        >
          Add column
        </Button>
      </div>

      {failedToLoad && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the columns.
          </p>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </div>
      )}
      {columns === null && !failedToLoad && (
        <p className="text-sm text-muted-foreground">Loading columns…</p>
      )}

      {columns !== null && (
        <div ref={list}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Column</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {columns.map((column, index) => {
                const before = columns[index - 1];
                const after = columns[index + 1];
                return (
                  <TableRow key={column.id}>
                    <TableCell className="max-w-0 truncate">{column.name}</TableCell>
                    <TableCell>{CATEGORY_LABELS[column.category]}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${column.name}`}
                          disabled={readOnly}
                          onClick={() => {
                            setEditing(column);
                          }}
                        >
                          <PencilIcon aria-hidden="true" />
                        </Button>
                        {before === undefined ? (
                          <span className="size-7" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Move ${column.name} up`}
                            disabled={readOnly}
                            onClick={() => void move(column, columns[index - 2]?.id ?? null, "up")}
                          >
                            <ArrowUpIcon aria-hidden="true" />
                          </Button>
                        )}
                        {after === undefined ? (
                          <span className="size-7" />
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Move ${column.name} down`}
                            disabled={readOnly}
                            onClick={() => void move(column, after.id, "down")}
                          >
                            <ArrowDownIcon aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${column.name}`}
                          disabled={readOnly}
                          onClick={() => {
                            setDeleting(column);
                          }}
                        >
                          <Trash2Icon aria-hidden="true" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {adding && (
        <ColumnDialog
          open
          onOpenChange={setAdding}
          title="Add a column"
          submitLabel="Add column"
          initial={{ name: "", category: "todo" }}
          onSubmit={(draft: ColumnDraft) =>
            change(
              () => createColumn(projectKey, draft),
              `Added ${draft.name}.`,
              "Could not add the column. Try again.",
            )
          }
        />
      )}

      {editing !== null && (
        <ColumnDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          title="Edit column"
          submitLabel="Save"
          initial={{ name: editing.name, category: editing.category }}
          onSubmit={(draft: ColumnDraft) =>
            change(
              () => updateColumn(editing.id, { ...draft, version: editing.version }),
              `Saved ${draft.name}.`,
              "Could not save the column. Try again.",
            )
          }
        />
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        {deleting !== null && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {deleting.name}?</AlertDialogTitle>
              <AlertDialogDescription>Only an empty column can be deleted.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  const column = deleting;
                  setDeleting(null);
                  void change(
                    () => deleteColumn(column.id),
                    `Deleted ${column.name}.`,
                    "Could not delete the column. Try again.",
                  );
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
    </section>
  );
}
