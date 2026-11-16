"use client";

import { useId } from "react";

import { MarkdownEditor } from "@/components/markdown-editor";
import { Input } from "@/components/ui/input";
import { epicTitleSchema } from "@/lib/schemas/epics";

/** What an epic's form holds; an empty date means "not set". */
export interface EpicDraft {
  title: string;
  description: string;
  startDate: string;
  targetDate: string;
}

export type EpicErrors = Partial<Record<keyof EpicDraft, string>>;

/** The checks made before any request: a title, and a target not before the start. */
export function checkEpic(draft: EpicDraft): EpicErrors {
  const errors: EpicErrors = {};
  if (!epicTitleSchema.safeParse(draft.title).success) {
    errors.title = draft.title.trim() === "" ? "Enter a title." : "Use at most 200 characters.";
  }
  if (draft.startDate !== "" && draft.targetDate !== "" && draft.targetDate < draft.startDate) {
    errors.targetDate = "The target date cannot be before the start date.";
  }
  return errors;
}

/** The API's field errors, by the form's field names. */
export function epicErrorsFrom(errors: readonly { path: string; message: string }[]): EpicErrors {
  const result: EpicErrors = {};
  for (const error of errors) {
    if (
      error.path === "title" ||
      error.path === "description" ||
      error.path === "startDate" ||
      error.path === "targetDate"
    ) {
      result[error.path] = error.message;
    }
  }
  return result;
}

/** Title, description (with a preview) and the two dates, for creating and editing. */
export function EpicFields({
  draft,
  errors,
  onChange,
}: Readonly<{
  draft: EpicDraft;
  errors: EpicErrors;
  onChange: (draft: EpicDraft) => void;
}>) {
  const id = useId();

  function field(name: "title" | "startDate" | "targetDate", label: string, type: string) {
    const error = errors[name];
    return (
      <div className="grid min-w-0 gap-1.5">
        <label htmlFor={`${id}-${name}`} className="text-sm font-medium">
          {label}
        </label>
        <Input
          id={`${id}-${name}`}
          type={type}
          value={draft[name]}
          autoComplete="off"
          onChange={(event) => {
            onChange({ ...draft, [name]: event.target.value });
          }}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={error === undefined ? undefined : `${id}-${name}-error`}
        />
        {error !== undefined && (
          <p id={`${id}-${name}-error`} className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      {field("title", "Title", "text")}
      <MarkdownEditor
        label="Description"
        value={draft.description}
        error={errors.description ?? null}
        onChange={(description) => {
          onChange({ ...draft, description });
        }}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {field("startDate", "Start date", "date")}
        {field("targetDate", "Target date", "date")}
      </div>
    </div>
  );
}
