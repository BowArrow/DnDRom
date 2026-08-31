import { z } from "zod";
import type { Campaign } from "../domain/types";

export const SESSION_PROTOCOL_VERSION = 1 as const;

const campaignEnvelopeSchema = z.object({
  type: z.literal("campaign.snapshot"),
  revision: z.number().int().nonnegative(),
  campaign: z.custom<Campaign>((value) => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<Campaign>;
    return candidate.schemaVersion === 1 && typeof candidate.id === "string" && typeof candidate.name === "string" && Boolean(candidate.map);
  }),
});

const presenceEnvelopeSchema = z.object({
  type: z.literal("presence"),
  name: z.string().min(1).max(80),
});

export const sessionEnvelopeSchema = z.discriminatedUnion("type", [campaignEnvelopeSchema, presenceEnvelopeSchema]);
export type SessionEnvelope = z.infer<typeof sessionEnvelopeSchema>;

export const encodeEnvelope = (message: SessionEnvelope): string => JSON.stringify({ v: SESSION_PROTOCOL_VERSION, ...message });

export const decodeEnvelope = (raw: string | unknown): SessionEnvelope | null => {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (value?.v !== SESSION_PROTOCOL_VERSION) return null;
    const parsed = sessionEnvelopeSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

export const generateRoomCode = (): string => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
};
