"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type Column,
  type ColumnCategory,
  columnCategorySchema,
  columnNameSchema,
} from "@/lib/schemas/columns";

import { addColumn, ApiFailure, deleteColumn, listColumns, moveColumn, updateColumn } from "./api";

const CATEGORY_LABELS: Record<ColumnCategory, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

function CategorySelect({
  label,
  value,
  disabled,
  onChange,
}: Readonly<{
  label: string;
  value: ColumnCategory;
  disabled: boolean;
  onChange: (category: ColumnCategory) => void;
}>) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const category = columnCategorySchema.safeParse(next);
        if (category.success && category.data !== value) onChange(category.data);
      }}
    >
      <SelectTrigger aria-label={label} className="w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {columnCategorySchema.options.map((option) => (
          <SelectItem key={option} value={option}>
            {CATEGORY_LABELS[option]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface RowProps {
  column: Column;
  first: boolean;
  last: boolean;
  disabled: boolean;
  onRename: (column: Column, name: string) => void;
  onCategory: (column: Column, category: ColumnCategory) => void;
  onMove: (column: Column, direction: "earlier" | "later") => void;
  onDelete: (column: Column) => void;
}

function ColumnRow({
  column,
  first,
  last,
  disabled,
  onRename,
  onCategory,
  onMove,
  onDelete,
}: Readonly<RowProps>) {
  // The row is keyed by the column's version, so a saved change starts it from the new name.
  const [name, setName] = useState(column.name);

  return (
    <li className="flex flex-wrap items-center gap-2">
      <Input
        aria-label={`Name of ${column.name}`}
        value={name}
        disabled={disabled}
        onChange={(event) => {
          setName(event.target.value);
        }}
        className="w-48"
        autoComplete="off"
      />
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || name === column.name}
        aria-label={`Rename ${column.name}`}
        onClick={() => {
          onRename(column, name);
        }}
      >
        Rename
      </Button>
      <CategorySelect
        label={`Category of ${column.name}`}
        value={column.category}
        disabled={disabled}
        onChange={(category) => {
          onCategory(column, category);
        }}
      />
      {!first && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Move ${column.name} earlier`}
          onClick={() => {
            onMove(column, "earlier");
          }}
        >
          <ArrowUpIcon aria-hidden="true" />
        </Button>
      )}
      {!last && (
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          aria-label={`Move ${column.name} later`}
          onClick={() => {
            onMove(column, "later");
          }}
        >
          <ArrowDownIcon aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={`Delete ${column.name}`}
        onClick={() => {
          onDelete(column);
        }}
      >
        Delete
      </Button>
    </li>
  );
}

export interface ColumnsSectionProps {
  projectId: string;
  archived: boolean;
  onMessage: (message: string) => void;
}

/**
 * The project's columns in board order (WS-036): add, rename, change category, move and
 * delete. Moving is by buttons, so it needs no drag-and-drop library yet (WI-037).
 */
export function ColumnsSection({ projectId, archived, onMessage }: Readonly<ColumnsSectionProps>) {
  const [columns, setColumns] = useState<Column[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<ColumnCategory>("todo");
  const [deleting, setDeleting] = useState<Column | null>(null);

  const load = useCallback(() => {
    return listColumns(projectId).then(
      (list) => {
        setColumns(list.items);
        setLoadFailed(false);
      },
      () => {
        setLoadFailed(true);
      },
    );
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function replace(updated: Column) {
    setColumns((current) =>
      (current ?? []).map((column) => (column.id === updated.id ? updated : column)),
    );
  }

  /** A stale version means someone else changed the columns: show them as they are now. */
  async function failed(failure: unknown, fallback: string) {
    if (failure instanceof ApiFailure && failure.code === "version_conflict") {
      await load();
      onMessage("Someone else changed the columns. The list was reloaded.");
    } else if (failure instanceof ApiFailure && failure.code === "project_archived") {
      onMessage("The project is archived, so its columns cannot be changed.");
    } else if (failure instanceof ApiFailure && failure.code === "last_done_column") {
      onMessage("A project needs at least one Done column.");
    } else if (failure instanceof ApiFailure && failure.code === "column_not_empty") {
      onMessage("This column still has tasks. Move or delete them first.");
    } else if (failure instanceof ApiFailure && failure.status === 404) {
      await load();
      onMessage("That column no longer exists. The list was reloaded.");
    } else {
      onMessage(fallback);
    }
  }

  async function add(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = columnNameSchema.safeParse(newName);
    if (!name.success) {
      onMessage("Enter a name for the column.");
      return;
    }
    try {
      const created = await addColumn(projectId, { name: name.data, category: newCategory });
      setColumns((current) => [...(current ?? []), created]);
      setNewName("");
      onMessage(`Added the column ${created.name}.`);
    } catch (failure) {
      await failed(failure, "Could not add the column. Try again.");
    }
  }

  async function rename(column: Column, text: string) {
    const name = columnNameSchema.safeParse(text);
    if (!name.success) {
      onMessage("A column name is required, up to 100 characters.");
      return;
    }
    try {
      const updated = await updateColumn(column.id, { name: name.data, version: column.version });
      replace(updated);
      onMessage(`Renamed the column to ${updated.name}.`);
    } catch (failure) {
      await failed(failure, "Could not rename the column. Try again.");
    }
  }

  async function changeCategory(column: Column, category: ColumnCategory) {
    try {
      const updated = await updateColumn(column.id, { category, version: column.version });
      replace(updated);
      onMessage(`Changed the category of ${updated.name} to ${CATEGORY_LABELS[category]}.`);
    } catch (failure) {
      await failed(failure, "Could not change the category. Try again.");
    }
  }

  async function move(column: Column, direction: "earlier" | "later") {
    const list = columns ?? [];
    const index = list.findIndex((other) => other.id === column.id);
    // The column the moved one is placed after; `null` places it first.
    const anchor =
      direction === "earlier" ? (list[index - 2]?.id ?? null) : (list[index + 1]?.id ?? null);
    try {
      const updated = await moveColumn(column.id, {
        afterColumnId: anchor,
        version: column.version,
      });
      setColumns((current) => {
        const without = (current ?? []).filter((other) => other.id !== column.id);
        const target = direction === "earlier" ? index - 1 : index + 1;
        return [...without.slice(0, target), updated, ...without.slice(target)];
      });
      onMessage(`Moved the column ${updated.name}.`);
    } catch (failure) {
      await failed(failure, "Could not move the column. Try again.");
    }
  }

  async function confirmDelete() {
    const column = deleting;
    setDeleting(null);
    if (column === null) return;
    try {
      await deleteColumn(column.id);
      setColumns((current) => (current ?? []).filter((other) => other.id !== column.id));
      onMessage(`Deleted the column ${column.name}.`);
    } catch (failure) {
      await failed(failure, "Could not delete the column. Try again.");
    }
  }

  return (
    <section aria-labelledby="columns-heading" className="grid gap-3">
      <h2 id="columns-heading" className="text-lg font-semibold">
        Columns
      </h2>
      {loadFailed && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load the columns.
          </p>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      )}
      {columns !== null && (
        <ul aria-label="Columns" className="grid gap-2">
          {columns.map((column, index) => (
            <ColumnRow
              key={`${column.id}:${String(column.version)}`}
              column={column}
              first={index === 0}
              last={index === columns.length - 1}
              disabled={archived}
              onRename={(target, text) => void rename(target, text)}
              onCategory={(target, category) => void changeCategory(target, category)}
              onMove={(target, direction) => void move(target, direction)}
              onDelete={setDeleting}
            />
          ))}
        </ul>
      )}

      <form onSubmit={(event) => void add(event)} className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="New column name"
          value={newName}
          disabled={archived}
          onChange={(event) => {
            setNewName(event.target.value);
          }}
          className="w-48"
          autoComplete="off"
        />
        <CategorySelect
          label="New column category"
          value={newCategory}
          disabled={archived}
          onChange={setNewCategory}
        />
        <Button type="submit" variant="outline" disabled={archived}>
          Add column
        </Button>
      </form>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this column?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting === null
                ? ""
                : `${deleting.name} is removed. A column that still has tasks cannot be deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
