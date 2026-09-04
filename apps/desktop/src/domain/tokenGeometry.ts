import type { TokenBaseShape } from "./types";

export interface TokenBaseGeometry {
  primitive: "box" | "cylinder";
  capSegments?: number;
}

/** Shared by Forge and the tabletop so the preview is the piece that gets placed. */
export function tokenBaseGeometry(shape: TokenBaseShape): TokenBaseGeometry {
  if (shape === "square") return { primitive: "box" };
  if (shape === "hex") return { primitive: "cylinder", capSegments: 6 };
  return { primitive: "cylinder", capSegments: 48 };
}
