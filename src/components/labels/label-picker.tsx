"use client";

import { XIcon } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiFailure } from "@/lib/api-client";
import type { Label, LabelRef } from "@/lib/schemas/labels";

import { createLabel } from "./api";
import { LabelChip } from "./label-chip";

/**
 * The task's labels in its edit form (WS-108 section 3): the chosen ones as chips, each with
 * a remove button, and a list of the project's labels to tick, filtered by a text box. With
 * `labels:write`, a name no label has can be created there; it is created at once and
 * chosen, and the task changes only when the form is saved.
 */
export function LabelPicker({
  projectKey,
  labels,
  held,
  value,
  onChange,
  canCreate,
  onCreated,
  reloadLabels,
  disabled,
  error,
}: Readonly<{
  projectKey: string;
  /** The project's labels, by name. */
  labels: readonly Label[];
  /** The task's labels as last read, for names the project's list does not have yet. */
  held: readonly LabelRef[];
  /** The chosen label ids, in the order they were chosen. */
  value: readonly string[];
  onChange: (ids: string[]) => void;
  canCreate: boolean;
  onCreated: (label: Label) => void;
  reloadLabels: () => Promise<readonly Label[]>;
  disabled: boolean;
  error: string | null;
}>) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const known = new Map<string, Pick<LabelRef, "name" | "colour">>(
    held.map((label) => [label.id, label]),
  );
  for (const label of labels) known.set(label.id, label);
  const chosen = new Set(value);
  const wanted = query.trim().toLowerCase();
  const shown = labels.filter((label) => label.name.toLowerCase().includes(wanted));
  const exists = labels.some((label) => label.name.toLowerCase() === wanted);
  const offerCreate = canCreate && wanted !== "" && !exists;

  function toggle(labelId: string) {
    onChange(chosen.has(labelId) ? value.filter((each) => each !== labelId) : [...value, labelId]);
  }

  function choose(labelId: string) {
    if (!chosen.has(labelId)) onChange([...value, labelId]);
  }

  async function create() {
    const name = query.trim();
    setCreating(true);
    setProblem(null);
    try {
      const label = await createLabel(projectKey, { name, colour: "gray" });
      onCreated(label);
      choose(label.id);
      setQuery("");
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.code === "label_name_taken") {
        // Someone else made it meanwhile: choose theirs.
        const fresh = await reloadLabels().catch(() => []);
        const same = fresh.find((label) => label.name.toLowerCase() === name.toLowerCase());
        if (same !== undefined) {
          choose(same.id);
          setQuery("");
          return;
        }
      }
      setProblem(
        failure instanceof ApiFailure && failure.code === "too_many_labels"
          ? "This project already has 200 labels."
          : "Could not create the label. Try again.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div role="group" aria-labelledby={`${id}-label`} className="grid min-w-0 gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">
        Labels
      </span>
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">No labels.</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {value.map((labelId) => {
            const label = known.get(labelId);
            if (label === undefined) return null;
            return (
              <li key={labelId} className="inline-flex min-w-0 items-center gap-0.5">
                <LabelChip label={label} />
                <button
                  type="button"
                  aria-label={`Remove label ${label.name}`}
                  disabled={disabled}
                  onClick={() => {
                    onChange(value.filter((each) => each !== labelId));
                  }}
                  className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <XIcon aria-hidden="true" className="size-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          disabled={disabled}
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          Choose labels
        </Button>
      </div>
      {open && (
        <div id={`${id}-list`} className="grid gap-2 rounded-lg border p-2">
          <Input
            aria-label={canCreate ? "Find or create a label" : "Find a label"}
            value={query}
            maxLength={40}
            disabled={disabled}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              // Enter would submit the task's form.
              if (event.key === "Enter") {
                event.preventDefault();
                if (offerCreate) void create();
              }
            }}
          />
          {shown.length === 0 && !offerCreate ? (
            <p className="text-sm text-muted-foreground">No labels match.</p>
          ) : (
            <ul className="grid max-h-48 gap-1 overflow-y-auto">
              {shown.map((label) => (
                <li key={label.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={chosen.has(label.id)}
                      disabled={disabled}
                      onChange={() => {
                        toggle(label.id);
                      }}
                      aria-label={label.name}
                      className="size-4"
                    />
                    <LabelChip label={label} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          {offerCreate && (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled || creating}
                onClick={() => void create()}
              >
                {`Create label "${query.trim()}"`}
              </Button>
            </div>
          )}
          {problem !== null && <p className="text-sm text-destructive">{problem}</p>}
        </div>
      )}
      {error !== null && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
