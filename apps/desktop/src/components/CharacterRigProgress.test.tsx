// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Character Forge rigging progress", () => {
  it("gives the active step the available width and fully collapses inactive copy", () => {
    const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
    const source = readFileSync(resolve(process.cwd(), "src/components/CharacterTokenStudio.tsx"), "utf8");

    expect(source).toContain("active-step-${rigWorkflowStep}");
    expect(source).toContain('entry.step === rigWorkflowStep && <small>{entry.detail}</small>');
    expect(css).toMatch(/\.rig-pipeline-steps\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+38px\s+38px/);
    expect(css).toMatch(/\.rig-pipeline-steps\.active-step-2\s*\{[^}]*38px\s+minmax\(0,\s*1fr\)\s+38px/);
    expect(css).toMatch(/\.rig-pipeline-steps\.active-step-3\s*\{[^}]*38px\s+38px\s+minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.rig-pipeline-steps li\.collapsed div,[\s\S]*?display:\s*none/);
    expect(css).not.toMatch(/\.rig-pipeline-steps li strong\s*\{[^}]*white-space:\s*nowrap/);
  });
});
