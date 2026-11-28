import { describe, expect, it } from "vitest";

import { ApiFailure } from "@/lib/api-client";

import { sprintRuleSentence } from "./messages";

describe("the sentences of the sprint rules (WS-144 section 9, test 11)", () => {
  it("explains each of the four codes in words", () => {
    const sentence = (code: string) => sprintRuleSentence(new ApiFailure(409, code, []));

    expect(sentence("no_active_sprint")).toBe(
      "No sprint is active. Start one from the backlog to put tasks on the board.",
    );
    expect(sentence("subtask_follows_parent")).toBe(
      "A sub-task stays where its parent is. Move the parent instead.",
    );
    expect(sentence("sprint_completed")).toBe("This task belongs to a completed sprint's record.");
    expect(sentence("sprints_disabled")).toBe("This project does not use sprints.");
  });

  it("has nothing to say about any other failure", () => {
    expect(sprintRuleSentence(new ApiFailure(409, "version_conflict", []))).toBeNull();
    expect(sprintRuleSentence(new Error("offline"))).toBeNull();
  });
});
