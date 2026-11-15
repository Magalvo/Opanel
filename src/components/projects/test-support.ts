import { vi } from "vitest";

import type { Column } from "@/lib/schemas/columns";
import type { Project } from "@/lib/schemas/projects";

/** Test helpers shared by the project component tests: a fetch double keyed by "METHOD url". */
export const fetchMock = vi.fn<typeof fetch>();
const responses = new Map<string, () => Response>();

export function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

export function on(key: string, response: () => Response) {
  responses.set(key, response);
}

export function installFetch() {
  fetchMock.mockReset();
  responses.clear();
  fetchMock.mockImplementation((input, init) => {
    const key = `${init?.method ?? "GET"} ${urlOf(input)}`;
    const respond = responses.get(key);
    if (!respond) throw new Error(`unexpected request: ${key}`);
    return Promise.resolve(respond());
  });
  vi.stubGlobal("fetch", fetchMock);
}

export function calls(method: string): [string, RequestInit | undefined][] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === method)
    .map(([url, init]) => [urlOf(url), init]);
}

export function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === "string" ? init.body : "null");
}

export function problem(status: number, body: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Problem",
      status,
      code: "invalid_request",
      detail: "A problem.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      ...body,
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

export const PROJECT_ID = "99999999-9999-4999-8999-999999999999";

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    key: "OPA",
    name: "Opanel",
    description: "The tracker.",
    archivedAt: null,
    version: 1,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
    ...overrides,
  };
}

export function column(
  id: string,
  name: string,
  category: Column["category"],
  version = 1,
): Column {
  return {
    id,
    projectId: PROJECT_ID,
    name,
    category,
    version,
    createdAt: "2026-11-12T10:00:00.000Z",
    updatedAt: "2026-11-12T10:00:00.000Z",
  };
}
