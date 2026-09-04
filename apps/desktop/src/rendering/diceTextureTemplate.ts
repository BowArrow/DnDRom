import { DICE_TEXTURE_HEIGHT, DICE_TEXTURE_WIDTH } from "../persistence/diceThemes";

const NAMED_DICE_COLORS: Record<string, string> = {
  black: "#171419", blue: "#3979d6", bronze: "#a56a3a", brown: "#70462f", copper: "#b86b42",
  cyan: "#35c7d4", emerald: "#168b65", gold: "#d3a62d", green: "#3f9b55", indigo: "#4c50a8",
  ivory: "#eee3c5", lavender: "#a98bd4", orange: "#db7936", pink: "#e986b8", purple: "#8552b5",
  red: "#c94752", rose: "#d86f91", silver: "#aeb7c2", teal: "#238e8a", turquoise: "#35aaa4",
  violet: "#744bb5", white: "#eeeae1", yellow: "#dcc74b",
};

/** Uses the first explicit color in the prompt; a manually selected swatch can bypass this at the call site. */
export function inferDiceBodyColor(description: string, fallback: string): string {
  const hex = description.match(/#[0-9a-f]{6}\b/i)?.[0];
  if (hex) return hex.toLowerCase();
  const match = description.toLowerCase().match(new RegExp(`\\b(${Object.keys(NAMED_DICE_COLORS).join("|")})\\b`));
  return match ? NAMED_DICE_COLORS[match[1]] : fallback;
}

export const diceTextureAiPrompt = (description: string, bodyColor?: string): string => [
  "Create a seamless 2:1 tiled PBR albedo texture for physical tabletop dice.",
  `Design: ${description.trim() || "enchanted fantasy resin with restrained ornamental detail"}.`,
  bodyColor ? `Hard color constraint: the dominant body and background color is ${bodyColor}; preserve that hue and do not substitute a different color family or introduce green/teal unless explicitly requested.` : "",
  "The image must be exactly twice as wide as it is tall, tile seamlessly across all outer edges, and contain only surface material—not a rendered die, text, numbers, borders, shadows, highlights, perspective, or lighting.",
  "Use even neutral illumination. Preserve medium-scale detail so engraved numbers remain readable over it.",
  "Return the albedo/base-color map only. DnDRom can derive editable normal, roughness, metallic, and ambient-occlusion starter maps locally.",
].filter(Boolean).join(" ");

const downloadBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export async function createDiceTextureTemplate(): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = DICE_TEXTURE_WIDTH;
  canvas.height = DICE_TEXTURE_HEIGHT;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#b9b5aa";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "rgba(255,255,255,.12)");
  gradient.addColorStop(.5, "rgba(255,255,255,0)");
  gradient.addColorStop(1, "rgba(0,0,0,.12)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.lineWidth = 2;
  for (let column = 0; column <= 12; column++) {
    const x = Math.round(column / 12 * canvas.width);
    context.strokeStyle = column === 0 || column === 12 ? "#b33434" : column === 6 ? "rgba(77,52,128,.8)" : "rgba(46,42,35,.28)";
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, canvas.height); context.stroke();
  }
  for (let row = 0; row <= 6; row++) {
    const y = Math.round(row / 6 * canvas.height);
    context.strokeStyle = row === 3 ? "rgba(77,52,128,.8)" : "rgba(46,42,35,.28)";
    context.beginPath(); context.moveTo(0, y); context.lineTo(canvas.width, y); context.stroke();
  }

  context.fillStyle = "rgba(20,16,12,.88)";
  context.fillRect(36, 34, 980, 124);
  context.fillStyle = "#f2e5bd";
  context.font = "bold 34px Georgia";
  context.fillText("DNDROM · UNIVERSAL DICE SURFACE", 64, 82);
  context.font = "23px Arial";
  context.fillText("2048 × 1024 · 2:1 face projection · all outer edges should tile", 64, 122);
  context.fillStyle = "rgba(123,30,30,.92)";
  context.fillRect(0, 166, 16, canvas.height - 332);
  context.fillRect(canvas.width - 16, 166, 16, canvas.height - 332);
  context.save();
  context.translate(42, canvas.height / 2);
  context.rotate(-Math.PI / 2);
  context.fillStyle = "#7b1e1e";
  context.font = "bold 22px Arial";
  context.textAlign = "center";
  context.fillText("TILE EDGE — MATCH OPPOSITE EDGE", 0, 0);
  context.restore();
  context.save();
  context.translate(canvas.width - 42, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.fillStyle = "#7b1e1e";
  context.fillText("TILE EDGE — MATCH OPPOSITE EDGE", 0, 0);
  context.restore();
  context.fillStyle = "rgba(20,16,12,.72)";
  context.fillRect(520, canvas.height - 74, 1008, 42);
  context.fillStyle = "#f2e5bd";
  context.font = "20px Arial";
  context.textAlign = "center";
  context.fillText("Paint across the full canvas. Dice numbers are separate engraved decals.", canvas.width / 2, canvas.height - 46);
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not create dice texture template")), "image/png"));
}

export async function downloadDiceTextureTemplate(): Promise<void> {
  downloadBlob(await createDiceTextureTemplate(), "DnDRom_Dice_Surface_Template_2048x1024.png");
}

export function downloadDiceTexturePrompt(description: string, bodyColor?: string): void {
  const guide = [
    "DNDROM DICE TEXTURE AI GUIDE",
    "================================",
    diceTextureAiPrompt(description, bodyColor),
    "",
    "Import the generated image as Albedo in Dice Forge. Use Generate starter PBR maps, or paint matching Normal (OpenGL +Y), Roughness, Metallic, AO, and grayscale Energy Mask maps with the same dimensions. White Energy Mask pixels glow; black pixels remain unlit.",
    "Numbers are rendered separately by DnDRom; do not paint numbers into the surface texture.",
  ].join("\n");
  downloadBlob(new Blob([guide], { type: "text/plain;charset=utf-8" }), "DnDRom_Dice_AI_Prompt_and_PBR_Guide.txt");
}
