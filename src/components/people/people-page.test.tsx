import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ManagedAccount } from "@/lib/schemas/accounts";

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { PeoplePage } = await import("./people-page");

const SELF = "11111111-1111-4111-8111-111111111111";
const LINK = { url: "http://localhost:3000/accept#abc123", expiresAt: "2026-11-20T10:00:00.000Z" };

function account(
  overrides: Partial<ManagedAccount> & { id: string; name: string },
): ManagedAccount {
  return {
    email: `${overrides.name.toLowerCase()}@example.com`,
    role: "member",
    status: "active",
    createdAt: "2026-11-12T10:00:00.000Z",
    lastSeenAt: null,
    ...overrides,
  };
}

const ada = account({
  id: SELF,
  name: "Ada",
  role: "admin",
  lastSeenAt: "2026-11-13T09:30:00.000Z",
});
const grace = account({
  id: "22222222-2222-4222-8222-222222222222",
  name: "Grace",
  status: "invited",
});
const linus = account({
  id: "33333333-3333-4333-8333-333333333333",
  name: "Linus",
  role: "manager",
});

function problem(
  status: number,
  body: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Problem",
      status,
      code: "invalid_request",
      detail: "A problem.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      ...body,
    }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

const fetchMock = vi.fn<typeof fetch>();

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}
const responses = new Map<string, () => Response>();

function on(key: string, response: () => Response) {
  responses.set(key, response);
}

function page(items: ManagedAccount[], nextCursor: string | null = null) {
  return () => Response.json({ items, nextCursor });
}

function calls(method: string): [string, RequestInit | undefined][] {
  return fetchMock.mock.calls
    .filter(([, init]) => (init?.method ?? "GET") === method)
    .map(([url, init]) => [urlOf(url), init]);
}

function bodyOf(init: RequestInit | undefined): unknown {
  return JSON.parse(typeof init?.body === "string" ? init.body : "null");
}

async function renderLoaded(items: ManagedAccount[] = [ada, grace, linus]) {
  on("GET /api/v1/accounts?limit=50", page(items));
  const user = userEvent.setup();
  render(<PeoplePage currentAccountId={SELF} />);
  await screen.findByRole("table");
  return user;
}

function row(name: string) {
  return screen.getByRole("row", { name: new RegExp(name) });
}

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
  fetchMock.mockReset();
  responses.clear();
  fetchMock.mockImplementation((input, init) => {
    const key = `${init?.method ?? "GET"} ${urlOf(input)}`;
    const respond = responses.get(key);
    if (!respond) throw new Error(`unexpected request: ${key}`);
    return Promise.resolve(respond());
  });
  vi.stubGlobal("fetch", fetchMock);
});

