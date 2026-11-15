"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The field at the foot of a column. `onAdd` answers whether the task was created; only then
 * is the field cleared, and it keeps focus so several tasks can be typed in a row.
 */
export function AddTaskForm({
  columnName,
  onAdd,
}: Readonly<{ columnName: string; onAdd: (title: string) => Promise<boolean> }>) {
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second Enter while the first is on its way must not create the task twice.
    if (pending) return;
    const submitted = title;
    setPending(true);
    try {
      if (await onAdd(submitted)) {
        // Only if nothing was typed meanwhile: a fast typist's next title is not wiped.
        setTitle((current) => (current === submitted ? "" : current));
      }
    } finally {
      setPending(false);
      field.current?.focus();
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex gap-1.5" noValidate>
      <Input
        ref={field}
        aria-label={`Add a task to ${columnName}`}
        placeholder="Add a task"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        autoComplete="off"
      />
      <Button
        type="submit"
        variant="outline"
        size="sm"
        disabled={pending}
        aria-label={`Add to ${columnName}`}
      >
        Add
      </Button>
    </form>
  );
}
