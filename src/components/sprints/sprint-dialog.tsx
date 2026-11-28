"use client";

import { useEffect, useId, useState } from "react";

import { localDate } from "@/components/task/due-date";
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
import { Textarea } from "@/components/ui/textarea";
import { ApiFailure } from "@/lib/api-client";
import { type Sprint, sprintSchema, type UpdateSprintRequest } from "@/lib/schemas/sprints";

import { createSprint, listAllSprints, updateSprint } from "./api";
import { newSprintDefaults } from "./dates";

const CONFLICT =
  "Someone else changed this sprint. Their version is shown; make your change again.";

type Field = "name" | "goal" | "startDate" | "endDate";

const FIELDS: readonly Field[] = ["name", "goal", "startDate", "endDate"];

const LABELS: Record<Field, string> = {
  name: "Name",
  goal: "Goal",
  startDate: "Start date",
  endDate: "End date",
};

type Values = Record<Field, string>;

function valuesOf(sprint: Sprint): Values {
  return {
    name: sprint.name,
    goal: sprint.goal,
    startDate: sprint.startDate,
    endDate: sprint.endDate,
  };
}

function failureText(failure: unknown): string {
  const code = failure instanceof ApiFailure ? failure.code : null;
  if (code === "project_archived") return "The project is archived.";
  if (code === "sprint_completed") return "This sprint is completed and can no longer change.";
  if (code === "sprints_disabled") return "This project does not use sprints.";
  if (failure instanceof ApiFailure && failure.status === 404) return "This sprint was deleted.";
  return "Could not save the sprint. Try again.";
}

/**
 * Creates a sprint, or edits a planned or active one (WS-144 section 6): its name, goal and
 * dates, with each field's `400` under it. A new sprint starts as "Sprint N", the day after
 * the latest sprint ends, for 14 days (question 3). An edit sends what changed with the
 * version; a conflict shows the other person's version.
 */
export function SprintDialog({
  projectKey,
  sprint,
  returnFocusTo,
  onOpenChange,
  onSaved,
}: Readonly<{
  projectKey: string;
  /** The sprint to edit; `null` to create one. */
  sprint: Sprint | null;
  /** Without a dialog trigger, the element that gets the focus back on close. */
  returnFocusTo: HTMLElement | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (sprint: Sprint) => void;
}>) {
  const id = useId();
  const [basedOn, setBasedOn] = useState<Sprint | null>(sprint);
  const [values, setValues] = useState<Values>(
    sprint === null ? { name: "", goal: "", startDate: "", endDate: "" } : valuesOf(sprint),
  );
  const [ready, setReady] = useState(sprint !== null);
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A new sprint's defaults, from every sprint of the project.
  useEffect(() => {
    if (sprint !== null) return;
    let cancelled = false;
    const today = localDate(new Date());
    void listAllSprints(projectKey)
      .catch(() => [])
      .then((sprints) => {
        if (cancelled) return;
        const defaults = newSprintDefaults(sprints, today);
        setValues((current) => (current.name === "" ? { ...current, ...defaults } : current));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [projectKey, sprint]);

  function set(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  async function save(): Promise<Sprint | null> {
    if (basedOn === null) {
      return createSprint(projectKey, {
        name: values.name,
        ...(values.goal === "" ? {} : { goal: values.goal }),
        startDate: values.startDate,
        endDate: values.endDate,
      });
    }
    const changes: Omit<UpdateSprintRequest, "version"> = {};
    const held = valuesOf(basedOn);
    for (const field of FIELDS) {
      if (values[field] !== held[field]) changes[field] = values[field];
    }
    if (Object.keys(changes).length === 0) return null;
    return updateSprint(basedOn.id, { ...changes, version: basedOn.version });
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (values.name.trim() === "") {
      setErrors({ name: "Enter a name." });
      return;
    }
    setErrors({});
    setError(null);
    setPending(true);
    try {
      const saved = await save();
      if (saved !== null) onSaved(saved);
      onOpenChange(false);
    } catch (failure) {
      const current =
        failure instanceof ApiFailure && failure.code === "version_conflict"
          ? sprintSchema.safeParse((failure.body as { current?: unknown } | null)?.current)
          : null;
      if (current?.success) {
        setBasedOn(current.data);
        setValues(valuesOf(current.data));
        setError(CONFLICT);
        return;
      }
      const atFields: Partial<Record<Field, string>> = {};
      if (failure instanceof ApiFailure) {
        for (const item of failure.errors) {
          const field = FIELDS.find((name) => name === item.path);
          if (field !== undefined) atFields[field] ??= item.message;
        }
      }
      if (Object.keys(atFields).length > 0) {
        setErrors(atFields);
      } else {
        setError(failureText(failure));
      }
    } finally {
      setPending(false);
    }
  }

  function field(name: Field) {
    const fieldError = errors[name];
    const errorId = `${id}-${name}-error`;
    const common = {
      id: `${id}-${name}`,
      value: values[name],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        set(name, event.target.value);
      },
      "aria-invalid": fieldError === undefined ? undefined : true,
      "aria-describedby": fieldError === undefined ? undefined : errorId,
    };
    return (
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
          {LABELS[name]}
        </label>
        {name === "goal" ? (
          <Textarea {...common} />
        ) : (
          <Input
            {...common}
            type={name === "name" ? "text" : "date"}
            autoComplete="off"
            required={name !== "name" ? true : undefined}
          />
        )}
        {fieldError !== undefined && (
          <p id={errorId} className="text-sm text-destructive">
            {fieldError}
          </p>
        )}
      </div>
    );
  }

  const title = sprint === null ? "Create a sprint" : `Edit ${sprint.name}`;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {sprint === null
              ? "It starts planned. Drag tasks into it, then start it from the backlog."
              : "Its tasks stay where they are."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
          {field("name")}
          {field("goal")}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("startDate")}
            {field("endDate")}
          </div>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || !ready}>
              {sprint === null ? "Create sprint" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
