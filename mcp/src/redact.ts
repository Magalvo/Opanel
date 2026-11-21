// The token never leaves the server (doc 0005 section 6, hard rule 7). Every string the
// server writes passes through a redactor, a guard against an error that quotes a header.

export type Redactor = (text: string) => string;

export const REDACTED = "[redacted]";

export function createRedactor(token: string): Redactor {
  return (text) => (token === "" ? text : text.split(token).join(REDACTED));
}
