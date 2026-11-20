import type { SubmitBugReportRequest } from "@/lib/schemas/bug-reports";

// The task description the triage pipeline renders from a bug report (WT-06 decision 8,
// WS-089 section 7). Pure. Headings are fixed; every value the agent sent goes in a fenced
// block it cannot close, so a report cannot add structure to the description.

/** The last line of a description that had to leave sections out. */
export const DESCRIPTION_CUT_NOTE =
  "The report is longer than a description holds; it is kept whole in the task's reports.";

/** Sections are added while the description stays under this many characters. */
const BUDGET = 49_800;

/** Control characters other than tab and newline, after `\r\n` and `\r` became `\n`. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

function clean(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(CONTROL, "");
}

/** A fenced `text` block whose fence is longer than any run of backticks in the value. */
export function fenced(value: string): string {
  const text = clean(value);
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${text}\n${fence}`;
}

/** A code span its value cannot close, for a short value inside a sentence. */
export function codeSpan(value: string): string {
  const text = clean(value).replace(/\n/g, " ");
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks} ${text} ${ticks}`;
}

function section(heading: string, ...blocks: string[]): string {
  return [`### ${heading}`, ...blocks].join("\n\n");
}

export function renderBugDescription(report: SubmitBugReportRequest): string {
  const evidence = report.evidence ?? {};
  const sections: string[] = [];

  if (report.summary !== undefined) sections.push(section("Summary", fenced(report.summary)));
  if (evidence.stepsToReproduce !== undefined && evidence.stepsToReproduce.length > 0) {
    sections.push(
      section(
        "Steps to reproduce",
        ...evidence.stepsToReproduce.map(
          (step, index) => `${String(index + 1)}.\n\n${fenced(step)}`,
        ),
      ),
    );
  }
  if (evidence.expected !== undefined)
    sections.push(section("Expected", fenced(evidence.expected)));
  if (evidence.actual !== undefined) sections.push(section("Actual", fenced(evidence.actual)));
  if (evidence.url !== undefined) sections.push(section("URL", fenced(evidence.url)));
  if (evidence.http !== undefined) {
    const { method, path, status, responseSnippet } = evidence.http;
    const blocks = [fenced(`${method} ${path} → ${String(status)}`)];
    if (responseSnippet !== undefined) blocks.push(fenced(responseSnippet));
    sections.push(section("HTTP", ...blocks));
  }
  if (evidence.consoleErrors !== undefined && evidence.consoleErrors.length > 0) {
    sections.push(section("Console errors", ...evidence.consoleErrors.map(fenced)));
  }
  if (evidence.diagnosis !== undefined) {
    sections.push(section("Diagnosis", fenced(evidence.diagnosis)));
  }

  const kept: string[] = [];
  let length = 0;
  for (const next of sections) {
    const added = (kept.length === 0 ? 0 : 2) + next.length;
    if (length + added > BUDGET) {
      kept.push(DESCRIPTION_CUT_NOTE);
      break;
    }
    kept.push(next);
    length += added;
  }
  return kept.join("\n\n");
}
