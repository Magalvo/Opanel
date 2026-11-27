// The Agents page's components (WS-077 tests 3 to 6), against a fake `/api/v1`.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Agent, ApiToken } from "@/lib/schemas/agents";

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { AgentsPage } = await import("./agents-page");
const { AgentDetail } = await import("./agent-detail");

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ONE = "11111111-1111-4111-8111-111111111111";
const TWO = "22222222-2222-4222-8222-222222222222";
const TOKEN = `opk_abcdefghijk2_${"a".repeat(64)}`;

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: AGENT_ID,
    name: "QA Bot",
    description: null,
    role: "qa_agent",
    scopes: ["comments:write", "projects:read", "reports:write", "tasks:read"],
    projectIds: null,
    status: "active",
    createdAt: "2026-11-19T10:00:00.000Z",
    lastSeenAt: null,
    ...overrides,
  };
}

function token(overrides: Partial<ApiToken> & { id: string; name: string }): ApiToken {
  return {
    createdAt: "2026-11-19T10:00:00.000Z",
    expiresAt: "2027-02-17T10:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    status: "active",
    ...overrides,
  };
}

function problem(status: number, code: string, errors?: { path: string; message: string }[]) {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Problem",
      status,
      code,
      detail: "A problem.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      ...(errors ? { errors } : {}),
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

const calls: Call[] = [];
const handlers: [string, (call: Call) => Response][] = [];

/** Answers `METHOD path-prefix` (the last matching handler wins). */
function on(key: string, answer: (call: Call) => Response) {
  handlers.unshift([key, answer]);
}

beforeEach(() => {
  calls.length = 0;
  handlers.length = 0;
  router.push.mockReset();
  on("GET /api/v1/projects", () =>
    Response.json({
      items: [
        {
          id: ONE,
          key: "ONE",
          name: "One",
          description: "",
          archivedAt: null,
          sprintsEnabled: false,
          version: 1,
          createdAt: "2026-11-19T10:00:00.000Z",
          updatedAt: "2026-11-19T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    }),
  );
  on("GET /api/v1/projects?limit=100&archived=true", () =>
    Response.json({
      items: [
        {
          id: TWO,
          key: "TWO",
          name: "Two",
          description: "",
          archivedAt: "2026-11-19T11:00:00.000Z",
          sprintsEnabled: false,
          version: 2,
          createdAt: "2026-11-19T10:00:00.000Z",
          updatedAt: "2026-11-19T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const url =
        new URL(input, "http://localhost").pathname + new URL(input, "http://localhost").search;
      const method = init.method ?? "GET";
      const call = {
        method,
        url,
        body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined,
      };
      calls.push(call);
      // A key with a query matches that query's start; one without matches the path exactly.
      const found = handlers.find(([key]) => {
        const [m, target = ""] = key.split(" ");
        if (m !== method) return false;
        return target.includes("?") ? url.startsWith(target) : url.split("?")[0] === target;
      });
      if (!found) throw new Error(`no handler for ${method} ${url}`);
      return Promise.resolve(found[1](call));
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AgentsPage (WS-077 test 3)", () => {
  it("lists agents with their role, status and last seen, and loads more", async () => {
    on("GET /api/v1/agents?limit=50", () =>
      Response.json({ items: [agent()], nextCursor: "next" }),
    );
    on("GET /api/v1/agents?limit=50&cursor=next", () =>
      Response.json({
        items: [agent({ id: ONE, name: "Worker", role: "worker_agent", status: "disabled" })],
        nextCursor: null,
      }),
    );
    render(<AgentsPage />);

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "QA Bot" })).toHaveAttribute(
      "href",
      `/agents/${AGENT_ID}`,
    );
    expect(within(table).getByText("QA agent")).toBeInTheDocument();
    expect(within(table).getByText("Never")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await within(table).findByText("Worker agent")).toBeInTheDocument();
    expect(within(table).getByText("Disabled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("shows an agent that comes back with a later page once (WS-080)", async () => {
    on("GET /api/v1/agents?limit=50", () =>
      Response.json({ items: [agent()], nextCursor: "next" }),
    );
    on("GET /api/v1/agents?limit=50&cursor=next", () =>
      Response.json({
        items: [agent(), agent({ id: ONE, name: "Worker", role: "worker_agent" })],
        nextCursor: null,
      }),
    );
    render(<AgentsPage />);
    const table = await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));

    expect(await within(table).findByRole("link", { name: "Worker" })).toBeInTheDocument();
    expect(within(table).getAllByRole("link", { name: "QA Bot" })).toHaveLength(1);
  });

  it("offers to create the first agent when there is none", async () => {
    on("GET /api/v1/agents", () => Response.json({ items: [], nextCursor: null }));
    render(<AgentsPage />);

    expect(await screen.findByText(/No agents yet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New agent" })).toBeInTheDocument();
  });
});

describe("the agent form (WS-077 test 4)", () => {
  async function openCreate() {
    on("GET /api/v1/agents", () => Response.json({ items: [], nextCursor: null }));
    render(<AgentsPage />);
    await userEvent.click(await screen.findByRole("button", { name: "New agent" }));
    return screen.findByRole("dialog");
  }

  it("starts with every scope of the role checked, and sends all projects as null", async () => {
    on("POST /api/v1/agents", () => Response.json(agent(), { status: 201 }));
    const dialog = await openCreate();

    expect(
      within(dialog)
        .getAllByRole("checkbox")
        .filter((box) => box.getAttribute("aria-checked") === "true"),
    ).toHaveLength(4);
    expect(
      within(dialog).queryByRole("checkbox", { name: /Create and edit tasks/ }),
    ).not.toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText("Name"), "QA Bot");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() => {
      expect(router.push).toHaveBeenCalledWith(`/agents/${AGENT_ID}`);
    });
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "QA Bot",
      description: null,
      role: "qa_agent",
      scopes: ["comments:write", "projects:read", "reports:write", "tasks:read"],
      projectIds: null,
    });
  });

  it("shows a worker's extra scope unchecked, and drops it again for a QA agent", async () => {
    const dialog = await openCreate();

    await userEvent.click(within(dialog).getByRole("radio", { name: /Worker agent/ }));
    const write = within(dialog).getByRole("checkbox", { name: /Create and edit tasks/ });
    expect(write).toHaveAttribute("aria-checked", "false");

    await userEvent.click(write);
    await userEvent.click(within(dialog).getByRole("radio", { name: /QA agent/ }));
    expect(
      within(dialog).queryByRole("checkbox", { name: /Create and edit tasks/ }),
    ).not.toBeInTheDocument();
  });

  it("sends only the chosen projects, archived ones marked", async () => {
    on("POST /api/v1/agents", () => Response.json(agent({ projectIds: [TWO] }), { status: 201 }));
    const dialog = await openCreate();

    await userEvent.type(within(dialog).getByLabelText("Name"), "Scoped");
    await userEvent.click(within(dialog).getByRole("radio", { name: "Only these projects" }));
    await userEvent.click(await within(dialog).findByRole("checkbox", { name: "Two (archived)" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));

    await waitFor(() => {
      expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({
        projectIds: [TWO],
      });
    });
  });

  it("shows a taken name and the server's field errors by their fields", async () => {
    on("POST /api/v1/agents", () => problem(409, "agent_name_taken"));
    const dialog = await openCreate();

    await userEvent.type(within(dialog).getByLabelText("Name"), "Taken");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));
    expect(
      await within(dialog).findByText("Another agent already has this name."),
    ).toBeInTheDocument();

    on("POST /api/v1/agents", () =>
      problem(400, "invalid_request", [
        { path: "projectIds", message: "Names a project that does not exist." },
      ]),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Create agent" }));
    expect(
      await within(dialog).findByText("Names a project that does not exist."),
    ).toBeInTheDocument();
  });

  it("edits sending only the fields that changed", async () => {
    on(`GET /api/v1/agents/${AGENT_ID}/tokens`, () =>
      Response.json({ items: [], nextCursor: null }),
    );
    on(`GET /api/v1/agents/${AGENT_ID}`, () => Response.json(agent()));
    on(`PATCH /api/v1/agents/${AGENT_ID}`, () => Response.json(agent({ name: "Renamed" })));
    render(<AgentDetail agentId={AGENT_ID} />);

    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ name: "Renamed" });
    });
    expect(await screen.findByRole("heading", { name: /Renamed/ })).toBeInTheDocument();
  });
});

describe("AgentDetail (WS-077 test 5)", () => {
  function detail(state: Agent, tokens: ApiToken[]) {
    on(`GET /api/v1/agents/${AGENT_ID}/tokens`, () =>
      Response.json({ items: tokens, nextCursor: null }),
    );
    on(`GET /api/v1/agents/${AGENT_ID}`, () => Response.json(state));
    render(<AgentDetail agentId={AGENT_ID} />);
  }

  it("shows the agent and its tokens, with Revoke only on active ones", async () => {
    detail(agent({ projectIds: [ONE] }), [
      token({ id: ONE, name: "CI" }),
      token({ id: TWO, name: "Old", status: "revoked", revokedAt: "2026-11-19T12:00:00.000Z" }),
    ]);

    expect(await screen.findByRole("heading", { name: /QA Bot/ })).toBeInTheDocument();
    const tokens = await screen.findByRole("table", { name: "Tokens" });
    const [first, second] = within(tokens).getAllByRole("row").slice(1);
    if (!first || !second) throw new Error("expected two token rows");
    expect(within(first).getByRole("button", { name: "Revoke CI" })).toBeInTheDocument();
    expect(within(second).getByText("Revoked")).toBeInTheDocument();
    expect(within(second).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
  });

  it("disables the agent after a confirmation, and re-enables it", async () => {
    on(`PATCH /api/v1/agents/${AGENT_ID}`, (call) =>
      Response.json(
        agent({ status: (call.body as { active: boolean }).active ? "active" : "disabled" }),
      ),
    );
    detail(agent(), []);

    await userEvent.click(await screen.findByRole("button", { name: "Disable agent" }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(/Its tokens stop working at once/)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole("button", { name: "Disable" }));

    expect(await screen.findByRole("button", { name: "Re-enable agent" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create token" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Re-enable agent" }));
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Re-enable" }),
    );
    expect(await screen.findByRole("button", { name: "Disable agent" })).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "PATCH").map((call) => call.body)).toEqual([
      { active: false },
      { active: true },
    ]);
  });

  it("revokes a token after a confirmation", async () => {
    on(
      `DELETE /api/v1/agents/${AGENT_ID}/tokens/${ONE}`,
      () => new Response(null, { status: 204 }),
    );
    detail(agent(), [token({ id: ONE, name: "CI" })]);

    await userEvent.click(await screen.findByRole("button", { name: "Revoke CI" }));
    on(`GET /api/v1/agents/${AGENT_ID}/tokens`, () =>
      Response.json({
        items: [
          token({ id: ONE, name: "CI", status: "revoked", revokedAt: "2026-11-19T12:00:00.000Z" }),
        ],
        nextCursor: null,
      }),
    );
    await userEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Revoke" }),
    );

    expect(await screen.findByText("Revoked")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "DELETE")).toBe(true);
  });
});

