import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const { AcceptForm } = await import("./accept-form");

const TOKEN = "T".repeat(43);
const replaceState = vi.fn();
const fetchMock = vi.fn<typeof fetch>();
const password = "a long enough password";

function setAddress(hash: string) {
  Object.defineProperty(window, "location", {
    value: { hash, pathname: "/accept", search: "" },
    writable: true,
  });
}

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
      code: "invalid_link",
      detail: "A problem.",
      requestId: "0f8b6c1e-3a52-4d7b-9a51-0c1f1c2d3e4f",
      ...body,
    }),
    { status, headers: { "Content-Type": "application/problem+json", ...headers } },
  );
}

async function fillAndSubmit(confirmation = password) {
  const user = userEvent.setup();
  render(<AcceptForm />);
  await user.type(await screen.findByLabelText("Password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmation);
  await user.click(screen.getByRole("button", { name: "Set password" }));
}

describe("AcceptForm", () => {
  beforeEach(() => {
    push.mockReset();
    refresh.mockReset();
    replaceState.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window.history, "replaceState").mockImplementation(replaceState);
    setAddress(`#${TOKEN}`);
  });

  it("reads the token from the address fragment and removes the fragment at once", async () => {
    render(<AcceptForm />);

    expect(await screen.findByLabelText("Password")).toBeInTheDocument();
    expect(replaceState).toHaveBeenCalledWith(null, "", "/accept");
  });

  it("says the link is not valid, with no form, when there is no token", async () => {
    setAddress("");

    render(<AcceptForm />);

    expect(await screen.findByText("This link is not valid.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
  });

  it("tells the person they will be signed out everywhere else", async () => {
    render(<AcceptForm />);

    expect(await screen.findByText("You will be signed out everywhere else.")).toBeInTheDocument();
  });

  it("sends nothing when the confirmation does not match", async () => {
    await fillAndSubmit("something else entirely");

    expect(screen.getByText("The passwords do not match.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the token and the password only, then goes to the app and refreshes", async () => {
    fetchMock.mockResolvedValue(Response.json({ id: "x" }, { status: 200 }));

    await fillAndSubmit();

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/");
    });
    expect(refresh).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/account-links/accept");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(typeof init?.body === "string" ? init.body : "{}")).toEqual({
      token: TOKEN,
      password,
    });
  });

  it("explains a refused link on a 404", async () => {
    fetchMock.mockResolvedValueOnce(problem(404));
    await fillAndSubmit();
    expect(
      await screen.findByText("This link is no longer valid. Ask an administrator for a new one."),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows the server's field errors on a 400", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(400, {
        code: "invalid_request",
        errors: [{ path: "password", message: "Must be at least 12 characters" }],
      }),
    );

    await fillAndSubmit();

    expect(await screen.findByText("Must be at least 12 characters")).toBeInTheDocument();
  });

  it("says how long to wait on a 429", async () => {
    fetchMock.mockResolvedValueOnce(
      problem(429, { code: "rate_limited" }, { "Retry-After": "540" }),
    );
    await fillAndSubmit();
    expect(
      await screen.findByText("Too many attempts. Try again in 9 minutes."),
    ).toBeInTheDocument();
  });

  it("is generic for a server error", async () => {
    fetchMock.mockResolvedValueOnce(problem(500, { code: "internal_error" }));

    await fillAndSubmit();

    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("disables the button while sending", async () => {
    fetchMock.mockReturnValue(new Promise<Response>(() => undefined));

    await fillAndSubmit();

    expect(screen.getByRole("button", { name: /Setting password/ })).toBeDisabled();
  });
});