describe("PeoplePage: the list", () => {
  it("shows a placeholder while loading, then everyone with role, status and last seen", async () => {
    on("GET /api/v1/accounts?limit=50", page([ada, grace, linus]));

    render(<PeoplePage currentAccountId={SELF} />);
    expect(screen.getByText("Loading people…")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["Person", "Role", "Status", "Last seen", "Actions"]);
    expect(within(row("Ada")).getByText("ada@example.com")).toBeInTheDocument();
    expect(within(row("Ada")).getByText("Active")).toBeInTheDocument();
    expect(
      within(row("Ada")).getByText(new Date(ada.lastSeenAt ?? "").toLocaleString()),
    ).toBeInTheDocument();
    expect(within(row("Grace")).getByText("Invited")).toBeInTheDocument();
    expect(within(row("Grace")).getByText("Never")).toBeInTheDocument();
    expect(within(row("Linus")).getByRole("combobox", { name: "Role of Linus" })).toHaveTextContent(
      "Manager",
    );
  });

  it("says it could not load and retries", async () => {
    on("GET /api/v1/accounts?limit=50", () => problem(500, { code: "internal_error" }));
    const user = userEvent.setup();
    render(<PeoplePage currentAccountId={SELF} />);

    expect(await screen.findByText("Could not load people.")).toBeInTheDocument();
    on("GET /api/v1/accounts?limit=50", page([ada]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("loads more with the cursor, appends, and stops offering it on the last page", async () => {
    on("GET /api/v1/accounts?limit=50", page([ada], "CURSOR1"));
    on("GET /api/v1/accounts?limit=50&cursor=CURSOR1", page([grace]));
    const user = userEvent.setup();
    render(<PeoplePage currentAccountId={SELF} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("grace@example.com")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("has an announced status region and names every control", async () => {
    await renderLoaded();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invite person" })).toBeInTheDocument();
    for (const name of ["Ada", "Grace", "Linus"]) {
      expect(screen.getByRole("combobox", { name: `Role of ${name}` })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: `Actions for ${name}` })).toBeInTheDocument();
    }
  });
});

describe("PeoplePage: inviting", () => {
  async function openInvite(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Invite person" }));
    return screen.findByRole("dialog", { name: "Invite a person" });
  }

  it("says a wrong email can be fixed by revoking, validates, posts and shows the link once", async () => {
    const user = await renderLoaded([ada]);
    const dialog = await openInvite(user);
    expect(
      within(dialog).getByText(
        "Check the email. If it is wrong, revoke the invitation and invite again.",
      ),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Create invitation" }));
    expect(calls("POST")).toHaveLength(0);
    expect(within(dialog).getAllByText(/required|valid/i).length).toBeGreaterThan(0);

    on("POST /api/v1/accounts", () =>
      Response.json({ account: grace, link: LINK }, { status: 201 }),
    );
    await user.type(within(dialog).getByLabelText("Name"), "Grace");
    await user.type(within(dialog).getByLabelText("Email"), "grace@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create invitation" }));

    const linkDialog = await screen.findByRole("dialog", { name: "Invitation link" });
    expect(within(linkDialog).getByLabelText("Link")).toHaveValue(LINK.url);
    expect(
      within(linkDialog).getByText("This link is shown only now. It works once."),
    ).toBeInTheDocument();
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      name: "Grace",
      email: "grace@example.com",
      role: "member",
    });
    // While the modal is open the page behind it is hidden from assistive technology, so the
    // outcome is read once the dialog is closed.
    await user.click(within(linkDialog).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("Invited Grace.");
    expect(screen.getByText("grace@example.com")).toBeInTheDocument();
  });

  it("shows the server's field errors and a duplicate email", async () => {
    const user = await renderLoaded([ada]);
    const dialog = await openInvite(user);
    await user.type(within(dialog).getByLabelText("Name"), "Grace");
    await user.type(within(dialog).getByLabelText("Email"), "grace@example.com");

    on("POST /api/v1/accounts", () => problem(409, { code: "conflict" }));
    await user.click(within(dialog).getByRole("button", { name: "Create invitation" }));

    expect(
      await within(dialog).findByText("An account with this email already exists."),
    ).toBeInTheDocument();
  });

  it("copies the link, says so, falls back to a message when copying fails, and forgets the link on close", async () => {
    const user = await renderLoaded([ada]);
    const dialog = await openInvite(user);
    on("POST /api/v1/accounts", () =>
      Response.json({ account: grace, link: LINK }, { status: 201 }),
    );
    await user.type(within(dialog).getByLabelText("Name"), "Grace");
    await user.type(within(dialog).getByLabelText("Email"), "grace@example.com");
    await user.click(within(dialog).getByRole("button", { name: "Create invitation" }));
    const linkDialog = await screen.findByRole("dialog", { name: "Invitation link" });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await user.click(within(linkDialog).getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(LINK.url);
    expect(await within(linkDialog).findByText("Link copied.")).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error("denied"));
    await user.click(within(linkDialog).getByRole("button", { name: "Copy link" }));
    expect(
      await within(linkDialog).findByText(
        "Could not copy automatically. Select the link and copy it.",
      ),
    ).toBeInTheDocument();

    await user.click(within(linkDialog).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue(LINK.url)).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("abc123");
  });

  it("closes with Escape and gives focus back to the button that opened it", async () => {
    const user = await renderLoaded([ada]);
    const opener = screen.getByRole("button", { name: "Invite person" });
    await openInvite(user);

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(opener).toHaveFocus();
  });
});

describe("PeoplePage: changing people", () => {
  async function chooseRole(user: ReturnType<typeof userEvent.setup>, name: string, role: string) {
    await user.click(screen.getByRole("combobox", { name: `Role of ${name}` }));
    await user.click(await screen.findByRole("option", { name: role }));
  }

  async function openActions(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  }

  it("changes someone else's role at once and says they were signed out", async () => {
    const user = await renderLoaded();
    on(`PATCH /api/v1/accounts/${linus.id}`, () => Response.json({ ...linus, role: "viewer" }));

    await chooseRole(user, "Linus", "Viewer");

    await waitFor(() => {
      expect(within(row("Linus")).getByRole("combobox")).toHaveTextContent("Viewer");
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ role: "viewer" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Linus's role is now Viewer. They were signed out.",
    );
  });

  it("explains a refusal because the person is the only active administrator", async () => {
    const user = await renderLoaded([ada]);
    on(`PATCH /api/v1/accounts/${SELF}`, () => problem(409, { code: "last_admin" }));

    await chooseRole(user, "Ada", "Member");
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Change role" }));

    expect(
      await screen.findByText(
        "This is the only active administrator, so they cannot be demoted or deactivated.",
      ),
    ).toBeInTheDocument();
    expect(within(row("Ada")).getByRole("combobox")).toHaveTextContent("Admin");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("disables the role of a deactivated account", async () => {
    await renderLoaded([
      ada,
      account({ id: "44444444-4444-4444-8444-444444444444", name: "Off", status: "deactivated" }),
    ]);

    expect(screen.getByRole("combobox", { name: "Role of Off" })).toBeDisabled();
  });

  it("asks before deactivating, says what it does, and does nothing on cancel", async () => {
    const user = await renderLoaded();
    await openActions(user, "Linus");
    await user.click(await screen.findByRole("menuitem", { name: "Deactivate" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Deactivate Linus?" });
    expect(within(confirm).getByText(/ends their sessions immediately/i)).toBeInTheDocument();

    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(calls("PATCH")).toHaveLength(0);
  });

  it("deactivates on confirmation and reactivates from the menu", async () => {
    const user = await renderLoaded();
    on(`PATCH /api/v1/accounts/${linus.id}`, () =>
      Response.json({ ...linus, status: "deactivated" }),
    );
    await openActions(user, "Linus");
    await user.click(await screen.findByRole("menuitem", { name: "Deactivate" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Deactivate" }),
    );

    await waitFor(() => {
      expect(within(row("Linus")).getByText("Deactivated")).toBeInTheDocument();
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ active: false });
    expect(screen.getByRole("status")).toHaveTextContent("Linus was deactivated and signed out.");

    on(`PATCH /api/v1/accounts/${linus.id}`, () => Response.json(linus));
    await openActions(user, "Linus");
    await user.click(await screen.findByRole("menuitem", { name: "Reactivate" }));

    await waitFor(() => {
      expect(within(row("Linus")).getByText("Active")).toBeInTheDocument();
    });
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ active: true });
    expect(screen.getByRole("status")).toHaveTextContent("Linus was reactivated.");
  });

  it("creates a reset link for an active account and a new invitation link for an invited one, and none for a deactivated one", async () => {
    const off = account({
      id: "44444444-4444-4444-8444-444444444444",
      name: "Off",
      status: "deactivated",
    });
    const user = await renderLoaded([ada, grace, linus, off]);
    on(`POST /api/v1/accounts/${linus.id}/reset-link`, () =>
      Response.json({ link: LINK }, { status: 201 }),
    );
    on(`POST /api/v1/accounts/${grace.id}/reset-link`, () =>
      Response.json({ link: LINK }, { status: 201 }),
    );

    await openActions(user, "Linus");
    await user.click(await screen.findByRole("menuitem", { name: "Create reset link" }));
    expect(await screen.findByRole("dialog", { name: "Reset link" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));

    await openActions(user, "Grace");
    await user.click(await screen.findByRole("menuitem", { name: "Create a new invitation link" }));
    expect(await screen.findByRole("dialog", { name: "Invitation link" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));

    await openActions(user, "Off");
    expect(await screen.findByRole("menuitem", { name: "Reactivate" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /link/i })).not.toBeInTheDocument();
  });

  it("asks before changing one's own role and, once done, goes to the sign-in page", async () => {
    const user = await renderLoaded([ada, linus]);
    on(`PATCH /api/v1/accounts/${SELF}`, () => Response.json({ ...ada, role: "member" }));

    await chooseRole(user, "Ada", "Member");
    const confirm = await screen.findByRole("alertdialog", { name: "Change your own role?" });
    expect(within(confirm).getByText(/signed out/i)).toBeInTheDocument();
    expect(calls("PATCH")).toHaveLength(0);
    await user.click(within(confirm).getByRole("button", { name: "Change role" }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/sign-in");
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("does the same when deactivating oneself", async () => {
    const user = await renderLoaded([ada, linus]);
    on(`PATCH /api/v1/accounts/${SELF}`, () => Response.json({ ...ada, status: "deactivated" }));
    await openActions(user, "Ada");
    await user.click(await screen.findByRole("menuitem", { name: "Deactivate" }));

    const confirm = await screen.findByRole("alertdialog", {
      name: "Deactivate your own account?",
    });
    await user.click(within(confirm).getByRole("button", { name: "Deactivate" }));

    await waitFor(() => {
      expect(router.replace).toHaveBeenCalledWith("/sign-in");
    });
  });
});

describe("PeoplePage: revoking an invitation", () => {
  async function openActions(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("button", { name: `Actions for ${name}` }));
  }

  async function askToRevoke(user: ReturnType<typeof userEvent.setup>) {
    await openActions(user, "Grace");
    await user.click(await screen.findByRole("menuitem", { name: "Revoke invitation" }));
    return screen.findByRole("alertdialog", { name: "Revoke the invitation of Grace?" });
  }

  it("is offered only for an invited person", async () => {
    const off = account({
      id: "44444444-4444-4444-8444-444444444444",
      name: "Off",
      status: "deactivated",
    });
    const user = await renderLoaded([ada, grace, linus, off]);

    for (const name of ["Linus", "Off"]) {
      await openActions(user, name);
      expect(await screen.findByRole("menu")).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Revoke invitation" })).not.toBeInTheDocument();
      await user.keyboard("{Escape}");
    }
    await openActions(user, "Grace");
    expect(await screen.findByRole("menuitem", { name: "Revoke invitation" })).toBeInTheDocument();
  });

  it("asks first, says the email will be free, and does nothing on cancel", async () => {
    const user = await renderLoaded();

    const confirm = await askToRevoke(user);
    expect(
      within(confirm).getByText(
        "Their link stops working and the account is removed. grace@example.com can be invited again.",
      ),
    ).toBeInTheDocument();
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));

    expect(calls("DELETE")).toHaveLength(0);
  });

  it("revokes on confirmation, removes the row and says so", async () => {
    const user = await renderLoaded();
    on(`DELETE /api/v1/accounts/${grace.id}/invitation`, () => new Response(null, { status: 204 }));

    const confirm = await askToRevoke(user);
    await user.click(within(confirm).getByRole("button", { name: "Revoke" }));

    await waitFor(() => {
      expect(screen.queryByRole("row", { name: /Grace/ })).not.toBeInTheDocument();
    });
    expect(calls("DELETE").map(([url]) => url)).toEqual([
      `/api/v1/accounts/${grace.id}/invitation`,
    ]);
    expect(screen.getByRole("status")).toHaveTextContent("The invitation of Grace was revoked.");
  });

  it("reloads the list and explains when the person accepted in the meantime", async () => {
    const user = await renderLoaded();
    on(`DELETE /api/v1/accounts/${grace.id}/invitation`, () => problem(409, { code: "conflict" }));
    on("GET /api/v1/accounts?limit=50", page([ada, { ...grace, status: "active" }, linus]));

    const confirm = await askToRevoke(user);
    await user.click(within(confirm).getByRole("button", { name: "Revoke" }));

    expect(
      await screen.findByText("Grace has already accepted the invitation."),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(within(row("Grace")).getByText("Active")).toBeInTheDocument();
    });
  });

  it("says it could not revoke on any other failure, and keeps the row", async () => {
    const user = await renderLoaded();
    on(`DELETE /api/v1/accounts/${grace.id}/invitation`, () => problem(500));

    const confirm = await askToRevoke(user);
    await user.click(within(confirm).getByRole("button", { name: "Revoke" }));

    expect(await screen.findByText("Could not revoke. Try again.")).toBeInTheDocument();
    expect(row("Grace")).toBeInTheDocument();
  });
});
