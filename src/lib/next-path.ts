// Origin used only to check that a path stays inside the app. Never requested.
const PROBE_ORIGIN = "http://opanel.invalid";

function hasUnsafeCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || character === "\\") {
      return true;
    }
  }
  return false;
}

/**
 * The page to return to after signing in, if it is a path inside the app; otherwise `/`.
 * Guards against open redirects: `//host`, `/\\host`, absolute URLs and anything that is not
 * a single string are all rejected.
 */
export function safeNextPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }
  if (hasUnsafeCharacter(value) || /%5c/i.test(value)) {
    return "/";
  }
  try {
    if (new URL(value, PROBE_ORIGIN).origin !== PROBE_ORIGIN) {
      return "/";
    }
  } catch {
    return "/";
  }
  return value;
}
