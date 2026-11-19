import { z } from "zod";

/** A person or an AI agent (doc 0001 section 3). */
export const accountKindSchema = z.enum(["human", "agent"]).meta({ id: "AccountKind" });

export type AccountKind = z.infer<typeof accountKindSchema>;

/** An account a task or a comment names: its reporter or author (WT-05 decision 10). */
export const accountRefSchema = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    kind: accountKindSchema.meta({ description: "`agent` for an AI agent account." }),
  })
  .meta({ id: "AccountRef" });

export type AccountRef = z.infer<typeof accountRefSchema>;
