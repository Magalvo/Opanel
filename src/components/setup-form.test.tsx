import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

const { SetupForm } = await import("./setup-form");

const fetchMock = vi.fn<typeof fetch>();
const password = "a long enough password";

function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title: "Problem",
      status,
      detail: "A problem.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      ...body,
    }),
    { status, headers: { "Content-Type": "application/problem+json" } },
  );
}

async function fillAndSubmit(confirmation = password) {
  const user = userEvent.setup();
  render(<SetupForm />);
  await user.type(screen.getByLabelText("Name"), "Ada Admin");
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.type(screen.getByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmation);
  await user.click(screen.getByRole("button", { name: "Create administrator" }));
  return user;
}

describe("SetupForm", () => {
  beforeEach(() => {
    push.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows a message and sends nothing when the confirmation does not match", async () => {
    await fillAndSubmit("something else entirely");

    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts name, email and password, without the confirmation, and goes to the app", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "x" }, { status: 201 }));

    await fillAndSubmit();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/setup");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toEqual({
      name: "Ada Admin",
      email: "ada@example.com",
      password,
    });
  });

  it("shows the server's field errors next to their fields on a 400", async () => {
    fetchMock.mockResolvedValue(
      problem(400, {
        code: "invalid_request",
        errors: [{ path: "email", message: "Invalid email address" }],
      }),
    );

    await fillAndSubmit();

    expect(await screen.findByText("Invalid email address")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("says the installation is already set up on a 404", async () => {
    fetchMock.mockResolvedValue(problem(404, { code: "not_found" }));

    await fillAndSubmit();

    expect(await screen.findByText("This installation is already set up.")).toBeInTheDocument();
  });

  it("disables the button while the request is in flight", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    await fillAndSubmit();

    expect(screen.getByRole("button", { name: /Creating/ })).toBeDisabled();
  });
});
