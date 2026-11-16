"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { type ColumnCategory, columnCategorySchema, columnNameSchema } from "@/lib/schemas/columns";

import { CATEGORY_LABELS } from "./api";

export interface ColumnDraft {
  name: string;
  category: ColumnCategory;
}

/**
 * The dialog that asks for a column's name and category, to add or to edit a column. It
 * closes once `onSubmit` has finished; the caller announces the outcome.
 */
export function ColumnDialog({
  open,
  onOpenChange,
  title,
  submitLabel,
  initial,
  onSubmit,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  submitLabel: string;
  initial: ColumnDraft;
  onSubmit: (draft: ColumnDraft) => Promise<void>;
}>) {
  const id = useId();
  const [name, setName] = useState(initial.name);
  const [category, setCategory] = useState<ColumnCategory>(initial.category);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = columnNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(name.trim() === "" ? "Enter a name." : "Use at most 100 characters.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({ name: parsed.data, category });
    } finally {
      setPending(false);
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Tasks in a Done column count as finished.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-name`} className="text-sm font-medium">
              Name
            </label>
            <Input
              id={`${id}-name`}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              aria-invalid={error === null ? undefined : true}
              aria-describedby={error === null ? undefined : `${id}-name-error`}
              autoComplete="off"
            />
            {error !== null && (
              <p id={`${id}-name-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${id}-category`} className="text-sm font-medium">
              Category
            </label>
            <select
              id={`${id}-category`}
              value={category}
              onChange={(event) => {
                setCategory(columnCategorySchema.parse(event.target.value));
              }}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
            >
              {columnCategorySchema.options.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABELS[option]}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
