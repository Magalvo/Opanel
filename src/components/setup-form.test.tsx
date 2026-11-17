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

async function fillAndSubmit(confirmation = password, setupToken?: string) {
  const user = userEvent.setup();
  render(<SetupForm tokenRequired={setupToken !== undefined} />);
  if (setupToken !== undefined) {
    await user.type(screen.getByLabelText("Setup token"), setupToken);
  }
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

  describe("with a setup token required (WS-050)", () => {
    const token = "the-setup-token-0123456789abcdef";

    it("shows no setup token field when none is required, and sends none", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

      await fillAndSubmit();

      expect(screen.queryByLabelText("Setup token")).not.toBeInTheDocument();
      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).not.toHaveProperty(
        "setupToken",
      );
    });

    it("shows the field and sends its value as setupToken", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 201 }));

      await fillAndSubmit(password, token);

      const [, init] = fetchMock.mock.calls[0] ?? [];
      expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toEqual({
        setupToken: token,
        name: "Ada Admin",
        email: "ada@example.com",
        password,
      });
      await waitFor(() => {
        expect(push).toHaveBeenCalledWith("/");
      });
    });

    it("on 403 invalid_setup_token, says so under the field and keeps the other values", async () => {
      fetchMock.mockResolvedValue(problem(403, { code: "invalid_setup_token" }));

      await fillAndSubmit(password, token);

      const field = screen.getByLabelText("Setup token");
      expect(await screen.findByText("The setup token is not correct.")).toBeInTheDocument();
      expect(field).toHaveAttribute("aria-invalid", "true");
      expect(screen.getByLabelText("Name")).toHaveValue("Ada Admin");
      expect(screen.getByLabelText("Email")).toHaveValue("ada@example.com");
    });

    it("on any other 403, keeps the generic message", async () => {
      fetchMock.mockResolvedValue(problem(403, { code: "forbidden" }));

      await fillAndSubmit(password, token);

      expect(
        await screen.findByText("Something went wrong. Please try again."),
      ).toBeInTheDocument();
      expect(screen.queryByText("The setup token is not correct.")).not.toBeInTheDocument();
    });
  });
});
