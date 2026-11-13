import {
  createProjectContract,
  createProjectRequestSchema,
  listProjectsContract,
  projectQuerySchema,
} from "@/lib/schemas/projects";
import { json, readJson, readQuery, route } from "@/server/http/route";
import { createProject, listProjects } from "@/server/services/projects";

export const dynamic = "force-dynamic";

export const GET = route(listProjectsContract, async (request, _context, { actor }) => {
  const query = readQuery(request, projectQuerySchema);

  return json(await listProjects(actor, query));
});

export const POST = route(createProjectContract, async (request, _context, { actor }) => {
  const body = await readJson(request, createProjectRequestSchema);

  return json(await createProject(actor, body), 201);
});
