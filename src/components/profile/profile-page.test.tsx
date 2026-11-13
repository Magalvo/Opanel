import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }),
}));

const { ProfilePage } = await import("./profile-page");

const fetchMock = vi.fn<typeof fetch>();
const CURRENT = "my current password";
const NEXT = "a brand new password";

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
      code: status === 429 ? "rate_limited" : "invalid_request",
      detail: "A problem.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      ...body,
    }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

function renderPage() {
  render(<ProfilePage name="Ada Lovelace" email="ada@example.com" />);
  return userEvent.setup();
}

function bodyOf(call: Parameters<typeof fetch> | undefined): unknown {
  const body = call?.[1]?.body;
  if (typeof body !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(body);
}

async function changePassword(user: ReturnType<typeof userEvent.setup>, confirmation = NEXT) {
  await user.type(screen.getByLabelText("Current password"), CURRENT);
  await user.type(screen.getByLabelText("New password"), NEXT);
  await user.type(screen.getByLabelText("Confirm new password"), confirmation);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

describe("ProfilePage: name", () => {
  beforeEach(() => {
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("is prefilled, and shows the email as something that cannot be changed", () => {
    renderPage();

    expect(screen.getByLabelText("Name")).toHaveValue("Ada Lovelace");
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Your email cannot be changed.")).toBeInTheDocument();
  });

  it("sends only the name with PATCH /api/v1/me, says it is saved and refreshes the shell", async () => {
    fetchMock.mockResolvedValue(Response.json({}));
    const user = renderPage();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Ada King");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/me");
    expect(init?.method).toBe("PATCH");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ name: "Ada King" });
  });

  it("shows the field error of a 400", async () => {
    fetchMock.mockResolvedValue(
      problem(400, { errors: [{ path: "name", message: "Too long, at most 100." }] }),
    );
    const user = renderPage();

    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(await screen.findByText("Too long, at most 100.")).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("disables its button while the request is in flight", async () => {
    let resolve: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = renderPage();

    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(screen.getByRole("button", { name: "Save name" })).toBeDisabled();
    resolve(Response.json({}));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save name" })).toBeEnabled();
    });
  });
});

describe("ProfilePage: password", () => {
  beforeEach(() => {
    refresh.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("sends nothing when the confirmation does not match", async () => {
    const user = renderPage();

    await changePassword(user, "something else entirely");

    expect(screen.getByText("The new passwords do not match.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts only the current and new password, then clears the fields and confirms", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const user = renderPage();

    await changePassword(user);

    expect(
      await screen.findByText("Password changed. You were signed out on your other devices."),
    ).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/me/password");
    expect(init?.method).toBe("POST");
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({
      currentPassword: CURRENT,
      newPassword: NEXT,
    });
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
  });

  it("shows a wrong current password next to its field", async () => {
    fetchMock.mockResolvedValue(
      problem(400, {
        errors: [{ path: "currentPassword", message: "Is not your current password." }],
      }),
    );
    const user = renderPage();

    await changePassword(user);

    expect(await screen.findByText("Is not your current password.")).toBeInTheDocument();
  });

  it("says how long to wait after a 429", async () => {
    fetchMock.mockResolvedValue(problem(429, {}, { "Retry-After": "120" }));
    const user = renderPage();

    await changePassword(user);

    expect(
      await screen.findByText("Too many attempts. Try again in 2 minutes."),
    ).toBeInTheDocument();
  });

  it("shows a generic message for anything else", async () => {
    fetchMock.mockResolvedValue(problem(500));
    const user = renderPage();

    await changePassword(user);

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });
});
