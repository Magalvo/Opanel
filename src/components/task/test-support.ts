import type { Comment } from "@/lib/schemas/comments";
import type { Task } from "@/lib/schemas/tasks";

import { columns, DOING, DONE, fullTask, t3, TODO } from "../board/test-support";
import { on, PROJECT_ID } from "../projects/test-support";

export { columns, DOING, DONE, TODO };

export const MIA = { id: "11111111-1111-4111-8111-111111111111", name: "Mia", active: true };
export const GRACE = { id: "55555555-5555-4555-8555-555555555555", name: "Grace", active: true };
export const MAX = { id: "44444444-4444-4444-8444-444444444444", name: "Max", active: false };

export const PLATFORM = { id: "22222222-2222-4222-8222-222222222222", name: "Platform" };
export const DESIGN = { id: "66666666-6666-4666-8666-666666666666", name: "Design" };

export const AUTH = { id: "33333333-3333-4333-8333-333333333333", title: "Auth" };
export const BILLING = { id: "77777777-7777-4777-8777-777777777777", title: "Billing" };

/** OPA-3 in To do's neighbour column, with a team, a person, an epic and a description. */
export const detailed: Task = fullTask(t3, {
  description: "Some **bold** text and a [link](https://a.test).",
});

export function comment(
  id: string,
  body: string,
  author = MIA.name,
  createdAt = "2026-11-14T10:00:00.000Z",
): Comment {
  return {
    id: `cccccccc-cccc-4ccc-8ccc-${id.padStart(12, "0")}`,
    taskId: detailed.id,
    kind: "user",
    author: { id: MIA.id, name: author },
    body,
    createdAt,
  };
}

const BASE = `/api/v1/projects/${PROJECT_ID}`;

/** Registers the lists the screen loads: columns, teams, open epics and the comments. */
export function registerLists(
  options: {
    comments?: Comment[];
    commentsCursor?: string | null;
    epics?: { id: string; title: string }[];
  } = {},
) {
  const epics = options.epics ?? [AUTH, BILLING];
  on(`GET ${BASE}/columns`, () => Response.json({ items: columns, nextCursor: null }));
  on("GET /api/v1/teams?limit=100", () =>
    Response.json({
      items: [PLATFORM, DESIGN].map((team) => ({
        ...team,
        memberCount: 1,
        createdAt: "2026-11-12T10:00:00.000Z",
      })),
      nextCursor: null,
    }),
  );
  on(`GET ${BASE}/epics?limit=100`, () =>
    Response.json({
      items: epics.map((epic) => ({
        id: epic.id,
        projectId: PROJECT_ID,
        title: epic.title,
        description: "",
        status: "open",
        startDate: null,
        targetDate: null,
        progress: { doneTasks: 0, totalTasks: 0 },
        version: 1,
        createdAt: "2026-11-12T10:00:00.000Z",
        updatedAt: "2026-11-12T10:00:00.000Z",
      })),
      nextCursor: null,
    }),
  );
  on(`GET /api/v1/tasks/${detailed.key}/comments?limit=50`, () =>
    Response.json({ items: options.comments ?? [], nextCursor: options.commentsCursor ?? null }),
  );
}
