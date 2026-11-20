// Keeps the index in docs/README.md in step with the docs themselves (WS-096 section 5):
// every doc has one row and a status of its own, and no number is taken twice.
import { describe, expect, it } from "vitest";

import { type DocFile, indexProblems, read, thisRepositoryDocs } from "./doc-checks";

const INDEX = [
  "# Opanel docs index",
  "",
  "| Doc                                | Title     |",
  "| ---------------------------------- | --------- |",
  "| [0001](canonical/0001-triage.md)   | Triage    |",
  "",
  "| Track                              | Title     |",
  "| ---------------------------------- | --------- |",
  "| [WT-01](work-tracks/WT-01-base.md) | Base      |",
  "",
  "| Item                               | Title     | Spec                               |",
  "| ---------------------------------- | --------- | ---------------------------------- |",
  "| [WI-001](work-items/WI-001-one.md) | One       | [WS-001](work-specs/WS-001-one.md) |",
  "| [WI-002](work-items/WI-002-two.md) | Two       | [WS-002](work-specs/WS-002-two.md) |",
].join("\n");

function doc(path: string, status: string): DocFile {
  return { path, content: `# Title\n\n- Status: ${status}\n- Work-item: x\n` };
}

const DOCS: DocFile[] = [
  doc("canonical/0001-triage.md", "**Approved** (2026-11-12)"),
  doc("work-tracks/WT-01-base.md", "Done (approved by the owner on 2026-11-12)"),
  doc("work-items/WI-001-one.md", "Done"),
  doc("work-specs/WS-001-one.md", "Done (approved by the owner on 2026-11-13)"),
  // Reserved: its work-spec is not written yet, so its link has no file.
  doc("work-items/WI-002-two.md", "Draft"),
];

describe("indexProblems (WS-096)", () => {
  it("finds nothing in an index that matches its docs", () => {
    expect(indexProblems(INDEX, DOCS)).toEqual([]);
  });

  it("allows the work-spec link of an item that is Draft or Proposed", () => {
    const proposed = DOCS.map((d) =>
      d.path === "work-items/WI-002-two.md" ? doc(d.path, "Proposed") : d,
    );

    expect(indexProblems(INDEX, proposed)).toEqual([]);
  });

  it("names a work-spec link with no file once its item is past Proposed", () => {
    const approved = DOCS.map((d) =>
      d.path === "work-items/WI-002-two.md" ? doc(d.path, "In progress") : d,
    );

    expect(indexProblems(INDEX, approved)).toEqual([
      "the index links to work-specs/WS-002-two.md, which does not exist",
    ]);
  });

  it("names a doc with no row, and a row with no doc", () => {
    const docs = [
      ...DOCS.filter((d) => d.path !== "work-tracks/WT-01-base.md"),
      doc("work-items/WI-003-three.md", "Draft"),
    ];

    expect(indexProblems(INDEX, docs)).toEqual([
      "the index links to work-tracks/WT-01-base.md, which does not exist",
      "work-items/WI-003-three.md has no row in the index",
    ]);
  });

  it("names a row that appears twice", () => {
    const index = `${INDEX}\n| [WI-001](work-items/WI-001-one.md) | One again | |`;

    expect(indexProblems(index, DOCS)).toEqual([
      "work-items/WI-001-one.md has 2 rows in the index",
    ]);
  });

  it("names a missing status, and a status outside the list", () => {
    const docs = DOCS.map((d) => {
      if (d.path === "work-items/WI-001-one.md") return { path: d.path, content: "# One\n" };
      if (d.path === "work-specs/WS-001-one.md") return doc(d.path, "Finished");
      return d;
    });

    expect(indexProblems(INDEX, docs)).toEqual([
      "work-items/WI-001-one.md has no Status line",
      'work-specs/WS-001-one.md has the status "Finished"',
    ]);
  });

  it("names a work-spec with no work-item of the same number", () => {
    const index = `${INDEX}\n| [WS-009](work-specs/WS-009-lost.md) | Lost | |`;
    const docs = [...DOCS, doc("work-specs/WS-009-lost.md", "Proposed")];

    expect(indexProblems(index, docs)).toEqual(["work-specs/WS-009-lost.md has no work-item"]);
  });

  it("names a number used twice, and a file name in the wrong form", () => {
    const index = [
      INDEX,
      "| [WI-001](work-items/WI-001-again.md) | Again | |",
      "| [WI-4](work-items/WI-4-short.md) | Short | |",
    ].join("\n");
    const docs = [
      ...DOCS,
      doc("work-items/WI-001-again.md", "Draft"),
      doc("work-items/WI-4-short.md", "Draft"),
    ];

    expect(indexProblems(index, docs)).toEqual([
      "WI-001 is used by 2 docs",
      "work-items/WI-4-short.md is not named WI-NNN-slug.md",
    ]);
  });

  it("names a status column", () => {
    const index = INDEX.replace(
      "| Track                              | Title     |",
      "| Track                              | Status    |",
    );

    expect(indexProblems(index, DOCS)).toEqual(["the index has a status column"]);
  });
});

describe("docs/README.md (WS-096)", () => {
  it("lists every doc once, and every doc has a status of its own", () => {
    expect(indexProblems(read("docs/README.md"), thisRepositoryDocs())).toEqual([]);
  });
});
