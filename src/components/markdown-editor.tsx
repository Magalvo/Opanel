"use client";

import { useId, useState } from "react";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/**
 * A Markdown text area with Write and Preview (WS-038): Preview renders exactly as the page
 * does. `error` is shown under the field and describes it.
 */
export function MarkdownEditor({
  label,
  value,
  onChange,
  error = null,
  disabled = false,
  rows = 6,
}: Readonly<{
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  disabled?: boolean;
  rows?: number;
}>) {
  const id = useId();
  const [preview, setPreview] = useState(false);

  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          {label}
        </label>
        <div className="flex gap-1">
          <Button
            type="button"
            variant={preview ? "ghost" : "secondary"}
            size="sm"
            aria-pressed={!preview}
            onClick={() => {
              setPreview(false);
            }}
          >
            Write
          </Button>
          <Button
            type="button"
            variant={preview ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={preview}
            onClick={() => {
              setPreview(true);
            }}
          >
            Preview
          </Button>
        </div>
      </div>
      {preview ? (
        <div className="min-h-24 rounded-lg border p-3">
          {value.trim() === "" ? (
            <p className="text-sm text-muted-foreground">Nothing to preview.</p>
          ) : (
            <Markdown>{value}</Markdown>
          )}
        </div>
      ) : (
        <Textarea
          id={`${id}-text`}
          value={value}
          rows={rows}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : `${id}-error`}
        />
      )}
      {error !== null && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
