/**
 * Test support for `routes.test.ts` (WS-023): reads the text of route handler files and
 * says which of the calls every handler must make are missing. It looks at text, not
 * types, so it catches a forgotten check, not a misplaced one; the integration tests of
 * each endpoint remain the proof of behaviour. Not imported by the app.
 */

const HANDLER_EXPORT =
  /^export\s+(?:const|(?:async\s+)?function)\s+(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/;
const ANY_EXPORT = /^export\s/;
const STATE_CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

export interface ExportedHandler {
  method: string;
  /** From the `export` of this method up to the next top-level `export`, or the end. */
  source: string;
}

/** The HTTP method handlers a route file exports, each with its own text. */
export function exportedHandlers(source: string): ExportedHandler[] {
  const handlers: ExportedHandler[] = [];
  let current: { method: string; lines: string[] } | undefined;

  const close = (): void => {
    if (current) {
      handlers.push({ method: current.method, source: current.lines.join("\n") });
      current = undefined;
    }
  };

  for (const line of source.split("\n")) {
    if (ANY_EXPORT.test(line)) {
      close();
      const method = HANDLER_EXPORT.exec(line)?.[1];
      if (method !== undefined) {
        current = { method, lines: [] };
      }
    }
    current?.lines.push(line);
  }
  close();
  return handlers;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

export interface HandlerToCheck {
  /** Route file, relative to `src/app/api`, for the message. */
  file: string;
  method: string;
  source: string;
  /** `public` of the operation's contract. */
  isPublic: boolean;
  /** Needs a session but no permission (a short list approved in a work-spec). */
  authenticationOnly: boolean;
}

/**
 * What the handler does not call but must (AGENTS.md hard rule 6, canonical doc 0004
 * section 7), one message per missing call. Empty when it is complete.
 */
export function missingChecks(handler: HandlerToCheck): string[] {
  const code = withoutComments(handler.source);
  const required: { call: string; why: string }[] = [];

  if (STATE_CHANGING_METHODS.includes(handler.method)) {
    required.push({
      call: "assertSameOrigin",
      why: "it changes state, so it must reject requests from other origins",
    });
  }
  if (!handler.isPublic) {
    required.push({
      call: "authenticate",
      why: "its contract is not public, so it must know who is calling",
    });
    if (!handler.authenticationOnly) {
      required.push({
        call: "requirePermission",
        why: "its contract is not public, so it must check a named permission",
      });
    }
  }

  return required
    .filter(({ call }) => !code.includes(`${call}(`))
    .map(({ call, why }) => `${handler.file}: ${handler.method} does not call ${call}(): ${why}.`);
}
