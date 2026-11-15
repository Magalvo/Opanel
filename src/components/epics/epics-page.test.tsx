import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import type { Epic } from "@/lib/schemas/epics";

import {
  bodyOf,
  calls,
  installFetch,
  on,
  problem,
  project,
  PROJECT_ID,
} from "../projects/test-support";
import { EpicsPage } from "./epics-page";
import { auth, AUTH_ID, billing, BILLING_ID, epic, old, OLD_ID } from "./test-support";

const BASE = `/api/v1/projects/${PROJECT_ID}/epics`;
const OPEN = `GET ${BASE}?limit=50&status=open`;

function list(items: Epic[], nextCursor: string | null = null) {
  return () => Response.json({ items, nextCursor });
}

async function renderPage(
  options: { canManage?: boolean; archived?: boolean; items?: Epic[] } = {},
) {
  on(OPEN, list(options.items ?? [auth, billing]));
  const user = userEvent.setup();
  render(
    <EpicsPage
      project={project()}
      canManage={options.canManage ?? true}
      archived={options.archived ?? false}
    />,
  );
  await screen.findByRole("table");
  return user;
}

function row(title: string) {
  return screen.getByRole("row", { name: new RegExp(title) });
}

function pageMessages() {
  return screen.getByRole("status", { name: "Epic messages" });
}

function dialogMessages(dialog: HTMLElement) {
  return within(dialog).getByRole("status", { name: "Epic dialog messages" });
}

async function openEpic(user: Awaited<ReturnType<typeof renderPage>>, title: string) {
  await user.click(within(row(title)).getByRole("button", { name: title }));
  return screen.findByRole("dialog", { name: `Epic ${title}` });
}

function setDate(label: string, scope: HTMLElement, value: string) {
  fireEvent.change(within(scope).getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  installFetch();
});

