import { EpicsPage, type EpicsShow } from "@/components/epics/epics-page";
import { can } from "@/server/auth/actor";
import { requireAccount } from "@/server/auth/session";

export const metadata = { title: "Epics" };

/**
 * A project's epics (WS-039). Everyone signed in reads them; Managers and Admins create,
 * edit, close and reopen them. `?show=closed` or `?show=all` changes the list; the layout
 * has already checked the project key.
 */
export default async function EpicsRoute({
  searchParams,
}: {
  searchParams: Promise<{ show?: string | string[] }>;
}) {
  const { actor } = await requireAccount();
  const given = (await searchParams).show;
  const show: EpicsShow = given === "closed" || given === "all" ? given : "open";

  // A new key per choice, so changing it starts from a fresh list.
  return <EpicsPage key={show} show={show} canManageEpics={can(actor, "epics:manage")} />;
}
