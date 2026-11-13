import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { positionsBetween } from "@/lib/position";
import { getDb } from "@/server/db/client";

import { columns, projects } from ".";

// WT-03 amendment A2: positions compare by byte, so the database must order them exactly as
// src/lib/position.ts does, whatever the install's collation.
describe("columns.position", () => {
  it("is declared with the C collation", async () => {
    const [row] = await getDb().execute<{ collation_name: string | null }>(sql`
      select collation_name from information_schema.columns
      where table_name = 'columns' and column_name = 'position'`);

    expect(row?.collation_name).toBe("C");
  });

  it("comes back from order by position in the library's order, also for keys differing by case", async () => {
    const [project] = await getDb()
      .insert(projects)
      .values({ key: "OPA", name: "Opanel" })
      .returning();
    const keys = positionsBetween(null, null, 40);
    expect(keys).toContain("aZ");
    expect(keys).toContain("aa");
    // Inserted in reverse, so the order can only come from the sort.
    for (const [index, position] of [...keys].reverse().entries()) {
      await getDb()
        .insert(columns)
        .values({
          projectId: project?.id ?? "",
          name: `C${String(index)}`,
          category: "todo",
          position,
        });
    }

    const rows = await getDb().execute<{ position: string }>(
      sql`select position from columns order by position`,
    );

    expect(rows.map((row) => row.position)).toEqual(keys);
  });

  it("is unique within a project", async () => {
    const [project] = await getDb()
      .insert(projects)
      .values({ key: "OPA", name: "Opanel" })
      .returning();
    const values = { projectId: project?.id ?? "", name: "A", category: "todo", position: "a0" };
    await getDb().insert(columns).values(values);

    await expect(
      getDb()
        .insert(columns)
        .values({ ...values, name: "B" }),
    ).rejects.toThrow();
  });
});