describe("EpicsPage: the list", () => {
  it("shows a placeholder, then title, status, dates and progress of each epic", async () => {
    on(OPEN, list([auth, billing]));
    render(<EpicsPage project={project()} canManage archived={false} />);
    expect(screen.getByText("Loading epics…")).toBeInTheDocument();

    const table = await screen.findByRole("table");

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Epic", "Status", "Start", "Target", "Progress"]);
    const authRow = row("Auth");
    expect(within(authRow).getByText("Open")).toBeInTheDocument();
    expect(within(authRow).getByText("2026-11-01")).toBeInTheDocument();
    expect(within(authRow).getByText("2026-12-15")).toBeInTheDocument();
    expect(
      within(authRow).getByRole("progressbar", { name: "Progress of Auth: 2 of 5 tasks done" }),
    ).toBeInTheDocument();
    expect(within(row("Billing")).getAllByText("—")).toHaveLength(2);
    expect(within(row("Billing")).getByText("No tasks")).toBeInTheDocument();
  });

  it("says it could not load and retries", async () => {
    on(OPEN, () => problem(500, { code: "internal_error" }));
    const user = userEvent.setup();
    render(<EpicsPage project={project()} canManage archived={false} />);

    expect(await screen.findByText("Could not load epics.")).toBeInTheDocument();
    on(OPEN, list([auth]));
    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("loads more with the cursor and stops offering it on the last page", async () => {
    on(OPEN, list([auth], "C1"));
    on(`GET ${BASE}?limit=50&status=open&cursor=C1`, list([billing]));
    const user = userEvent.setup();
    render(<EpicsPage project={project()} canManage archived={false} />);
    await screen.findByRole("table");

    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByRole("button", { name: "Billing" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("says so when there are no epics, for each filter", async () => {
    on(OPEN, list([]));
    const user = userEvent.setup();
    render(<EpicsPage project={project()} canManage archived={false} />);
    expect(await screen.findByText("There are no open epics.")).toBeInTheDocument();

    on(`GET ${BASE}?limit=50&status=closed`, list([]));
    await user.click(screen.getByRole("combobox", { name: "Show" }));
    await user.click(await screen.findByRole("option", { name: "Closed" }));

    expect(await screen.findByText("There are no closed epics.")).toBeInTheDocument();
  });
});

describe("EpicsPage: the Show filter", () => {
  it("lists open epics first, then closed and all from the first page", async () => {
    const user = await renderPage();
    on(`GET ${BASE}?limit=50&status=closed`, list([old]));
    on(`GET ${BASE}?limit=50&status=all`, list([auth, billing, old]));

    await user.click(screen.getByRole("combobox", { name: "Show" }));
    await user.click(await screen.findByRole("option", { name: "Closed" }));
    expect(await screen.findByRole("button", { name: "Legacy" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Auth" })).not.toBeInTheDocument();
    expect(within(row("Legacy")).getByText("Closed")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Show" }));
    await user.click(await screen.findByRole("option", { name: "All" }));
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: /Auth|Billing|Legacy/ })).toHaveLength(3);
    });
  });
});

describe("EpicsPage: a reader", () => {
  it("sees the description as Markdown, the dates, and no control", async () => {
    const user = await renderPage({ canManage: false });

    const dialog = await openEpic(user, "Auth");

    expect(within(dialog).getByText("sessions").tagName).toBe("STRONG");
    expect(within(dialog).getByText("2026-11-01")).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Start date")).not.toBeInTheDocument();
    for (const name of ["Save changes", "Close epic", "Reopen epic"]) {
      expect(within(dialog).queryByRole("button", { name })).not.toBeInTheDocument();
    }
    expect(screen.queryByRole("button", { name: "New epic" })).not.toBeInTheDocument();
  });

  it("never runs a script written in a description", async () => {
    const user = await renderPage({
      canManage: false,
      items: [epic(AUTH_ID, "Auth", { description: "<script>window.injected = true</script>ok" })],
    });

    const dialog = await openEpic(user, "Auth");

    expect(dialog.querySelector("script")).toBeNull();
    expect("injected" in window).toBe(false);
  });

  it("is read-only in an archived project, for a Manager too, and says why", async () => {
    const user = await renderPage({ archived: true });

    expect(screen.getByText("This project is archived, so its epics are read-only.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "New epic" })).not.toBeInTheDocument();
    const dialog = await openEpic(user, "Auth");
    expect(within(dialog).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Close epic" })).not.toBeInTheDocument();
  });
});

describe("EpicsPage: creating", () => {
  async function openCreate(user: Awaited<ReturnType<typeof renderPage>>) {
    await user.click(screen.getByRole("button", { name: "New epic" }));
    return screen.findByRole("dialog", { name: "New epic" });
  }

  it("validates the title, posts what was written and adds the row to the open list", async () => {
    const user = await renderPage({ items: [auth] });
    const dialog = await openCreate(user);

    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));
    expect(calls("POST")).toHaveLength(0);
    expect(within(dialog).getByText("Enter a title.")).toBeInTheDocument();

    on(`POST ${BASE}`, () => Response.json(billing, { status: 201 }));
    await user.type(within(dialog).getByLabelText("Title"), "  Billing  ");
    await user.type(within(dialog).getByRole("textbox", { name: "Description" }), "Invoices");
    setDate("Start date", dialog, "2026-11-20");
    setDate("Target date", dialog, "2026-12-31");
    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({
      title: "Billing",
      description: "Invoices",
      startDate: "2026-11-20",
      targetDate: "2026-12-31",
    });
    expect(row("Billing")).toBeInTheDocument();
    expect(pageMessages()).toHaveTextContent("Created Billing.");
  });

  it("sends only the title when nothing else was filled in", async () => {
    const user = await renderPage({ items: [auth] });
    const dialog = await openCreate(user);
    on(`POST ${BASE}`, () => Response.json(billing, { status: 201 }));

    await user.type(within(dialog).getByLabelText("Title"), "Billing");
    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));

    await waitFor(() => {
      expect(calls("POST")).toHaveLength(1);
    });
    expect(bodyOf(calls("POST")[0]?.[1])).toEqual({ title: "Billing" });
  });

  it("refuses a target date before the start date, next to the field and with no request", async () => {
    const user = await renderPage();
    const dialog = await openCreate(user);

    await user.type(within(dialog).getByLabelText("Title"), "Billing");
    setDate("Start date", dialog, "2026-12-01");
    setDate("Target date", dialog, "2026-11-01");
    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));

    expect(calls("POST")).toHaveLength(0);
    expect(
      within(dialog).getByText("The target date cannot be before the start date."),
    ).toBeInTheDocument();
  });

  it("shows the field errors of the API next to the fields", async () => {
    const user = await renderPage();
    const dialog = await openCreate(user);
    on(`POST ${BASE}`, () =>
      problem(400, { errors: [{ path: "title", message: "Too long for an epic." }] }),
    );

    await user.type(within(dialog).getByLabelText("Title"), "Billing");
    await user.click(within(dialog).getByRole("button", { name: "Create epic" }));

    expect(await within(dialog).findByText("Too long for an epic.")).toBeInTheDocument();
  });
});

describe("EpicsPage: editing", () => {
  it("sends only what changed with the version, uses the new one next, and updates the row", async () => {
    const user = await renderPage();
    const dialog = await openEpic(user, "Auth");
    const saved = epic(AUTH_ID, "Identity", {
      ...auth,
      title: "Identity",
      version: 2,
      progress: { doneTasks: 3, totalTasks: 5 },
    });
    on(`PATCH /api/v1/epics/${AUTH_ID}`, () => Response.json(saved));
    const save = within(dialog).getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled();

    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Identity");
    await user.click(save);

    await waitFor(() => {
      expect(dialogMessages(dialog)).toHaveTextContent("Saved the epic.");
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ title: "Identity", version: 1 });
    expect(save).toBeDisabled();
    expect(
      within(row("Identity")).getByRole("progressbar", {
        name: "Progress of Identity: 3 of 5 tasks done",
      }),
    ).toBeInTheDocument();

    on(`PATCH /api/v1/epics/${AUTH_ID}`, () => Response.json({ ...saved, version: 3 }));
    setDate("Target date", dialog, "2027-01-31");
    await user.click(save);
    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(2);
    });
    expect(bodyOf(calls("PATCH")[1]?.[1])).toEqual({ targetDate: "2027-01-31", version: 2 });
  });

  it("clears a date by sending null", async () => {
    const user = await renderPage();
    const dialog = await openEpic(user, "Auth");
    on(`PATCH /api/v1/epics/${AUTH_ID}`, () =>
      Response.json({ ...auth, targetDate: null, version: 2 }),
    );

    setDate("Target date", dialog, "");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ targetDate: null, version: 1 });
  });

  it("shows the current epic and says so when someone else changed it", async () => {
    const user = await renderPage();
    const dialog = await openEpic(user, "Auth");
    const current = { ...auth, title: "Theirs", version: 4 };
    on(`PATCH /api/v1/epics/${AUTH_ID}`, () => problem(409, { code: "version_conflict", current }));

    const title = within(dialog).getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "Mine");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText("Title")).toHaveValue("Theirs");
    });
    expect(dialogMessages(dialog)).toHaveTextContent(
      "Someone else changed this epic. Your edit was not saved; the current values are shown.",
    );
    expect(within(row("Theirs")).getByRole("button", { name: "Theirs" })).toBeInTheDocument();
  });

  it("makes the page read-only when the project turns out to be archived", async () => {
    const user = await renderPage();
    const dialog = await openEpic(user, "Auth");
    on(`PATCH /api/v1/epics/${AUTH_ID}`, () => problem(409, { code: "project_archived" }));

    await user.type(within(dialog).getByLabelText("Title"), "x");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(dialogMessages(dialog)).toHaveTextContent(
        "The project is archived, so its epics are read-only.",
      );
    });
    expect(within(dialog).queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });
});

