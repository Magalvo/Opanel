import {
  commentQuerySchema,
  createCommentContract,
  createCommentRequestSchema,
  listCommentsContract,
} from "@/lib/schemas/comments";
import { taskParamsSchema } from "@/lib/schemas/tasks";
import { json, readJson, readParams, readQuery, route } from "@/server/http/route";
import { createComment, listComments } from "@/server/services/comments";

export const dynamic = "force-dynamic";

interface Context {
  params: Promise<unknown>;
}

export const GET = route(listCommentsContract, async (request, context: Context, { actor }) => {
  const { taskId } = await readParams(context.params, taskParamsSchema);
  const query = readQuery(request, commentQuerySchema);

  return json(await listComments(actor, taskId, query));
});

export const POST = route(createCommentContract, async (request, context: Context, { actor }) => {
  const { taskId } = await readParams(context.params, taskParamsSchema);
  const body = await readJson(request, createCommentRequestSchema);

  return json(await createComment(actor, taskId, body), 201);
});
