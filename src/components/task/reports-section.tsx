"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { AccountName } from "@/components/account-name";
import { useProjectEventListener } from "@/components/projects/project-events";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePagedList } from "@/hooks/use-paged-list";
import type { Page } from "@/lib/paged-list";
import type { BugReport } from "@/lib/schemas/task-bug-reports";

import { listBugReports } from "./api";
import { confidenceText, LAYER_LABELS, OUTCOME_LABELS, SEVERITY_LABELS } from "./bug-labels";

const TEXT = "min-w-0 whitespace-pre-wrap break-words";
const PRE = "max-w-full overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs";

function Field({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/**
 * What the agent sent beyond the title, as plain text: never Markdown, and the URL is not a
 * link (WS-091 section 5, question 3). React escapes text, so nothing becomes markup.
 */
function Evidence({ report }: Readonly<{ report: BugReport }>) {
  const { summary, evidence } = report;
  if (summary === null && evidence === null) return null;
  return (
    <details className="min-w-0 text-sm">
      <summary className="cursor-pointer rounded-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        Evidence
      </summary>
      <div className="mt-2 grid min-w-0 gap-2">
        {summary !== null && (
          <Field label="Summary">
            <p className={TEXT}>{summary}</p>
          </Field>
        )}
        {evidence?.stepsToReproduce !== undefined && (
          <Field label="Steps to reproduce">
            <ol className="ml-5 list-decimal">
              {evidence.stepsToReproduce.map((step, index) => (
                // The steps are an ordered list the agent sent; equal steps may repeat.
                <li key={index} className={TEXT}>
                  {step}
                </li>
              ))}
            </ol>
          </Field>
        )}
        {evidence?.expected !== undefined && (
          <Field label="Expected">
            <p className={TEXT}>{evidence.expected}</p>
          </Field>
        )}
        {evidence?.actual !== undefined && (
          <Field label="Actual">
            <p className={TEXT}>{evidence.actual}</p>
          </Field>
        )}
        {evidence?.url !== undefined && (
          <Field label="URL">
            <p className={`${TEXT} break-all`}>{evidence.url}</p>
          </Field>
        )}
        {evidence?.http !== undefined && (
          <Field label="HTTP">
            <p
              className={`${TEXT} font-mono text-xs break-all`}
            >{`${evidence.http.method} ${evidence.http.path} → ${String(evidence.http.status)}`}</p>
            {evidence.http.responseSnippet !== undefined && (
              <pre className={PRE}>{evidence.http.responseSnippet}</pre>
            )}
          </Field>
        )}
        {evidence?.consoleErrors !== undefined && (
          <Field label="Console errors">
            {evidence.consoleErrors.map((error, index) => (
              <pre key={index} className={PRE}>
                {error}
              </pre>
            ))}
          </Field>
        )}
        {evidence?.diagnosis !== undefined && (
          <Field label="Diagnosis">
            <p className={TEXT}>{evidence.diagnosis}</p>
          </Field>
        )}
      </div>
    </details>
  );
}

function Report({ report }: Readonly<{ report: BugReport }>) {
  return (
    <article className="grid min-w-0 gap-2 rounded-lg border p-3">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          <AccountName account={report.agent} />
        </span>
        <span>· {new Date(report.createdAt).toLocaleString()}</span>
        <Badge variant="outline">{OUTCOME_LABELS[report.outcome]}</Badge>
      </p>
      <p className="min-w-0 font-medium break-words">{report.title}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Layer</dt>
        <dd>{LAYER_LABELS[report.originLayer]}</dd>
        <dt className="text-muted-foreground">Confidence</dt>
        <dd>{confidenceText(report.confidence)}</dd>
        <dt className="text-muted-foreground">Severity</dt>
        <dd>{SEVERITY_LABELS[report.severity]}</dd>
        <dt className="text-muted-foreground">Run</dt>
        <dd className="min-w-0 break-all">{report.runId ?? "None"}</dd>
        <dt className="text-muted-foreground">Fingerprint</dt>
        <dd className="min-w-0 font-mono break-all">{report.fingerprint}</dd>
      </dl>
      <Evidence report={report} />
    </article>
  );
}

/**
 * The reports behind a task, newest first, 10 at a time (WS-091 section 5). `initial` is
 * the first page read with the task, or `null` to read it here. A new `marker` (the task's
 * count and last report time) or a reconnect reads the shown reports again (section 6).
 */
export function ReportsSection({
  taskKey,
  initial,
  marker,
}: Readonly<{
  taskKey: string;
  initial: Page<BugReport> | null;
  marker: string;
}>) {
  const id = useId();
  const list = usePagedList<BugReport>(initial ?? undefined);
  const { items: reports, nextCursor: cursor, loadingMore } = list;
  const [loadError, setLoadError] = useState(false);
  const shown = useRef({ marker, count: reports.length });
  useEffect(() => {
    shown.current.count = reports.length;
  });

  /** Reads from the start until at least `count` reports are read or there are no more. */
  async function reloadShown(count: number) {
    const read: BugReport[] = [];
    let next: string | null = null;
    try {
      do {
        const page = await listBugReports(taskKey, next ?? undefined);
        read.push(...page.items);
        next = page.nextCursor;
      } while (next !== null && read.length < count);
      list.show({ items: read, nextCursor: next });
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  const reload = useRef(reloadShown);
  useEffect(() => {
    reload.current = reloadShown;
  });

  useEffect(() => {
    if (initial === null) void reload.current(1);
  }, [initial]);

  useEffect(() => {
    if (shown.current.marker === marker) return;
    shown.current.marker = marker;
    void reload.current(Math.max(shown.current.count, 1));
  }, [marker]);

  useProjectEventListener({
    onReconnect: () => void reloadShown(Math.max(reports.length, 1)),
  });

  async function loadMore() {
    try {
      await list.loadMore((next) => listBugReports(taskKey, next));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} className="grid min-w-0 gap-3">
      <h3 id={`${id}-heading`} className="font-semibold">
        Reports
      </h3>
      {reports.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reports yet.</p>
      ) : (
        <div className="grid min-w-0 gap-3">
          {reports.map((report) => (
            <Report key={report.id} report={report} />
          ))}
        </div>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load more reports.
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
    </section>
  );
}
