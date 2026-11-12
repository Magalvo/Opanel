"use client";

import { useRouter } from "next/navigation";
import { type SubmitEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { problemSchema } from "@/lib/schemas/problem";

type Field = "name" | "email" | "password" | "confirmation";
type FieldErrors = Partial<Record<Field, string>>;

const FIELDS: readonly { name: Field; label: string; type: string; autoComplete: string }[] = [
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

function isField(path: string): path is "name" | "email" | "password" {
  return path === "name" || path === "email" || path === "password";
}

/** First-run setup form (WS-016). Talks to the same public API as everyone else. */
export function SetupForm() {
  const router = useRouter();
  const [values, setValues] = useState<Record<Field, string>>({
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
          name: values.name,
          email: values.email,
          password: values.password,
        }),
      });

      if (response.status === 201) {
        router.push("/");
        return;
      }

      if (response.status === 404) {
        setFormError("This installation is already set up.");
      } else if (response.status === 400) {
        const problem = problemSchema.safeParse(await response.json().catch(() => null));
        const next: FieldErrors = {};
        for (const error of problem.success ? (problem.data.errors ?? []) : []) {
          if (isField(error.path)) {
            next[error.path] = error.message;
          }
        }
        setErrors(next);
        if (Object.keys(next).length === 0) {
          setFormError("Please check the details and try again.");
        }
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } catch {
      setFormError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4" noValidate>
      {FIELDS.map((field) => {
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
