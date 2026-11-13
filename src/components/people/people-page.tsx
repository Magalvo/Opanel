"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ManagedAccount } from "@/lib/schemas/accounts";

import { ApiFailure, createLink, listAccounts, revokeInvitation, updateAccount } from "./api";
import { type Invited, InviteDialog } from "./invite-dialog";
import { LinkDialog, type ShownLink } from "./link-dialog";
import { PeopleTable } from "./people-table";
import { ROLE_LABELS } from "./roles";

type Phase = "loading" | "error" | "ready";

type Confirmation =
  | { kind: "deactivate"; person: ManagedAccount }
  | { kind: "revoke"; person: ManagedAccount }
  | { kind: "role"; person: ManagedAccount; role: ManagedAccount["role"] };

const LAST_ADMIN =
  "This is the only active administrator, so they cannot be demoted or deactivated.";

/** What the confirmation dialog says for each change that is asked about first. */
function confirmationText(
  asking: Confirmation,
  isSelf: boolean,
): { title: string; description: string; action: string } {
  const { person } = asking;
  switch (asking.kind) {
    case "revoke":
      return {
        title: `Revoke the invitation of ${person.name}?`,
        description: `Their link stops working and the account is removed. ${person.email} can be invited again.`,
        action: "Revoke",
      };
    case "role":
      return {
        title: "Change your own role?",
        description: "This ends your session immediately. You will be signed out.",
        action: "Change role",
      };
    case "deactivate":
      return isSelf
        ? {
            title: "Deactivate your own account?",
            description: "This ends your session immediately. You will be signed out.",
            action: "Deactivate",
          }
        : {
            title: `Deactivate ${person.name}?`,
            description:
              "This ends their sessions immediately and removes their unused links. You can reactivate them later.",
            action: "Deactivate",
          };
  }
}

/** The Admin "People" page (WS-020): a client of the account management API. */
export function PeoplePage({ currentAccountId }: Readonly<{ currentAccountId: string }>) {
  const router = useRouter();
  const [people, setPeople] = useState<ManagedAccount[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [shownLink, setShownLink] = useState<ShownLink | null>(null);

  function showFirstPage(page: Awaited<ReturnType<typeof listAccounts>>) {
    setPeople(page.items);
    setNextCursor(page.nextCursor);
    setPhase("ready");
  }

  useEffect(() => {
    let cancelled = false;
    listAccounts().then(
      (page) => {
        if (!cancelled) showFirstPage(page);
      },
      () => {
        if (!cancelled) setPhase("error");
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function retry() {
    setPhase("loading");
    listAccounts().then(showFirstPage, () => {
      setPhase("error");
    });
  }

  async function loadMore() {
    if (nextCursor === null) return;
    setLoadingMore(true);
    try {
      const page = await listAccounts(nextCursor);
      setPeople((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      setMessage("Could not load more people. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  function replace(updated: ManagedAccount) {
    setPeople((current) => current.map((person) => (person.id === updated.id ? updated : person)));
  }

  /** The Admin's own session has ended if they changed their own role or deactivated themselves. */
  function leaveIfSelf(person: ManagedAccount) {
    if (person.id === currentAccountId) {
      router.replace("/sign-in");
      router.refresh();
    }
  }

  function failure(error: unknown, fallback: string) {
    setMessage(error instanceof ApiFailure && error.code === "last_admin" ? LAST_ADMIN : fallback);
  }

  async function changeRole(person: ManagedAccount, role: ManagedAccount["role"]) {
    try {
      const updated = await updateAccount(person.id, { role });
      replace(updated);
      setMessage(`${person.name}'s role is now ${ROLE_LABELS[role]}. They were signed out.`);
      leaveIfSelf(person);
    } catch (error) {
      failure(error, "Could not change the role. Try again.");
    }
  }

  async function setActive(person: ManagedAccount, active: boolean) {
    try {
      replace(await updateAccount(person.id, { active }));
      setMessage(
        active
          ? `${person.name} was reactivated.`
          : `${person.name} was deactivated and signed out.`,
      );
      if (!active) leaveIfSelf(person);
    } catch (error) {
      failure(
        error,
        active ? "Could not reactivate. Try again." : "Could not deactivate. Try again.",
      );
    }
  }

  async function newLink(person: ManagedAccount) {
    try {
      const { link } = await createLink(person.id);
      setShownLink({ title: person.status === "invited" ? "Invitation link" : "Reset link", link });
      setMessage(`A new link was created for ${person.name}.`);
    } catch {
      setMessage("Could not create the link. Try again.");
    }
  }

  async function revoke(person: ManagedAccount) {
    try {
      await revokeInvitation(person.id);
      setPeople((current) => current.filter((other) => other.id !== person.id));
      setMessage(`The invitation of ${person.name} was revoked.`);
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 409) {
        // They accepted in the meantime: show the list as it is now.
        setMessage(`${person.name} has already accepted the invitation.`);
        listAccounts().then(showFirstPage, () => undefined);
      } else {
        setMessage("Could not revoke. Try again.");
      }
    }
  }

  function invited({ account, link }: Invited) {
    if (nextCursor === null) {
      setPeople((current) => [...current, account]);
      setMessage(`Invited ${account.name}.`);
    } else {
      setMessage(`Invited ${account.name}. They appear at the end of the list.`);
    }
    setShownLink({ title: "Invitation link", link });
  }

  function confirmed() {
    const current = confirmation;
    setConfirmation(null);
    if (current?.kind === "deactivate") void setActive(current.person, false);
    if (current?.kind === "revoke") void revoke(current.person);
    if (current?.kind === "role") void changeRole(current.person, current.role);
  }

  const self = (person: ManagedAccount) => person.id === currentAccountId;
  const asking = confirmation;
  const text = asking === null ? null : confirmationText(asking, self(asking.person));

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">People</h1>
        <InviteDialog onInvited={invited} />
      </div>

      <div role="status" className="min-h-5 text-sm text-muted-foreground">
        {message}
      </div>

      {phase === "loading" && (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">Loading people…</p>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      )}

      {phase === "error" && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            Could not load people.
          </p>
          <Button variant="outline" size="sm" onClick={retry}>
            Retry
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <>
          <PeopleTable
            people={people}
            onRoleChange={(person, role) => {
              if (self(person)) setConfirmation({ kind: "role", person, role });
              else void changeRole(person, role);
            }}
            onDeactivate={(person) => {
              setConfirmation({ kind: "deactivate", person });
            }}
            onReactivate={(person) => void setActive(person, true)}
            onCreateLink={(person) => void newLink(person)}
            onRevoke={(person) => {
              setConfirmation({ kind: "revoke", person });
            }}
          />
          {nextCursor !== null && (
            <div>
              <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        {text !== null && (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{text.title}</AlertDialogTitle>
              <AlertDialogDescription>{text.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant={confirmation?.kind === "role" ? "default" : "destructive"}
                onClick={confirmed}
              >
                {text.action}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>

      <LinkDialog
        shown={shownLink}
        onClose={() => {
          setShownLink(null);
        }}
      />
    </div>
  );
}
