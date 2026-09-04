import { useEffect, useRef, useState } from "react";
import { BookOpen, Download, Link2, LogIn, Radio, RotateCcw, Save, Server, Settings2, Unplug, Upload, Wifi, WifiOff } from "lucide-react";
import { testLocalAi } from "../ai/openAiClient";
import { disconnectSession, hostSession, joinSession, setSessionNoticeHandler } from "../network/runtime";
import { exportCampaign, importCampaign, saveCampaignNative } from "../persistence/campaignFiles";
import { useCampaignStore } from "../state/campaignStore";
import { RULES_COVERAGE } from "../domain/srdRules";

interface SessionPanelProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

export function SessionPanel({ onNotify }: SessionPanelProps) {
  const campaign = useCampaignStore((state) => state.campaign);
  const multiplayer = useCampaignStore((state) => state.multiplayer);
  const updateSettings = useCampaignStore((state) => state.updateSettings);
  const replaceCampaign = useCampaignStore((state) => state.replaceCampaign);
  const resetCampaign = useCampaignStore((state) => state.resetCampaign);
  const markSaved = useCampaignStore((state) => state.markSaved);
  const [testingAi, setTestingAi] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [serverUrl, setServerUrl] = useState("ws://127.0.0.1:8787");
  const [roomCode, setRoomCode] = useState("");
  const [preferRelay, setPreferRelay] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSessionNoticeHandler((message) => onNotify(message, "warning"));
    return () => setSessionNoticeHandler();
  }, [onNotify]);

  const nativeSave = async () => {
    try {
      const path = await saveCampaignNative(campaign);
      if (path) onNotify(`Campaign saved to ${path}`, "success");
      else {
        exportCampaign(campaign);
        onNotify("Campaign downloaded. Desktop builds also autosave to the application data folder.", "success");
      }
      markSaved();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Save failed", "error");
    }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    try {
      replaceCampaign(await importCampaign(file));
      onNotify("Campaign imported successfully.", "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Campaign import failed", "error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const testAi = async () => {
    setTestingAi(true);
    try {
      const result = await testLocalAi(campaign.settings.localAiEndpoint, campaign.settings.localAiModel);
      onNotify(`Local AI responded in ${result.latencyMs} ms.`, "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Local AI connection failed", "error");
    } finally {
      setTestingAi(false);
    }
  };

  const host = async () => {
    setConnecting(true);
    try {
      const code = await hostSession(serverUrl, preferRelay);
      setRoomCode(code);
      onNotify(`Session ${code} is ready. Share this room code with your players.`, "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not host the session", "error");
    } finally {
      setConnecting(false);
    }
  };

  const join = async () => {
    if (roomCode.trim().length < 4) {
      onNotify("Enter the host's room code first.", "warning");
      return;
    }
    setConnecting(true);
    try {
      await joinSession(serverUrl, roomCode.trim(), preferRelay);
      onNotify(`Joined session ${roomCode.trim().toUpperCase()}.`, "success");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Could not join the session", "error");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="session-panel">
      <section className="settings-section">
        <div className="section-heading"><Settings2 size={16} /><div><strong>Campaign files</strong><small>Local-first and portable</small></div></div>
        <div className="file-actions">
          <button className="primary-button" onClick={nativeSave}><Save size={15} /> Save campaign</button>
          <button onClick={() => exportCampaign(campaign)}><Download size={15} /> Export</button>
          <button onClick={() => fileRef.current?.click()}><Upload size={15} /> Import</button>
          <input ref={fileRef} hidden type="file" accept=".dndrom,application/json" onChange={(event) => loadFile(event.target.files?.[0])} />
        </div>
      </section>

      <section className="settings-section">
        <div className="section-heading"><BookOpen size={16} /><div><strong>{RULES_COVERAGE.ruleset} mechanics</strong><small>{RULES_COVERAGE.implemented.length} deterministic systems enabled</small></div></div>
        <p className="rules-coverage-copy">Core tests, attacks, cover, typed damage, HP, death saves, conditions, concentration, movement, carrying, rests, and resource recharge run in code. Class, spell, item, and monster automation is tracked separately and never assumed.</p>
        <a className="rules-source-link" href="https://www.dndbeyond.com/srd" target="_blank" rel="noreferrer"><BookOpen size={13} /> Official SRD 5.2.1 and license</a>
        <label className="toggle-row"><span><strong>Player Dungeon Master</strong><small>Lets this table view and edit DM-only enemy and boss sheets during play</small></span><input type="checkbox" checked={campaign.settings.dungeonMasterMode === "player"} onChange={(event) => updateSettings({ dungeonMasterMode: event.target.checked ? "player" : "ai" })} /></label>
      </section>

      <section className="settings-section">
        <div className="section-heading"><Radio size={16} /><div><strong>Local AI runtime</strong><small>OpenAI-compatible llama.cpp endpoint</small></div></div>
        <label className="field-label">Loopback endpoint<input value={campaign.settings.localAiEndpoint} onChange={(event) => updateSettings({ localAiEndpoint: event.target.value })} placeholder="http://127.0.0.1:8080/v1" /></label>
        <label className="field-label">Model alias<input value={campaign.settings.localAiModel} onChange={(event) => updateSettings({ localAiModel: event.target.value })} /></label>
        <button className="connection-test" onClick={testAi} disabled={testingAi || !campaign.settings.localAiEndpoint}><Link2 size={15} />{testingAi ? "Testing…" : "Test local model"}</button>
        <label className="toggle-row"><span><strong>Use AI for map planning</strong><small>Falls back to the offline generator</small></span><input type="checkbox" checked={campaign.settings.useLocalAiForMaps} onChange={(event) => updateSettings({ useLocalAiForMaps: event.target.checked })} /></label>
        <label className="toggle-row"><span><strong>Speak DM responses</strong><small>Uses local system speech until Kokoro is installed</small></span><input type="checkbox" checked={campaign.settings.speakDmResponses} onChange={(event) => updateSettings({ speakDmResponses: event.target.checked })} /></label>
      </section>

      <section className="settings-section">
        <div className="section-heading"><Server size={16} /><div><strong>Multiplayer route</strong><small>P2P or self/managed server</small></div></div>
        <div className="network-status-card">
          {multiplayer.connected ? <Wifi size={20} /> : <WifiOff size={20} />}
          <div><strong>{multiplayer.connected ? `Connected · ${multiplayer.route}` : "Offline session"}</strong><small>{multiplayer.connected ? `${multiplayer.peerCount} peers in ${multiplayer.roomCode}` : "Your device owns the canonical state"}</small></div>
        </div>
        <label className="field-label">Signaling or session server<input value={serverUrl} onChange={(event) => setServerUrl(event.target.value)} disabled={multiplayer.connected} /></label>
        <label className="field-label">Room code<input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} placeholder="Generated when hosting" disabled={multiplayer.connected} /></label>
        <label className="toggle-row"><span><strong>Route state through server</strong><small>Useful when direct WebRTC cannot connect</small></span><input type="checkbox" checked={preferRelay} disabled={multiplayer.connected} onChange={(event) => setPreferRelay(event.target.checked)} /></label>
        {multiplayer.connected ? (
          <button className="connection-test danger-button" onClick={() => { disconnectSession(); onNotify("Multiplayer session disconnected.", "info"); }}><Unplug size={15} /> Disconnect</button>
        ) : (
          <div className="session-route-buttons">
            <button onClick={host} disabled={connecting || !serverUrl}><Radio size={15} /> {connecting ? "Connecting…" : "Host"}</button>
            <button onClick={join} disabled={connecting || !serverUrl || roomCode.length < 4}><LogIn size={15} /> Join</button>
          </div>
        )}
        <p className="network-note"><Server size={12} /> Run <code>pnpm signaling</code> locally, deploy the same tiny server yourself, or point this field at a managed DnDRom endpoint.</p>
      </section>

      <section className="settings-section danger-zone">
        <div className="section-heading"><RotateCcw size={16} /><div><strong>Reset starter campaign</strong><small>Replaces the local working campaign</small></div></div>
        <button className="danger-button" onClick={() => {
          if (window.confirm("Reset the current campaign to the starter scenario? Export first if you want to keep it.")) {
            resetCampaign();
            onNotify("Starter campaign restored.", "success");
          }
        }}><RotateCcw size={15} /> Reset campaign</button>
      </section>
    </div>
  );
}
