/** Prefix of every cookie Better Auth sets for Opanel (see `createAuth`). */
export const COOKIE_PREFIX = "opanel";

/** The session cookie: plain over http, `__Secure-` prefixed over https. */
export const SESSION_COOKIE_NAMES = [
  `${COOKIE_PREFIX}.session_token`,
  `__Secure-${COOKIE_PREFIX}.session_token`,
] as const;
