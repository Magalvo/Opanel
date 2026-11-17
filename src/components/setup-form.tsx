"use client";

import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { problemSchema } from "@/lib/schemas/problem";

type Field = "setupToken" | "name" | "email" | "password" | "confirmation";
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly { name: Field; label: string; type: string; autoComplete: string }[] = [
  { name: "setupToken", label: "Setup token", type: "password", autoComplete: "off" },
  { name: "name", label: "Name", type: "text", autoComplete: "name" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
  {
    name: "confirmation",
    label: "Confirm password",
    type: "password",
    autoComplete: "new-password",
  },
];

// A server error or a lost response may come after the Admin was created (WS-057).
const UNCONFIRMED =
  "We could not confirm the setup. The administrator may already exist: try signing in.";

/** True for a success body that says no session was made (WS-057). */
function isNotSignedIn(body: unknown): boolean {
  return typeof body === "object" && body !== null && "signedIn" in body && body.signedIn === false;
}

function isField(path: string): path is "setupToken" | "name" | "email" | "password" {
  return path === "setupToken" || path === "name" || path === "email" || path === "password";
}

/**
 * First-run setup form (WS-016). Talks to the same public API as everyone else. Asks for
 * the setup token when the server has one configured (`tokenRequired`, WS-050).
 */
export function SetupForm({ tokenRequired }: { tokenRequired: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<Field, string>>({
    setupToken: "",
    name: "",
    email: "",
    password: "",
    confirmation: "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    // Checked here and never sent: the confirmation is a typing aid, not data.
    if (values.password !== values.confirmation) {
      setErrors({ confirmation: "The passwords do not match." });
      return;
    }
    setErrors({});
    setPending(true);

    try {
      const response = await fetch("/api/v1/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(tokenRequired ? { setupToken: values.setupToken } : {}),
          name: values.name,
          email: values.email,
          password: values.password,
        }),
      });

      if (response.status === 201) {
        // The Admin exists either way; without a session, they sign in (WS-057).
        const body: unknown = await response.json().catch(() => null);
        router.push(isNotSignedIn(body) ? "/sign-in?notice=admin-created" : "/");
        return;
      }

      const problem =
        response.status === 400 || response.status === 403
          ? problemSchema.safeParse(await response.json().catch(() => null))
          : null;

      if (response.status === 404) {
        setFormError(
          "This installation is already set up. If you just created the administrator, sign in.",
        );
      } else if (response.status === 429) {
        // Setup has no limiter: a 429 means the server is busy hashing (WS-056).
        setFormError("The server is busy. Try again in a moment.");
      } else if (problem?.success && problem.data.code === "invalid_setup_token") {
        setErrors({ setupToken: "The setup token is not correct." });
      } else if (response.status === 400) {
        const next: FieldErrors = {};
        for (const error of problem?.success ? (problem.data.errors ?? []) : []) {
          if (isField(error.path)) {
            next[error.path] = error.message;
          }
        }
        setErrors(next);
        if (Object.keys(next).length === 0) {
          setFormError("Please check the details and try again.");
        }
      } else if (response.status >= 500) {
        setFormError(UNCONFIRMED);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } catch {
      setFormError(UNCONFIRMED);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
      {FIELDS.filter((field) => tokenRequired || field.name !== "setupToken").map((field) => {
        const error = errors[field.name];
        return (
          <div key={field.name} className="grid gap-1.5">
            <label htmlFor={`setup-${field.name}`} className="text-sm font-medium">
              {field.label}
            </label>
            <Input
              id={`setup-${field.name}`}
              name={field.name}
              type={field.type}
              autoComplete={field.autoComplete}
              required
              value={values[field.name]}
              onChange={(event) => {
                setValues({ ...values, [field.name]: event.target.value });
              }}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={error === undefined ? undefined : `setup-${field.name}-error`}
            />
            {error !== undefined && (
              <p id={`setup-${field.name}-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}
      {formError !== null && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create administrator"}
      </Button>
    </form>
  );
}
