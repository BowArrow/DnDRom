import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Character Forge catalogue and new-draft lifecycle", () => {
  const studio = readFileSync(resolve(process.cwd(), "src/components/CharacterTokenStudio.tsx"), "utf8");
  const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

  it("opens a searchable preview catalogue with editor and scene actions", () => {
    expect(studio).toContain("Character catalogue");
    expect(studio).toContain("Search characters, forms, or styles");
    expect(studio).toContain("Open in editor");
    expect(studio).toContain("Use in current scene");
    expect(studio).not.toContain("token-library-strip character-catalogue");
  });

  it("checkpoints a model and clears only the character draft before a clean remount", () => {
    expect(studio).toContain("persistModelToLibrary(model, true, savedAssetId)");
    expect(studio).toContain("clearCreatorDraftFiles(campaignId, \"character\")");
    expect(studio).toContain("clearCreatorDraft(campaignId, \"character\")");
    expect(studio).toContain("if (!model && (drawing || originalDrawing))");
    expect(app).toContain("key={`character-forge-${campaign.id}-${characterDraftSession}`}");
    expect(app).toContain("setCharacterDraftSession((value) => value + 1)");
  });
});
