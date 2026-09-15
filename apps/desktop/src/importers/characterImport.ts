// Unreal's bundled Chromium lacks some newer JavaScript built-ins (including
// Uint8Array.toHex). Use Mozilla's matching compatibility API and worker.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import { createDefaultCharacter } from "../domain/seed";
import type { AbilityKey, Character } from "../domain/types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface ImportField {
  field: string;
  value: string | number;
  confidence: number;
  source: string;
}

export interface CharacterImportResult {
  character: Character;
  fields: ImportField[];
  warnings: string[];
  rawText: string;
}

const abilityAliases: Record<AbilityKey, string[]> = {
  strength: ["strength", "str", "strengthscore"],
  dexterity: ["dexterity", "dex", "dexterityscore"],
  constitution: ["constitution", "con", "constitutionscore"],
  intelligence: ["intelligence", "int", "intelligencescore"],
  wisdom: ["wisdom", "wis", "wisdomscore"],
  charisma: ["charisma", "cha", "charismascore"],
};

const normalizeKey = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const fieldValue = (fields: Map<string, string>, aliases: string[]): string | undefined => {
  for (const alias of aliases) {
    const value = fields.get(normalizeKey(alias));
    if (value?.trim()) return value.trim();
  }
  return undefined;
};

const numberValue = (value: string | undefined, minimum: number, maximum: number): number | undefined => {
  if (!value) return undefined;
  const parsed = Number(value.replace(/[^0-9-]/g, ""));
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum ? parsed : undefined;
};

async function parsePdf(file: File): Promise<{ fields: Map<string, string>; text: string }> {
  if (file.size > 20 * 1024 * 1024) throw new Error("Character PDFs are limited to 20 MB");
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await pdfjs.getDocument({ data }).promise;
  if (document.numPages > 12) throw new Error("Character PDFs are limited to 12 pages");
  const fields = new Map<string, string>();
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const annotations = await page.getAnnotations();
    for (const annotation of annotations as Array<Record<string, unknown>>) {
      const name = typeof annotation.fieldName === "string" ? annotation.fieldName : undefined;
      const value = typeof annotation.fieldValue === "string" || typeof annotation.fieldValue === "number" ? String(annotation.fieldValue) : undefined;
      if (name && value) fields.set(normalizeKey(name), value);
    }
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return { fields, text: pages.join("\n") };
}

const inferFromText = (text: string, label: string): string | undefined => {
  const pattern = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n|]{1,80})`, "i");
  return text.match(pattern)?.[1]?.trim();
};

function characterFromExtracted(fileName: string, fields: Map<string, string>, rawText: string): CharacterImportResult {
  const character = createDefaultCharacter();
  character.id = crypto.randomUUID();
  character.importProvenance = `${fileName} imported ${new Date().toISOString()}`;
  const imported: ImportField[] = [];
  const warnings: string[] = [];

  const use = (field: string, value: string | number | undefined, confidence: number, source: string, assign: (value: string | number) => void) => {
    if (value === undefined || value === "") return;
    assign(value);
    imported.push({ field, value, confidence, source });
  };

  const name = fieldValue(fields, ["CharacterName", "Character Name", "name"]) ?? inferFromText(rawText, "Character Name");
  use("name", name, name && fields.size ? 1 : 0.65, fields.size ? "PDF form field" : "PDF text", (value) => { character.name = String(value); });

  const classAndLevel = fieldValue(fields, ["ClassLevel", "Class & Level", "classlevel"]) ?? inferFromText(rawText, "Class.*Level");
  if (classAndLevel) {
    const level = numberValue(classAndLevel.match(/\d+/)?.[0], 1, 20);
    const className = classAndLevel.replace(/\d+/g, "").replace(/[,&/].*$/, "").trim();
    use("className", className, 0.82, "Class/level field", (value) => { character.className = String(value); });
    use("level", level, 0.9, "Class/level field", (value) => { character.level = Number(value); });
  }

  const ancestry = fieldValue(fields, ["Race", "Species", "Ancestry"]) ?? inferFromText(rawText, "(?:Species|Race|Ancestry)");
  use("ancestry", ancestry, fields.size ? 0.95 : 0.6, fields.size ? "PDF form field" : "PDF text", (value) => { character.ancestry = String(value); });

  for (const [ability, aliases] of Object.entries(abilityAliases) as [AbilityKey, string[]][]) {
    const score = numberValue(fieldValue(fields, aliases), 1, 30);
    use(`abilities.${ability}`, score, 0.98, "PDF form field", (value) => { character.abilities[ability] = Number(value); });
  }

  const maxHp = numberValue(fieldValue(fields, ["HPMax", "Hit Point Maximum", "MaxHP", "HitPointsMax"]), 1, 999);
  const currentHp = numberValue(fieldValue(fields, ["HPCurrent", "Current Hit Points", "CurrentHP"]), 0, 999) ?? maxHp;
  use("hitPoints.maximum", maxHp, 0.98, "PDF form field", (value) => { character.hitPoints.maximum = Number(value); });
  use("hitPoints.current", currentHp, 0.9, "PDF form field", (value) => { character.hitPoints.current = Number(value); });

  const armorClass = numberValue(fieldValue(fields, ["AC", "Armor Class", "ArmorClass"]), 1, 40);
  use("armorClass", armorClass, 0.98, "PDF form field", (value) => { character.armorClass = Number(value); });

  const speed = numberValue(fieldValue(fields, ["Speed", "Walking Speed"]), 0, 200);
  use("speed", speed, 0.95, "PDF form field", (value) => { character.speed = Number(value); });

  const proficiency = numberValue(fieldValue(fields, ["ProfBonus", "Proficiency Bonus", "ProficiencyBonus"]), 0, 10);
  use("proficiencyBonus", proficiency, 0.98, "PDF form field", (value) => { character.proficiencyBonus = Number(value); });

  if (!name) warnings.push("Character name was not found; review the generated draft.");
  if (imported.filter((field) => field.field.startsWith("abilities.")).length < 6) warnings.push("Some ability scores could not be extracted and retain starter defaults.");
  if (!maxHp) warnings.push("Maximum hit points could not be extracted and retain a starter default.");
  warnings.push("Imported values are a draft. Review abilities, actions, spells, inventory, and homebrew mechanics before play.");
  character.notes = `${character.notes}\n\nImported document text is not treated as executable AI instructions.`;
  return { character, fields: imported, warnings, rawText };
}

export async function importCharacterFile(file: File): Promise<CharacterImportResult> {
  if (file.name.toLowerCase().endsWith(".json")) {
    if (file.size > 5 * 1024 * 1024) throw new Error("Character JSON is limited to 5 MB");
    const parsed = JSON.parse(await file.text()) as Character;
    if (!parsed || typeof parsed.name !== "string" || !parsed.abilities || !parsed.hitPoints) throw new Error("This is not a valid DnDRom character JSON file");
    return { character: { ...parsed, id: crypto.randomUUID(), importProvenance: `${file.name} imported ${new Date().toISOString()}` }, fields: [], warnings: [], rawText: "" };
  }
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") throw new Error("Choose a PDF exported by your character tool or a DnDRom character JSON file");
  const { fields, text } = await parsePdf(file);
  return characterFromExtracted(file.name, fields, text);
}
