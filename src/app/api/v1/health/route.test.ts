import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HealthResponse } from "@/lib/schemas/health";

const checkHealth = vi.fn<() => Promise<HealthResponse>>();

vi.mock("@/server/services/health", () => ({ checkHealth }));
vi.mock("@/server/db/client", () => ({ getDb: () => ({}) }));

const { GET } = await import("./route");

describe("GET /api/v1/health status mapping", () => {
  beforeEach(() => {
    checkHealth.mockReset();
  });

  it("returns 503 when the service reports degraded", async () => {
    checkHealth.mockResolvedValue({ status: "degraded", database: "down" });

    const response = await GET(new Request("http://localhost/api/v1/health"), undefined);

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("exposes only the two documented fields when degraded", async () => {
    checkHealth.mockResolvedValue({ status: "degraded", database: "down" });

    const response = await GET(new Request("http://localhost/api/v1/health"), undefined);

    expect(await response.json()).toStrictEqual({ status: "degraded", database: "down" });
  });

  it("returns 200 when the service reports ok", async () => {
    checkHealth.mockResolvedValue({ status: "ok", database: "up" });

    const response = await GET(new Request("http://localhost/api/v1/health"), undefined);

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ status: "ok", database: "up" });
  });
});
