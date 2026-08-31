import assert from "node:assert/strict";
import test from "node:test";
import { WebSocket } from "ws";
import { createSignalingServer } from "./server.mjs";

const nextMessage = (socket) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out waiting for message")), 2000);
  socket.once("message", (data) => {
    clearTimeout(timeout);
    resolve(JSON.parse(data.toString()));
  });
});

test("joins a room and relays protocol messages", async () => {
  const server = createSignalingServer({ serverPort: 0, serverHost: "127.0.0.1" });
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const url = `ws://127.0.0.1:${address.port}`;
  const host = new WebSocket(url);
  const client = new WebSocket(url);
  await Promise.all([
    new Promise((resolve) => host.once("open", resolve)),
    new Promise((resolve) => client.once("open", resolve)),
  ]);

  host.send(JSON.stringify({ v: 1, type: "join", room: "EMBER1", peerId: "host", role: "host" }));
  assert.equal((await nextMessage(host)).type, "welcome");
  client.send(JSON.stringify({ v: 1, type: "join", room: "EMBER1", peerId: "client", role: "client" }));
  const [welcome, joined] = await Promise.all([nextMessage(client), nextMessage(host)]);
  assert.equal(welcome.peers[0].peerId, "host");
  assert.equal(joined.peerId, "client");

  client.send(JSON.stringify({ v: 1, type: "relay", payload: { type: "ping" } }));
  const relayed = await nextMessage(host);
  assert.equal(relayed.payload.type, "ping");

  host.close();
  client.close();
  await new Promise((resolve) => server.close(resolve));
});
