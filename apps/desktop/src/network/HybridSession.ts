import type { Campaign, MultiplayerStatus } from "../domain/types";
import { decodeEnvelope, encodeEnvelope, SESSION_PROTOCOL_VERSION } from "./protocol";

type Role = "host" | "client";

interface SessionCallbacks {
  onCampaign: (campaign: Campaign) => void;
  onStatus: (status: Partial<MultiplayerStatus>) => void;
  onNotice?: (message: string) => void;
}

interface ConnectOptions {
  serverUrl: string;
  roomCode: string;
  role: Role;
  preferRelay?: boolean;
}

interface PeerState {
  connection: RTCPeerConnection;
  channel?: RTCDataChannel;
}

export class HybridSession {
  private socket?: WebSocket;
  private peers = new Map<string, PeerState>();
  private peerId = crypto.randomUUID();
  private roomCode = "";
  private role: Role = "client";
  private preferRelay = false;
  private callbacks: SessionCallbacks;

  constructor(callbacks: SessionCallbacks) {
    this.callbacks = callbacks;
  }

  async connect(options: ConnectOptions): Promise<void> {
    this.disconnect();
    this.roomCode = options.roomCode.toUpperCase();
    this.role = options.role;
    this.preferRelay = Boolean(options.preferRelay);
    this.peerId = crypto.randomUUID();
    this.callbacks.onStatus({ mode: options.preferRelay ? "server" : options.role, connected: false, roomCode: this.roomCode, route: "none", message: "Connecting" });

    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(options.serverUrl);
      this.socket = socket;
      const timeout = window.setTimeout(() => reject(new Error("The session server did not respond")), 8000);
      socket.addEventListener("open", () => {
        socket.send(JSON.stringify({ v: SESSION_PROTOCOL_VERSION, type: "join", room: this.roomCode, peerId: this.peerId, role: this.role }));
      });
      socket.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (message.type === "welcome") {
          window.clearTimeout(timeout);
          this.callbacks.onStatus({ connected: true, peerCount: message.peerCount, route: this.preferRelay ? "server" : "relay", message: "Session ready" });
          for (const peer of message.peers ?? []) {
            if (this.role === "host" || peer.role === "host") void this.ensurePeer(peer.peerId, this.role === "host");
          }
          resolve();
        }
        void this.handleServerMessage(message);
      });
      socket.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error(`Could not connect to ${options.serverUrl}`));
      });
      socket.addEventListener("close", () => {
        this.callbacks.onStatus({ connected: false, peerCount: 0, route: "none", message: "Session server disconnected" });
      });
    });
  }

  disconnect(): void {
    for (const peer of this.peers.values()) peer.connection.close();
    this.peers.clear();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
      this.socket = undefined;
    }
    this.callbacks.onStatus({ mode: "offline", connected: false, roomCode: "", peerCount: 0, route: "none", message: undefined });
  }

  broadcastCampaign(campaign: Campaign): void {
    if (this.role !== "host" || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const payload = encodeEnvelope({ type: "campaign.snapshot", revision: campaign.revision, campaign });
    let sentDirect = false;
    if (!this.preferRelay) {
      for (const peer of this.peers.values()) {
        if (peer.channel?.readyState === "open") {
          peer.channel.send(payload);
          sentDirect = true;
        }
      }
    }
    if (this.preferRelay || !sentDirect) this.sendServer({ v: SESSION_PROTOCOL_VERSION, type: "relay", payload: JSON.parse(payload) });
  }

  private sendServer(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private async handleServerMessage(message: any): Promise<void> {
    if (message.type === "peer-joined") {
      this.callbacks.onStatus({ peerCount: message.peerCount });
      if (!this.preferRelay && this.role === "host") await this.ensurePeer(message.peerId, true);
      return;
    }
    if (message.type === "peer-left") {
      this.peers.get(message.peerId)?.connection.close();
      this.peers.delete(message.peerId);
      this.callbacks.onStatus({ peerCount: message.peerCount });
      return;
    }
    if (message.type === "signal" && !this.preferRelay) {
      const peer = await this.ensurePeer(message.from, false);
      if (message.data?.type === "offer") {
        await peer.connection.setRemoteDescription(message.data);
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        this.sendServer({ v: 1, type: "signal", to: message.from, data: peer.connection.localDescription });
      } else if (message.data?.type === "answer") {
        await peer.connection.setRemoteDescription(message.data);
      } else if (message.data?.candidate) {
        await peer.connection.addIceCandidate(message.data);
      }
      return;
    }
    if (message.type === "relay") this.receivePayload(message.payload);
    if (message.type === "error") this.callbacks.onNotice?.(message.message ?? "Session server error");
  }

  private async ensurePeer(peerId: string, initiator: boolean): Promise<PeerState> {
    const existing = this.peers.get(peerId);
    if (existing) return existing;
    const connection = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    const state: PeerState = { connection };
    this.peers.set(peerId, state);
    connection.onicecandidate = (event) => {
      if (event.candidate) this.sendServer({ v: 1, type: "signal", to: peerId, data: event.candidate });
    };
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") this.callbacks.onStatus({ route: "direct", message: "Direct peer connection" });
      if (["failed", "disconnected"].includes(connection.connectionState)) this.callbacks.onStatus({ route: "relay", message: "Using server relay" });
    };
    connection.ondatachannel = (event) => this.attachChannel(state, event.channel);
    if (initiator) {
      this.attachChannel(state, connection.createDataChannel("dndrom-state", { ordered: true }));
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      this.sendServer({ v: 1, type: "signal", to: peerId, data: connection.localDescription });
    }
    return state;
  }

  private attachChannel(peer: PeerState, channel: RTCDataChannel): void {
    peer.channel = channel;
    channel.onmessage = (event) => this.receivePayload(event.data);
    channel.onopen = () => this.callbacks.onStatus({ route: "direct", message: "Direct peer connection" });
  }

  private receivePayload(raw: unknown): void {
    const message = decodeEnvelope(typeof raw === "string" ? raw : raw);
    if (message?.type === "campaign.snapshot" && this.role === "client") this.callbacks.onCampaign(message.campaign);
  }
}
