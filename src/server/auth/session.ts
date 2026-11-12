import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { ApiError } from "@/server/http/errors";

import { authenticate, type Authenticated } from "./authenticate";

/**
 * The signed-in account of the page request being rendered, or null. Cached for the
 * duration of the request, so the layout and a page can both ask without two lookups. It is
 * the same `authenticate` the API uses, so pages and API cannot disagree.
 */
export const getSession = cache(async (): Promise<Authenticated | null> => {
  const incoming = await headers();
  try {
    return await authenticate(new Request("http://opanel.invalid/", { headers: incoming }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
});

/**
 * Verifies the session with the database and redirects to the sign-in page if there is none.
 * A server component that reads data itself must call this and a permission check
 * (canonical doc 0004 section 7).
 */
export async function requireAccount(): Promise<Authenticated> {
  const session = await getSession();
  if (!session) {
    redirect("/sign-in");
  }
  return session;
}