describe("the token dialog (WS-077 test 6)", () => {
  async function openDialog() {
    on(`GET /api/v1/agents/${AGENT_ID}/tokens`, () =>
      Response.json({ items: [], nextCursor: null }),
    );
    on(`GET /api/v1/agents/${AGENT_ID}`, () => Response.json(agent()));
    render(<AgentDetail agentId={AGENT_ID} />);
    await userEvent.click(await screen.findByRole("button", { name: "Create token" }));
    return screen.findByRole("dialog");
  }

  it("preselects 90 days, warns about no expiry, then shows the token once", async () => {
    on(`POST /api/v1/agents/${AGENT_ID}/tokens`, () =>
      Response.json({ token: TOKEN, apiToken: token({ id: ONE, name: "CI" }) }, { status: 201 }),
    );
    const dialog = await openDialog();

    expect(within(dialog).getByRole("radio", { name: "90 days" })).toBeChecked();
    await userEvent.click(within(dialog).getByRole("radio", { name: "No expiry" }));
    expect(within(dialog).getByText(/valid until it is revoked/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("radio", { name: "90 days" }));

    await userEvent.type(within(dialog).getByLabelText("Token name"), "CI");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create token" }));

    expect(await within(dialog).findByDisplayValue(TOKEN)).toBeInTheDocument();
    expect(within(dialog).getByText(/will not be shown again/)).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({
      name: "CI",
      expiresInDays: 90,
    });

    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await userEvent.click(await screen.findByRole("button", { name: "Create token" }));
    expect(screen.queryByDisplayValue(TOKEN)).not.toBeInTheDocument();
  });

  it("explains too many tokens", async () => {
    on(`POST /api/v1/agents/${AGENT_ID}/tokens`, () => problem(409, "too_many_tokens"));
    const dialog = await openDialog();

    await userEvent.type(within(dialog).getByLabelText("Token name"), "CI");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create token" }));

    expect(
      await within(dialog).findByText("This agent already has 10 usable tokens. Revoke one first."),
    ).toBeInTheDocument();
  });
});
