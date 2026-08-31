import { useEffect, useRef, useState } from "react";
import { Bot, Dices, Mic, MicOff, Send, Square, Sparkles, Volume2 } from "lucide-react";
import { narrateRollOutcome, runDungeonMaster } from "../ai/dungeonMaster";
import { queueSpeech, startBrowserVoiceCapture, speak, stopSpeaking, type VoiceCapture } from "../audio/voice";
import { performCheck, rollDice } from "../domain/rules";
import { useCampaignStore } from "../state/campaignStore";

interface DungeonMasterPanelProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error") => void;
}

export function DungeonMasterPanel({ onNotify }: DungeonMasterPanelProps) {
  const messages = useCampaignStore((state) => state.campaign.messages);
  const settings = useCampaignStore((state) => state.campaign.settings);
  const isThinking = useCampaignStore((state) => state.isDmThinking);
  const addMessage = useCampaignStore((state) => state.addMessage);
  const addEvent = useCampaignStore((state) => state.addEvent);
  const setDmThinking = useCampaignStore((state) => state.setDmThinking);
  const progressStoryBeat = useCampaignStore((state) => state.progressStoryBeat);
  const [input, setInput] = useState("");
  const [partialVoice, setPartialVoice] = useState("");
  const [listening, setListening] = useState(false);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const voiceRef = useRef<VoiceCapture | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => () => {
    abortRef.current?.abort();
    voiceRef.current?.stop();
    stopSpeaking();
  }, []);

  const submit = async (provided?: string) => {
    const action = (provided ?? input).trim();
    if (!action || isThinking) return;
    setInput("");
    stopSpeaking();
    setPartialVoice("");
    setSuggestedActions([]);
    addMessage({ role: "player", speaker: useCampaignStore.getState().campaign.characters.find((entry) => entry.id === useCampaignStore.getState().campaign.activeCharacterId)?.name ?? "Player", content: action });
    addEvent("player.action_declared", action);
    setDmThinking(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const campaign = useCampaignStore.getState().campaign;
      const result = await runDungeonMaster(campaign, action, controller.signal, (chunk) => queueSpeech(chunk, settings.speakDmResponses));
      if (result.warning) {
        stopSpeaking();
        addMessage({ role: "system", content: result.warning });
        onNotify("Local AI unavailable; the offline director kept the session moving.", "warning");
      }
      addMessage({ role: "dm", speaker: result.response.speaker ?? "Dungeon Master", content: result.response.narration });
      addEvent("dm.narrated", result.response.narration, { provider: result.provider, sceneCue: result.response.sceneCue });
      setSuggestedActions(result.response.suggestedActions ?? []);

      let spoken = result.response.narration;
      let checkSucceeded: boolean | undefined;
      if (result.response.check) {
        const current = useCampaignStore.getState().campaign;
        const character = current.characters.find((entry) => entry.id === current.activeCharacterId) ?? current.characters[0];
        if (character) {
          const check = performCheck(character, result.response.check);
          checkSucceeded = check.success;
          addMessage({
            role: "roll",
            speaker: character.name,
            content: `${result.response.check.label}: ${check.kept}${check.modifier ? ` ${check.modifier >= 0 ? "+" : ""}${check.modifier}` : ""} = ${check.total} vs DC ${check.difficultyClass}`,
            metadata: { total: check.total, dc: check.difficultyClass, success: check.success, rolls: check.rolls },
          });
          const outcome = narrateRollOutcome(character, result.response.check, check.total, check.success, check.naturalTwenty, check.naturalOne);
          addMessage({ role: "dm", speaker: "Dungeon Master", content: outcome });
          addEvent("rules.check_resolved", `${character.name}: ${check.label} ${check.total} vs DC ${check.difficultyClass}`, { ...check });
          spoken += ` ${outcome}`;
        }
      }
      if (result.response.storyProgress) {
        const proposed = result.response.storyProgress;
        const outcome = proposed.outcome === "activate" ? "activate" : checkSucceeded === false ? "failure" : proposed.outcome;
        if (!progressStoryBeat(proposed.beatId, outcome, proposed.reason)) onNotify("The DM proposed story progress that was not valid for the current campaign state.", "warning");
      }
      if (result.response.memory) addEvent("memory.proposed", result.response.memory);
      if (result.streamedNarration) {
        const outcome = spoken.slice(result.response.narration.length).trim();
        if (outcome) queueSpeech(outcome, settings.speakDmResponses);
      } else {
        speak(spoken, settings.speakDmResponses);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : "The Dungeon Master could not resolve that action.";
        addMessage({ role: "system", content: message });
        onNotify(message, "error");
      }
    } finally {
      abortRef.current = null;
      setDmThinking(false);
    }
  };

  const interrupt = () => {
    abortRef.current?.abort();
    stopSpeaking();
    setDmThinking(false);
    addMessage({ role: "system", content: "The narration was interrupted. No uncommitted game state was changed." });
  };

  const toggleVoice = () => {
    if (listening) {
      voiceRef.current?.stop();
      voiceRef.current = null;
      setListening(false);
      return;
    }
    try {
      setListening(true);
      setPartialVoice("");
      voiceRef.current = startBrowserVoiceCapture(
        setPartialVoice,
        (text) => {
          setListening(false);
          voiceRef.current = null;
          setInput(text);
          void submit(text);
        },
        (message) => {
          setListening(false);
          onNotify(message, "error");
        },
      );
    } catch (error) {
      setListening(false);
      onNotify(error instanceof Error ? error.message : "Voice capture failed", "warning");
    }
  };

  const quickRoll = (expression: string) => {
    try {
      const result = rollDice(expression);
      addMessage({ role: "roll", speaker: "Table", content: `${expression}: [${result.rolls.join(", ")}]${result.modifier ? ` ${result.modifier >= 0 ? "+" : ""}${result.modifier}` : ""} = ${result.total}`, metadata: { total: result.total, rolls: result.rolls } });
      addEvent("dice.rolled", `${expression} = ${result.total}`, { ...result, expression });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Invalid roll", "error");
    }
  };

  return (
    <div className="dm-panel">
      <div className="dm-status">
        <span className={`dm-orb ${isThinking ? "thinking" : ""}`}><Bot size={17} /></span>
        <div><strong>AI Dungeon Master</strong><small>{settings.localAiEndpoint ? "Local model with offline fallback" : "Offline director"}</small></div>
        <span className="status-live"><i /> ready</span>
      </div>

      <div className="dm-messages" ref={scrollRef}>
        {messages.map((message) => (
          <article key={message.id} className={`dm-message ${message.role}`}>
            <header>{message.role === "roll" ? <Dices size={13} /> : message.role === "dm" ? <Sparkles size={13} /> : null}<span>{message.speaker ?? (message.role === "system" ? "System" : "Player")}</span><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time></header>
            <p>{message.content}</p>
            {message.role === "roll" && message.metadata && <div className={`roll-result ${message.metadata.success === false ? "failure" : "success"}`}><strong>{message.metadata.total}</strong><span>{message.metadata.dc ? `DC ${message.metadata.dc}` : "total"}</span></div>}
          </article>
        ))}
        {isThinking && <article className="dm-message dm thinking-message"><header><Sparkles size={13} /><span>Dungeon Master</span></header><p><i /><i /><i /> Considering the world and your intent…</p></article>}
      </div>

      {suggestedActions.length > 0 && <div className="suggested-actions">{suggestedActions.map((action) => <button key={action} onClick={() => submit(action)}>{action}</button>)}</div>}

      <div className="quick-rolls"><span>Quick roll</span>{["d20", "d4", "d6", "d8", "d10", "d12", "d100"].map((die) => <button key={die} onClick={() => quickRoll(die)}>{die}</button>)}</div>

      <div className={`dm-composer ${listening ? "listening" : ""}`}>
        {partialVoice && <div className="partial-transcript">{partialVoice}</div>}
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
        }} placeholder="Describe what your character says or attempts…" rows={3} disabled={isThinking} />
        <div className="composer-actions">
          <button className={listening ? "recording" : ""} onClick={toggleVoice} title="Speak your action">{listening ? <MicOff size={17} /> : <Mic size={17} />}</button>
          {isThinking ? <button className="interrupt-button" onClick={interrupt}><Square size={15} /> Interrupt</button> : <button className="send-button" onClick={() => submit()} disabled={!input.trim()}><Send size={16} /> Send</button>}
        </div>
      </div>
      <div className="voice-footer"><Volume2 size={12} /> Responses {settings.speakDmResponses ? "spoken aloud" : "shown as text"} · AI proposes, rules code decides</div>
    </div>
  );
}
