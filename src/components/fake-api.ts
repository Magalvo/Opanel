// Test helpers for the pages that call the API: a fake `fetch` that answers by "METHOD url".
import { vi } from "vitest";

export const fetchMock = vi.fn<typeof fetch>();

const responses = new Map<string, () => Response>();
const held = new Map<string, Promise<Response>>();

export function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** Answers every request for `key` ("GET /api/v1/teams?limit=50") with `response`. */
export function on(key: string, response: () => Response): void {
  responses.set(key, response);
}

/**
 * Holds every request for `key` until the returned function is called with its answer, to
 * test what happens while it is pending.
 */
export function hold(key: string): (response: () => Response) => Promise<void> {
  let release: (response: Response) => void = () => undefined;
  held.set(
    key,
    new Promise<Response>((resolve) => {
      release = resolve;
    }),
  );
  return async (response) => {
    held.delete(key);
    release(response());
    // Lets the page handle the answer before the test goes on.
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
}

export function problem(status: number, code: string, errors?: unknown[]): () => Response {
  return () =>
    new Response(
      JSON.stringify({
        type: "about:blank",
        title: "Problem",
        status,
        code,
        detail: "A problem.",
        requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
        ...(errors === undefined ? {} : { errors }),
      }),
      { status, headers: { "Content-Type": "application/problem+json" } },
    );
}

export function calls(method: string): [string, RequestInit | undefined][] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === method)
    .map(([url, init]) => [urlOf(url), init]);
}

export function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === "string" ? init.body : "null");
}

/** Resets the fake and installs it as the global `fetch`. */
export function installFetch(): void {
  fetchMock.mockReset();
  responses.clear();
  held.clear();
  fetchMock.mockImplementation((input, init) => {
    const key = `${init?.method ?? "GET"} ${urlOf(input)}`;
    const waiting = held.get(key);
    if (waiting) return waiting;
    const respond = responses.get(key);
    if (!respond) return Promise.reject(new Error(`unexpected request: ${key}`));
    return Promise.resolve(respond());
  });
  vi.stubGlobal("fetch", fetchMock);
}
