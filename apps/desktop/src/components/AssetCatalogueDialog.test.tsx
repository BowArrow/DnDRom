// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetCatalogueDialog } from "./AssetCatalogueDialog";

describe("AssetCatalogueDialog", () => {
  const items = [
    { id: "pond", name: "Frog Pond", searchText: "lily pad swamp", preview: <span>Pond preview</span>, details: <>pond · local AI</>, actions: <button>Open pond</button> },
    { id: "inn", name: "Inn Floor", searchText: "tavern woodboards", preview: <span>Inn preview</span>, details: <>tavern · imported</>, actions: <button>Open inn</button> },
  ];

  it("provides the same searchable preview gallery and actions for every asset family", () => {
    render(<AssetCatalogueDialog ariaLabel="Baseplate catalogue" eyebrow="Local catalogue" title="Choose a base" description="Reusable bases" searchPlaceholder="Search bases" items={items} empty={null} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog", { name: "Baseplate catalogue" })).toBeTruthy();
    expect(screen.getByText("Pond preview")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search bases"), { target: { value: "woodboards" } });
    expect(screen.queryByText("Pond preview")).toBeNull();
    expect(screen.getByText("Inn preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open inn" })).toBeTruthy();
  });

  it("closes from Escape or the backdrop without swallowing card clicks", () => {
    const onClose = vi.fn();
    const { container } = render(<AssetCatalogueDialog ariaLabel="Prop catalogue" eyebrow="Local catalogue" title="Choose a prop" description="Reusable props" searchPlaceholder="Search props" items={items} empty={null} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(container.querySelector(".modal-backdrop")!);
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.mouseDown(container.querySelector("[role='dialog']")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
