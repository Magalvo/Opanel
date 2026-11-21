import { z } from "zod";

// The server's configuration: two environment variables, validated at start (doc 0005
// section 6, hard rule 4). Messages name the variable and never quote its value.

export interface Config {
  /** The Opanel base URL, without a trailing `/`. */
  url: string;
  /** The agent's API token, `opk_…`. */
  token: string;
}

export type ConfigResult =
  | { ok: true; config: Config; warning: string | null }
  | { ok: false; message: string };

/** The token format of doc 0001 section 4: `opk_`, a public id and a secret. */
const TOKEN_PATTERN = /^opk_[a-z2-7]{12}_[0-9a-f]{64}$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const urlSchema = z
  .string()
  .transform((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "not a URL" });
      return z.NEVER;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({ code: "custom", message: "not http(s)" });
      return z.NEVER;
    }
    if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
      context.addIssue({ code: "custom", message: "has a query, fragment or credentials" });
      return z.NEVER;
    }
    return url;
  });

const tokenSchema = z.string().regex(TOKEN_PATTERN);

export function readConfig(env: Readonly<Record<string, string | undefined>>): ConfigResult {
  const url = urlSchema.safeParse(env.OPANEL_URL);
  if (!url.success) {
    return {
      ok: false,
      message:
        "OPANEL_URL is missing or not a valid http(s) URL without a query or fragment, " +
        "for example https://opanel.your-company.com.",
    };
  }
  const token = tokenSchema.safeParse(env.OPANEL_TOKEN);
  if (!token.success) {
    return {
      ok: false,
      message:
        "OPANEL_TOKEN is missing or not an Opanel agent token (opk_…). Create one for the " +
        "agent account in Opanel and set it in the assistant's MCP configuration.",
    };
  }

  const base = url.data.href.replace(/\/+$/, "");
  const warning =
    url.data.protocol === "http:" && !LOCAL_HOSTS.has(url.data.hostname)
      ? `Warning: OPANEL_URL uses plain http to ${url.data.hostname}; the token travels ` +
        "unencrypted. Use https unless this is a private network you trust."
      : null;

  return { ok: true, config: { url: base, token: token.data }, warning };
}
