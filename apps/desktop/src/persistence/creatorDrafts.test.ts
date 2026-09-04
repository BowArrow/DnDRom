// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { clearCreatorDraft, readCreatorDraft, writeCreatorDraft, type SceneForgeDraft } from "./creatorDrafts";

describe("creator draft metadata", () => {
  beforeEach(() => window.localStorage.clear());

  it("restores an unfinished scene independently for each campaign", () => {
    const draft: SceneForgeDraft = { sourceMode: "prompt", description: "Moonlit harbor", selectedHdriId: "", updatedAt: "now" };
    writeCreatorDraft("campaign-a", "scene", draft);
    expect(readCreatorDraft<SceneForgeDraft>("campaign-a", "scene")?.description).toBe("Moonlit harbor");
    expect(readCreatorDraft("campaign-b", "scene")).toBeNull();
    clearCreatorDraft("campaign-a", "scene");
    expect(readCreatorDraft("campaign-a", "scene")).toBeNull();
  });
});
