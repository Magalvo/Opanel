import { describe, expect, it } from "vitest";

import { json, noContent } from "./route";

describe("json and noContent with extra headers", () => {
  it("add every Set-Cookie of the given headers and nothing else", () => {
    const extra = new Headers({ "X-Other": "no" });
    extra.append("Set-Cookie", "a=1; Path=/; HttpOnly");
    extra.append("Set-Cookie", "b=2; Path=/");

    const response = json({ ok: true }, 200, extra);

    expect(response.headers.getSetCookie()).toEqual(["a=1; Path=/; HttpOnly", "b=2; Path=/"]);
    expect(response.headers.get("X-Other")).toBeNull();
  });

  it("work on a 204 too", () => {
    const extra = new Headers();
    extra.append("Set-Cookie", "a=; Max-Age=0");

    const response = noContent(extra);

    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toEqual(["a=; Max-Age=0"]);
  });
});
