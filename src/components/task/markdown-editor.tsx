"use client";

import { useState } from "react";

import { Markdown } from "@/components/markdown";
import { Textarea } from "@/components/ui/textarea";

export interface MarkdownEditorProps {
  /** "description" or "comment": names the two tabs ("Write description"). */
  noun: string;
  /** The accessible name of the text box ("Description", "New comment"). */
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

const TAB =
  "rounded-md px-2 py-1 text-xs font-medium aria-selected:bg-muted aria-selected:text-foreground text-muted-foreground";

/** A text box with a Write and a Preview tab; the preview is the page's own Markdown rendering. */
export function MarkdownEditor({
  noun,
  label,
  value,
  onChange,
  disabled = false,
}: Readonly<MarkdownEditorProps>) {
  const [preview, setPreview] = useState(false);

  return (
    <div className="grid gap-1.5">
      <div role="tablist" aria-label={`${label} editor`} className="flex gap-1">
        <button
          type="button"
          role="tab"
          aria-selected={!preview}
          className={TAB}
          onClick={() => {
            setPreview(false);
          }}
        >
          <span className="sr-only">Write {noun}</span>
          <span aria-hidden="true">Write</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={preview}
          className={TAB}
          onClick={() => {
            setPreview(true);
          }}
        >
          <span className="sr-only">Preview {noun}</span>
          <span aria-hidden="true">Preview</span>
        </button>
      </div>
      {preview ? (
        <div className="min-h-20 rounded-lg border p-2">
          {value.trim() === "" ? (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          ) : (
            <Markdown>{value}</Markdown>
          )}
        </div>
      ) : (
        <Textarea
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </div>
  );
}
