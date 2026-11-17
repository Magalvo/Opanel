// What the sign-in page may say above its form, chosen by the `notice` query value (WS-057).
// An allowlist: the value only selects a fixed message, so nothing from the URL is rendered.

const NOTICES: Readonly<Record<string, string>> = {
  "password-set": "Your password is set. Sign in with it.",
  "admin-created": "The administrator was created. Sign in with your password.",
};

/** The message for a `notice` query value, or null for anything else. */
export function signInNotice(value: string | string[] | undefined): string | null {
  if (typeof value !== "string" || !Object.hasOwn(NOTICES, value)) return null;
  return NOTICES[value] ?? null;
}
