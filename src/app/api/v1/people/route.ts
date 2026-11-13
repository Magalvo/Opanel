import { listPeopleContract, peopleQuerySchema } from "@/lib/schemas/people";
import { json, readQuery, route } from "@/server/http/route";
import { listPeople } from "@/server/services/people";

export const dynamic = "force-dynamic";

export const GET = route(listPeopleContract, async (request, _context, { actor }) => {
  const query = readQuery(request, peopleQuerySchema);

  return json(await listPeople(actor, query));
});
