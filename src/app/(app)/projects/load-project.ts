import { notFound } from "next/navigation";

import { projectParamsSchema } from "@/lib/schemas/projects";
import type { Actor } from "@/server/auth/actor";
import { ApiError } from "@/server/http/errors";
import { getProject } from "@/server/services/projects";

/** The project a page is about, or Next's not-found page for an unknown or malformed key. */
export async function loadProject(actor: Actor, key: string) {
  if (!projectParamsSchema.safeParse({ projectId: key }).success) {
    notFound();
  }
  try {
    return await getProject(actor, key);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}
