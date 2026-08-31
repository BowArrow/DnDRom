import { WebSocket, WebSocketServer } from "ws";

const port = Number.parseInt(process.env.DNDROM_SIGNAL_PORT ?? "8787", 10);
const host = process.env.DNDROM_SIGNAL_HOST ?? "0.0.0.0";
const rooms = new Map();

const send = (socket, message) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
};

const roomMembers = (room) => rooms.get(room) ?? new Map();

const leaveRoom = (socket) => {
  if (!socket.dndromRoom || !socket.dndromPeerId) return;
  const members = rooms.get(socket.dndromRoom);
  if (!members) return;
  members.delete(socket.dndromPeerId);
  for (const member of members.values()) {
    send(member.socket, {
      v: 1,
      type: "peer-left",
      peerId: socket.dndromPeerId,
      peerCount: members.size,
    });
  }
  if (members.size === 0) rooms.delete(socket.dndromRoom);
};

export const createSignalingServer = ({ serverPort = port, serverHost = host } = {}) => {
  const wss = new WebSocketServer({ port: serverPort, host: serverHost });

  wss.on("connection", (socket) => {
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        send(socket, { v: 1, type: "error", message: "Malformed JSON" });
        return;
      }

      if (message?.v !== 1 || typeof message.type !== "string") {
        send(socket, { v: 1, type: "error", message: "Unsupported protocol" });
        return;
      }

      if (message.type === "join") {
        const room = String(message.room ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
        const peerId = String(message.peerId ?? "").slice(0, 64);
        if (room.length < 4 || !peerId) {
          send(socket, { v: 1, type: "error", message: "A room and peer ID are required" });
          return;
        }
        leaveRoom(socket);
        const members = roomMembers(room);
        if (members.has(peerId)) {
          send(socket, { v: 1, type: "error", message: "Peer ID is already present" });
          return;
        }
        rooms.set(room, members);
        socket.dndromRoom = room;
        socket.dndromPeerId = peerId;
        members.set(peerId, { socket, role: message.role === "host" ? "host" : "client" });
        const peers = [...members.entries()]
          .filter(([id]) => id !== peerId)
          .map(([id, member]) => ({ peerId: id, role: member.role }));
        send(socket, { v: 1, type: "welcome", room, peers, peerCount: members.size });
        for (const [id, member] of members) {
          if (id !== peerId) send(member.socket, { v: 1, type: "peer-joined", peerId, role: message.role, peerCount: members.size });
        }
        return;
      }

      const members = socket.dndromRoom ? rooms.get(socket.dndromRoom) : undefined;
      if (!members || !socket.dndromPeerId) {
        send(socket, { v: 1, type: "error", message: "Join a room first" });
        return;
      }

      if (message.type === "signal") {
        const target = members.get(String(message.to));
        if (target) send(target.socket, { v: 1, type: "signal", from: socket.dndromPeerId, data: message.data });
        return;
      }

      if (message.type === "relay") {
        for (const [id, member] of members) {
          if (id !== socket.dndromPeerId) send(member.socket, { v: 1, type: "relay", from: socket.dndromPeerId, payload: message.payload });
        }
      }
    });

    socket.on("close", () => leaveRoom(socket));
    socket.on("error", () => leaveRoom(socket));
  });

  return wss;
};

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith(process.argv[1].replaceAll("\\", "/"))) {
  const server = createSignalingServer();
  server.on("listening", () => console.log(`DnDRom signaling server listening on ws://${host}:${port}`));
}
