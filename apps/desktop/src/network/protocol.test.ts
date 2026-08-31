import { describe, expect, it } from "vitest";
import { createStarterCampaign } from "../domain/seed";
import { decodeEnvelope, encodeEnvelope, generateRoomCode } from "./protocol";

describe("session protocol", () => {
  it("round trips campaign snapshots", () => {
    const campaign = createStarterCampaign();
    const decoded = decodeEnvelope(encodeEnvelope({ type: "campaign.snapshot", revision: campaign.revision, campaign }));
    expect(decoded?.type).toBe("campaign.snapshot");
  });

  it("rejects unsupported protocol versions", () => {
    expect(decodeEnvelope(JSON.stringify({ v: 99, type: "presence", name: "Aria" }))).toBeNull();
  });

  it("creates readable six-character room codes", () => {
    expect(generateRoomCode()).toMatch(/^[A-Z2-9]{6}$/);
  });
});
