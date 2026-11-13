import { notFound } from "next/navigation";

import { PeoplePage } from "@/components/people/people-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "People" };

/**
 * The Admin "People" page (WS-020). For anyone without `accounts:manage` it is a plain
 * not-found page, so it does not confirm that it exists. The data itself is read by the
 * browser through `/api/v1/accounts`, which enforces the same permission.
 */
export default async function PeopleRoute() {
  const { actor, account } = await requireAccount();
  if (!can(actor, "accounts:manage")) {
    notFound();
  }

  return <PeoplePage currentAccountId={account.id} />;
}
