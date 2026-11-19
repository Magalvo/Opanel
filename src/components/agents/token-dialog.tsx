"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { ApiFailure, createToken } from "./api";
import { EXPIRY_OPTIONS } from "./labels";

type Expiry = (typeof EXPIRY_OPTIONS)[number]["value"];

const FAILURES: Readonly<Record<string, string>> = {
  too_many_tokens: "This agent already has 10 usable tokens. Revoke one first.",
  agent_disabled: "This agent is disabled. Re-enable it first.",
};

/**
 * "Create token" and its dialog (WS-077 section 6). The token is shown once, here: it lives
 * only in this component's state and is gone when the dialog closes. The server keeps only
 * its hash (doc 0001 section 4).
 */
export function TokenDialog({
  agentId,
  disabled,
  onCreated,
}: Readonly<{ agentId: string; disabled: boolean; onCreated: () => void }>) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<Expiry>("90");
  const [shown, setShown] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  function openChanged(next: boolean) {
    setOpen(next);
    // Whatever was shown is forgotten as soon as the dialog closes.
    setName("");
    setExpiry("90");
    setShown(null);
    setNameError(null);
    setFormError(null);
    setCopyMessage(null);
  }

  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (name.trim() === "") {
      setNameError("Enter a name, for example where the token is used.");
      return;
    }
    setNameError(null);
    setPending(true);
    try {
      const created = await createToken(agentId, {
        name: name.trim(),
        expiresInDays: expiry === "never" ? null : (Number(expiry) as 30 | 90 | 365),
      });
      setShown(created.token);
      onCreated();
    } catch (error) {
      const code = error instanceof ApiFailure ? error.code : null;
      setFormError(
        (code === null ? undefined : FAILURES[code]) ?? "Could not create the token. Try again.",
      );
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (shown === null) return;
    try {
      await navigator.clipboard.writeText(shown);
      setCopyMessage("Token copied.");
    } catch {
      field.current?.select();
      setCopyMessage("Could not copy automatically. Select the token and copy it.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={openChanged}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>Create token</Button>
      </DialogTrigger>
      <DialogContent>
        {shown === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Create a token</DialogTitle>
              <DialogDescription>
                The agent sends it as <code>Authorization: Bearer …</code> on every request.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={(event) => void submit(event)} className="grid gap-4" noValidate>
              <div className="grid gap-1.5">
                <label htmlFor="token-name" className="text-sm font-medium">
                  Token name
                </label>
                <Input
                  id="token-name"
                  value={name}
                  maxLength={80}
                  placeholder="For example: CI runner"
                  onChange={(event) => {
                    setName(event.target.value);
                  }}
                  aria-invalid={nameError === null ? undefined : true}
                  autoComplete="off"
                />
                {nameError !== null && <p className="text-sm text-destructive">{nameError}</p>}
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-sm font-medium">Expires after</legend>
                {EXPIRY_OPTIONS.map((option) => (
                  <div key={option.value} className="flex items-center gap-2">
                    <input
                      type="radio"
                      id={`token-expiry-${option.value}`}
                      name="token-expiry"
                      checked={expiry === option.value}
                      onChange={() => {
                        setExpiry(option.value);
                      }}
                    />
                    <label htmlFor={`token-expiry-${option.value}`} className="text-sm">
                      {option.label}
                    </label>
                  </div>
                ))}
                {expiry === "never" && (
                  <p className="text-sm text-muted-foreground">
                    A token that never expires is valid until it is revoked.
                  </p>
                )}
              </fieldset>
              {formError !== null && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? "Creating…" : "Create token"}
                </Button>
              </DialogFooter>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Copy the token now</DialogTitle>
              <DialogDescription>
                This token will not be shown again. Store it where the agent reads its
                configuration.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <label htmlFor="token-value" className="text-sm font-medium">
                Token
              </label>
              <div className="flex gap-2">
                <Input
                  id="token-value"
                  ref={field}
                  readOnly
                  value={shown}
                  className="font-mono text-xs"
                  onFocus={(event) => {
                    event.target.select();
                  }}
                />
                <Button type="button" variant="outline" onClick={() => void copy()}>
                  Copy
                </Button>
              </div>
              <p role="status" className="min-h-5 text-sm text-muted-foreground">
                {copyMessage}
              </p>
            </div>
            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  openChanged(false);
                }}
              >
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
