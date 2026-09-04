// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { compileTokenAnimation } from "../domain/tokenAnimation";
import { TokenStateAnimationEditor, type ForgeTokenStateDraft } from "./TokenStateAnimationEditor";

const model = new File([new Uint8Array([1, 2, 3])], "hero.glb", { type: "model/gltf-binary" });
const rig = new File([new Uint8Array([4, 5, 6])], "hero-rig.fbx", { type: "application/octet-stream" });

afterEach(cleanup);

function Harness({ initial, activeId = initial[0].id }: { initial: ForgeTokenStateDraft[]; activeId?: string }) {
  const [states, setStates] = useState(initial);
  const [active, setActive] = useState(activeId);
  const selected = states.find((state) => state.id === active) ?? states[0];
  return <>
    <output data-testid="state-summary">{JSON.stringify(states.map((state) => ({ id: state.id, formId: state.formId, rig: state.riggedModel?.name, motions: state.animations.map((animation) => animation.name) })))}</output>
    <TokenStateAnimationEditor states={states} activeStateId={active} defaultModel={model} rigReady={Boolean(selected.riggedModel)} busy={false} onActiveStateChange={setActive} onStatesChange={setStates} onModelReplace={() => undefined} onGenerateMotion={() => undefined} onRestoreRevision={() => undefined} />
  </>;
}

describe("token form, style, rig, and motion authoring", () => {
  it("creates a new visual style with the form rig and independently copied motions", () => {
    const idle = compileTokenAnimation("Breathe gently", "idle", { id: "idle-a", name: "Guard idle" });
    render(<Harness initial={[{ id: "style-a", formId: "form-a", name: "Hero", styleName: "Classic", model: null, riggedModel: rig, rigSlot: "character-rig-style-a", rigProfile: "humanoid", animations: [idle], revisions: [] }]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add token style" }));

    expect(screen.getAllByRole("tab", { name: /Classic|Style 2/ })).toHaveLength(2);
    const summary = JSON.parse(screen.getByTestId("state-summary").textContent ?? "[]") as Array<{ id: string; formId: string; rig?: string; motions: string[] }>;
    expect(summary).toHaveLength(2);
    expect(summary[1]).toMatchObject({ formId: "form-a", rig: "hero-rig.fbx", motions: ["Guard idle"] });
    expect(summary[1].id).not.toBe(summary[0].id);
  });

  it("copies a reusable motion into another form with a new identity", async () => {
    const attack = compileTokenAnimation("Slash and return", "attack", { id: "attack-a", name: "Sword slash" });
    render(<Harness activeId="wolf" initial={[
      { id: "hero", formId: "hero", name: "Hero", styleName: "Classic", model: null, riggedModel: rig, animations: [attack], revisions: [] },
      { id: "wolf", formId: "wolf", name: "Wolf", styleName: "Dire", model, riggedModel: null, animations: [], revisions: [] },
    ]} />);

    const select = screen.getByRole("combobox", { name: "Reusable animation" }) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "attack-a" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Apply copy" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Apply copy" }));

    await waitFor(() => expect(screen.getByTestId("state-summary").textContent).toContain("Sword slash"));
    const summary = JSON.parse(screen.getByTestId("state-summary").textContent ?? "[]") as Array<{ motions: string[] }>;
    expect(summary[1].motions).toEqual(["Sword slash"]);
    expect((screen.getByRole("textbox", { name: "Animation name" }) as HTMLInputElement).value).toBe("Sword slash");
  });
});
