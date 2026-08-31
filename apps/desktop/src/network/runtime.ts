import type { Campaign } from "../domain/types";
import { useCampaignStore } from "../state/campaignStore";
import { HybridSession } from "./HybridSession";
import { generateRoomCode } from "./protocol";

let noticeHandler: ((message: string) => void) | undefined;
let broadcastTimer: number | undefined;
let lastPeerCount = 0;

const session = new HybridSession({
  onCampaign: (campaign) => {
    const localRevision = useCampaignStore.getState().campaign.revision;
    if (campaign.revision >= localRevision) useCampaignStore.getState().replaceCampaign(campaign);
  },
  onStatus: (status) => {
    useCampaignStore.getState().setMultiplayer(status);
    if (typeof status.peerCount === "number" && status.peerCount > lastPeerCount) {
      window.setTimeout(() => session.broadcastCampaign(useCampaignStore.getState().campaign), 250);
    }
    if (typeof status.peerCount === "number") lastPeerCount = status.peerCount;
  },
  onNotice: (message) => noticeHandler?.(message),
});

useCampaignStore.subscribe((state, previous) => {
  if (state.campaign === previous.campaign) return;
  window.clearTimeout(broadcastTimer);
  broadcastTimer = window.setTimeout(() => session.broadcastCampaign(state.campaign), 100);
});

export const setSessionNoticeHandler = (handler?: (message: string) => void): void => {
  noticeHandler = handler;
};

export const hostSession = async (serverUrl: string, preferRelay = false): Promise<string> => {
  const roomCode = generateRoomCode();
  await session.connect({ serverUrl, roomCode, role: "host", preferRelay });
  session.broadcastCampaign(useCampaignStore.getState().campaign);
  return roomCode;
};

export const joinSession = async (serverUrl: string, roomCode: string, preferRelay = false): Promise<void> => {
  await session.connect({ serverUrl, roomCode, role: "client", preferRelay });
};

export const disconnectSession = (): void => session.disconnect();
export const broadcastCampaign = (campaign: Campaign): void => session.broadcastCampaign(campaign);
