import { describe, expect, it } from "vitest";

import { readConfig } from "./config";
import { TOKEN } from "./testing";

// The two variables, validated at start (WS-099 tests 1 and 2).

describe("readConfig", () => {
  it("accepts a valid URL and token, without a trailing slash", () => {
    const result = readConfig({ OPANEL_URL: "https://opanel.example.com/", OPANEL_TOKEN: TOKEN });

    expect(result).toEqual({
      ok: true,
      config: { url: "https://opanel.example.com", token: TOKEN },
      warning: null,
    });
  });

  it.each<[Record<string, string>, string]>([
    [{ OPANEL_TOKEN: TOKEN }, "OPANEL_URL"],
    [{ OPANEL_URL: "", OPANEL_TOKEN: TOKEN }, "OPANEL_URL"],
    [{ OPANEL_URL: "ftp://opanel.example.com", OPANEL_TOKEN: TOKEN }, "OPANEL_URL"],
    [{ OPANEL_URL: "opanel.example.com", OPANEL_TOKEN: TOKEN }, "OPANEL_URL"],
    [{ OPANEL_URL: "https://opanel.example.com/?a=1", OPANEL_TOKEN: TOKEN }, "OPANEL_URL"],
    [{ OPANEL_URL: "https://opanel.example.com/#x", OPANEL_TOKEN: TOKEN }, "OPANEL_URL"],
    [{ OPANEL_URL: "https://opanel.example.com" }, "OPANEL_TOKEN"],
    [{ OPANEL_URL: "https://opanel.example.com", OPANEL_TOKEN: "" }, "OPANEL_TOKEN"],
    [{ OPANEL_URL: "https://opanel.example.com", OPANEL_TOKEN: `${TOKEN}x` }, "OPANEL_TOKEN"],
    [{ OPANEL_URL: "https://opanel.example.com", OPANEL_TOKEN: "Bearer abc" }, "OPANEL_TOKEN"],
  ])("refuses %j naming %s, never quoting the value", (env, variable) => {
    const result = readConfig(env);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(variable);
    const value = env[variable];
    if (value !== undefined && value.length > 0) expect(result.message).not.toContain(value);
    expect(result.message).not.toContain(TOKEN);
  });

  it("warns about plain http to another host, and only then", () => {
    const warned = readConfig({ OPANEL_URL: "http://opanel.internal:3000", OPANEL_TOKEN: TOKEN });
    expect(warned.ok && warned.warning).toMatch(/http.*opanel\.internal/);

    for (const url of [
      "https://opanel.internal",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://[::1]:3000",
    ]) {
      const result = readConfig({ OPANEL_URL: url, OPANEL_TOKEN: TOKEN });
      expect(result.ok && result.warning, url).toBeNull();
    }
  });
});