describe("EpicsPage: closing and reopening", () => {
  it("asks first when tasks are not done, says how many, and cancelling changes nothing", async () => {
    const user = await renderPage();
    const dialog = await openEpic(user, "Auth");

    await user.click(within(dialog).getByRole("button", { name: "Close epic" }));
    const confirmation = await screen.findByRole("alertdialog", { name: "Close this epic?" });

    expect(
      within(confirmation).getByText(
        "This epic still has 3 tasks that are not done. Close it anyway?",
      ),
    ).toBeInTheDocument();
    await user.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(calls("PATCH")).toHaveLength(0);
  });

  it("closes on confirmation with the version, and the epic leaves the open list", async () => {
    const user = await renderPage();
    const dialog = await openEpic(user, "Auth");
    on(`PATCH /api/v1/epics/${AUTH_ID}`, () =>
      Response.json({ ...auth, status: "closed", version: 2 }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Close epic" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Close epic" }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("row", { name: /Auth/, hidden: true })).not.toBeInTheDocument();
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ status: "closed", version: 1 });
    expect(pageMessages()).toHaveTextContent("Closed Auth.");
  });

  it("says task in the singular when only one is not done", async () => {
    const user = await renderPage({
      items: [epic(BILLING_ID, "Billing", { progress: { doneTasks: 2, totalTasks: 3 } })],
    });
    const dialog = await openEpic(user, "Billing");

    await user.click(within(dialog).getByRole("button", { name: "Close epic" }));

    expect(
      await screen.findByText("This epic still has 1 task that is not done. Close it anyway?"),
    ).toBeInTheDocument();
  });

  it("does not ask for an epic whose tasks are all done, or that has none", async () => {
    const user = await renderPage({ items: [billing] });
    const dialog = await openEpic(user, "Billing");
    on(`PATCH /api/v1/epics/${BILLING_ID}`, () =>
      Response.json({ ...billing, status: "closed", version: 2 }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Close epic" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ status: "closed", version: 1 });
  });

  it("reopens a closed epic at once with the version", async () => {
    const user = await renderPage({ items: [old] });
    on(`GET ${BASE}?limit=50&status=all`, list([old]));
    await user.click(screen.getByRole("combobox", { name: "Show" }));
    await user.click(await screen.findByRole("option", { name: "All" }));
    const dialog = await openEpic(user, "Legacy");
    on(`PATCH /api/v1/epics/${OLD_ID}`, () =>
      Response.json({ ...old, status: "open", version: 2 }),
    );

    await user.click(within(dialog).getByRole("button", { name: "Reopen epic" }));

    await waitFor(() => {
      expect(calls("PATCH")).toHaveLength(1);
    });
    expect(bodyOf(calls("PATCH")[0]?.[1])).toEqual({ status: "open", version: 1 });
    expect(pageMessages()).toHaveTextContent("Reopened Legacy.");
  });
});

describe("EpicsPage: accessibility", () => {
  it("has a heading, one announced region, a headed table and named controls", async () => {
    await renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Epics" })).toBeInTheDocument();
    expect(screen.getAllByRole("status", { name: "Epic messages" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "New epic" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Show" })).toBeInTheDocument();
  });

  it("closes a dialog with Escape and returns focus to the title that opened it", async () => {
    const user = await renderPage();
    const opener = within(row("Auth")).getByRole("button", { name: "Auth" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "Epic Auth" });

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });
  });
});
