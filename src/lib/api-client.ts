// The browser's client for `/api/v1` (WS-020, shared since WS-035): every answer is parsed
// with the shared Zod schemas, and every failure becomes an `ApiFailure`.
import { type FieldError, problemSchema } from "@/lib/schemas/problem";

/** A non-2xx answer of the API, reduced to what the screen needs. */
export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly errors: readonly FieldError[],
    /** The whole problem body, for answers that carry more, such as a conflict's `current`. */
    readonly body: unknown = null,
  ) {
    super(`The API answered ${String(status)}.`);
    this.name = "ApiFailure";
  }
}

export async function failureOf(response: Response): Promise<ApiFailure> {
  const body: unknown = await response.json().catch(() => null);
  const problem = problemSchema.safeParse(body);
  return new ApiFailure(
    response.status,
    problem.success ? problem.data.code : null,
    problem.success ? (problem.data.errors ?? []) : [],
    body,
  );
}

export async function call<Schema extends { parse: (value: unknown) => unknown }>(
  url: string,
  init: RequestInit,
  schema: Schema,
): Promise<ReturnType<Schema["parse"]>> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw await failureOf(response);
  }
  const body: unknown = await response.json().catch(() => null);
  return schema.parse(body) as ReturnType<Schema["parse"]>;
}

/** For operations that answer `204` with no body. */
export async function callNoContent(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw await failureOf(response);
  }
}

export function jsonBody(body: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
