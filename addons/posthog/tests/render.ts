import { readFileSync } from "node:fs";

// Renders a webhook body the way PostHog's HTTP Webhook does for plain placeholders: each
// string value is a Hog f-string, so every `{a.b.c}` inside it is replaced by the value at
// that path of the alert's globals (WS-092 section 1). Only plain paths are supported, on
// purpose: the bodies must not rely on Hog expressions this helper cannot check.

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const PLACEHOLDER = /\{([^{}]*)\}/g;
const PLAIN_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;

export function readJson(url: URL): Json {
  return JSON.parse(readFileSync(url, "utf8")) as Json;
}

/** Every placeholder expression found in the string values of a body. */
export function placeholders(body: Json): string[] {
  if (typeof body === "string")
    return [...body.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
  if (Array.isArray(body)) return body.flatMap(placeholders);
  if (body !== null && typeof body === "object") return Object.values(body).flatMap(placeholders);
  return [];
}

export function isPlainPath(expression: string): boolean {
  return PLAIN_PATH.test(expression);
}

function lookup(globals: Json, path: string): Json | undefined {
  let current: Json | undefined = globals;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[key];
  }
  return current;
}

/** Renders `body` with `globals`; throws on an expression that is not a defined plain path. */
export function render(body: Json, globals: Json): Json {
  if (typeof body === "string") {
    return body.replace(PLACEHOLDER, (_match, expression: string) => {
      if (!isPlainPath(expression)) throw new Error(`Not a plain path: {${expression}}`);
      const value = lookup(globals, expression);
      if (value === undefined || value === null || typeof value === "object") {
        throw new Error(`No text value at {${expression}}`);
      }
      return String(value);
    });
  }
  if (Array.isArray(body)) return body.map((item) => render(item, globals));
  if (body !== null && typeof body === "object") {
    return Object.fromEntries(
      Object.entries(body).map(([key, value]) => [key, render(value, globals)]),
    );
  }
  return body;
}
