import { useEffect, useRef, useState } from "react";
import { Bot, Dices, Mic, MicOff, Minus, Palette, RotateCcw, Send, Square, Sparkles, Volume2 } from "lucide-react";
import { narrateRollOutcome, runDungeonMaster } from "../ai/dungeonMaster";
import { queueLocalNarration, stopLocalNarration as stopSpeaking } from "../audio/localNarration";
import { startLocalSpeechStream, type LocalSpeechStream } from "../audio/localSpeechStream";
import { performCheck, rollDice } from "../domain/rules";
import { useCampaignStore } from "../state/campaignStore";
import { DiceFace } from "./DiceFace";

interface DungeonMasterPanelProps {
  onNotify: (message: string, tone?: "info" | "success" | "warning" | "error" | "roll", title?: string, dice?: { sides: number; value: number }) => void;
  onOpenDiceForge?: () => void;
}

const quickDice = [20, 4, 6, 8, 10, 12, 100];
const EMPTY_DICE_THEMES = [] as const;
const EMPTY_DICE_ASSIGNMENTS = {} as const;

interface PresentedDiceTerm {
  sides: number;
  rolls: number[];
}

const presentDiceRoll = (expression: string, sides: number, rolls: number[], modifier: number, total: number, terms?: PresentedDiceTerm[]) => {
  window.dispatchEvent(new CustomEvent("dndrom:dice-roll", { detail: { expression, sides, rolls, modifier, total, terms } }));
};

export function DungeonMasterPanel({ onNotify, onOpenDiceForge }: DungeonMasterPanelProps) {
  const messages = useCampaignStore((state) => state.campaign.messages);
  const settings = useCampaignStore((state) => state.campaign.settings);
  const diceThemes = useCampaignStore((state) => state.campaign.diceThemes) ?? EMPTY_DICE_THEMES;
  const diceThemeAssignments = useCampaignStore((state) => state.campaign.diceThemeAssignments) ?? EMPTY_DICE_ASSIGNMENTS;
  const isThinking = useCampaignStore((state) => state.isDmThinking);
  const addMessage = useCampaignStore((state) => state.addMessage);
  const addEvent = useCampaignStore((state) => state.addEvent);
  const setDmThinking = useCampaignStore((state) => state.setDmThinking);
  const progressStoryBeat = useCampaignStore((state) => state.progressStoryBeat);
  const [input, setInput] = useState("");
  const [partialVoice, setPartialVoice] = useState("");
  const [liveNarration, setLiveNarration] = useState("");
  const speechErrorRef = useRef("");
  const mountedRef = useRef(true);
  const voiceStarting = useRef(false);
  const queueSpeech = (text: string, enabled: boolean) => {
    const config = useCampaignStore.getState().campaign.settings;
    queueLocalNarration(text, enabled, { endpoint: config.localTtsEndpoint, voice: config.localTtsVoice, onError: (message) => { if (speechErrorRef.current !== message) { speechErrorRef.current = message; onNotify(message, "warning"); } } });
  };
  const speak = (text: string, enabled: boolean) => { stopSpeaking(); queueSpeech(text, enabled); };
  const [listening, setListening] = useState(false);
  const [suggestedActions, setSuggestedActions] = useState<string[]>([]);
  const [dicePool, setDicePool] = useState<Record<number, number>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const voiceRef = useRef<LocalSpeechStream | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  useEffect(() => { mountedRef.current = true; return () => {
    mountedRef.current = false;
    abortRef.current?.abort();
    voiceRef.current?.abort();
    stopSpeaking();
  }; }, []);

  useEffect(() => {
    const action = (event: Event) => { const detail = (event as CustomEvent<{ action: string }>).detail; if (detail?.action) void submit(detail.action); };
    window.addEventListener("dndrom:dm-action", action);
    return () => window.removeEventListener("dndrom:dm-action", action);
  }, []);

  const submit = async (provided?: string) => {
    const action = (provided ?? input).trim();
    if (!action || useCampaignStore.getState().isDmThinking) return;
    setInput("");
    setLiveNarration("");
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
      const result = await runDungeonMaster(campaign, action, controller.signal, (chunk) => {
        if (controller.signal.aborted) return;
        setLiveNarration((current) => `${current} ${chunk}`.trim());
        queueSpeech(chunk, campaign.settings.speakDmResponses);
      });
      controller.signal.throwIfAborted();
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
            metadata: { total: check.total, dc: check.difficultyClass, success: check.success, rolls: check.rolls, expression: "d20", modifier: check.modifier },
          });
          presentDiceRoll("d20", 20, check.rolls, check.modifier, check.total);
          onNotify(`${character.name} rolled ${check.rolls.join(" / ")}${check.modifier ? ` ${check.modifier >= 0 ? "+" : ""}${check.modifier}` : ""} against DC ${check.difficultyClass}.`, "roll", `${check.total} total`, { sides: 20, value: check.kept });
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
      if (abortRef.current === controller) { abortRef.current = null; setDmThinking(false); setLiveNarration(""); }
    }
  };

  const interrupt = () => {
    abortRef.current?.abort();
    stopSpeaking();
    setDmThinking(false);
    addMessage({ role: "system", content: "The narration was interrupted. No uncommitted game state was changed." });
  };

  const toggleVoice = async () => {
    if (voiceStarting.current) return;
    if (listening) { voiceRef.current?.stop(); voiceRef.current = null; setListening(false); return; }
    voiceStarting.current = true;
    try {
      const capture = await startLocalSpeechStream(useCampaignStore.getState().campaign.settings.whisperEndpoint, {
        onPartial: (text) => { if (mountedRef.current) setPartialVoice(text); },
        onFinal: (text) => { if (mountedRef.current) { setPartialVoice(""); setInput(text); void submit(text); } },
        onSpeechStart: () => {
          abortRef.current?.abort(); stopSpeaking(); setDmThinking(false); setLiveNarration("");
        },
        onError: (message) => { if (mountedRef.current) { setListening(false); onNotify(message, "warning"); } },
      });
      if (!mountedRef.current) capture.abort(); else { voiceRef.current = capture; setListening(true); }
    } catch (error) { setListening(false); onNotify(error instanceof Error ? error.message : "Local speak mode failed", "warning"); }
    finally { voiceStarting.current = false; }
  };

  const diceCount = Object.values(dicePool).reduce((sum, count) => sum + count, 0);
  const diceExpression = quickDice
    .filter((sides) => (dicePool[sides] ?? 0) > 0)
    .map((sides) => `${dicePool[sides]}d${sides}`)
    .join(" + ");
  const dieColors = (sides: number) => {
    const theme = diceThemes.find((entry) => entry.id === diceThemeAssignments[`d${sides}` as keyof typeof diceThemeAssignments]);
    return theme ? { body: theme.baseColor, number: theme.numberColor } : undefined;
  };

  const addDie = (sides: number) => {
    setDicePool((current) => {
      const count = Object.values(current).reduce((sum, value) => sum + value, 0);
      if (count >= 12) {
        onNotify("The physical dice tray holds up to 12 dice at once.", "warning");
        return current;
      }
      return { ...current, [sides]: (current[sides] ?? 0) + 1 };
    });
  };

  const removeDie = (sides: number) => setDicePool((current) => {
    const next = { ...current };
    if ((next[sides] ?? 0) <= 1) delete next[sides];
    else next[sides] -= 1;
    return next;
  });

  const rollPool = () => {
    if (!diceCount) return;
    try {
      const terms = quickDice.flatMap((sides) => {
        const count = dicePool[sides] ?? 0;
        return count ? [{ sides, rolls: rollDice(`${count}d${sides}`).rolls }] : [];
      });
      const rolls = terms.flatMap((term) => term.rolls);
      const total = rolls.reduce((sum, value) => sum + value, 0);
      const breakdown = terms.map((term) => `d${term.sides}: [${term.rolls.join(", ")}]`).join(" · ");
      addMessage({ role: "roll", speaker: "Table", content: `${diceExpression}: ${breakdown} = ${total}`, metadata: { total, rolls, expression: diceExpression, modifier: 0 } });
      addEvent("dice.rolled", `${diceExpression} = ${total}`, { terms, rolls, total, expression: diceExpression, modifier: 0 });
      presentDiceRoll(diceExpression, terms[0]?.sides ?? 20, rolls, 0, total, terms);
      onNotify(breakdown, "roll", `${total} total`, terms[0] ? { sides: terms[0].sides, value: terms[0].rolls[0] } : undefined);
      setDicePool({});
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
            {message.role === "roll" && message.metadata && <div className={`roll-result ${message.metadata.success === false ? "failure" : "success"}`}><span className="roll-result-content"><strong>{message.metadata.total}</strong><small>{message.metadata.dc ? `DC ${message.metadata.dc}` : "total"}</small></span></div>}
          </article>
        ))}
        {isThinking && <article className="dm-message dm thinking-message"><header><Sparkles size={13} /><span>Dungeon Master</span></header><p><i /><i /><i /> Considering the world and your intent…</p></article>}
      </div>

      {suggestedActions.length > 0 && <div className="suggested-actions">{suggestedActions.map((action) => <button key={action} onClick={() => submit(action)}>{action}</button>)}</div>}

      <div className="dice-tray" aria-label="Dice tray">
        <div className="dice-tray-heading"><span>Dice pool</span><strong>{diceExpression || "Choose dice below"}</strong>{diceCount > 0 && <button onClick={() => setDicePool({})} title="Clear dice tray"><RotateCcw size={12} /> Clear</button>}<button onClick={onOpenDiceForge} title="Customize dice textures"><Palette size={12} /> Forge</button></div>
        {diceCount > 0 && <div className="dice-pool-chips">{quickDice.filter((sides) => dicePool[sides]).map((sides) => <span key={sides}><DiceFace sides={sides} colors={dieColors(sides)} /><b>{dicePool[sides]}d{sides}</b><button onClick={() => removeDie(sides)} aria-label={`Remove one d${sides}`}><Minus size={11} /></button></span>)}</div>}
        <div className="quick-rolls">{quickDice.map((sides) => <button key={sides} className={(dicePool[sides] ?? 0) > 0 ? "selected" : ""} onClick={() => addDie(sides)} aria-label={`Add a d${sides} to the roll`}><DiceFace sides={sides} colors={dieColors(sides)} /><small>d{sides}</small>{(dicePool[sides] ?? 0) > 0 && <em>{dicePool[sides]}</em>}</button>)}</div>
        <button className="roll-dice-button" onClick={rollPool} disabled={!diceCount}><Dices size={16} /><span>Roll {diceCount ? `${diceCount} ${diceCount === 1 ? "die" : "dice"}` : "dice"}</span></button>
      </div>

      {liveNarration && <p className="dm-live-narration" role="status">{liveNarration}</p>}
      <div className={`dm-composer ${listening ? "listening" : ""}`}>
        {partialVoice && <div className="partial-transcript">{partialVoice}</div>}
        <textarea value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }
        }} placeholder="Describe what your character says or attempts…" rows={3} disabled={isThinking} />
        <div className="composer-actions">
          <button className={listening ? "recording" : ""} onClick={() => void toggleVoice()} aria-label={listening ? "Stop local speak mode" : "Start local speak mode"} title="Local speak mode: pauses send your action; speaking interrupts narration">{listening ? <MicOff size={17} /> : <Mic size={17} />}</button>
          {isThinking ? <button className="interrupt-button" onClick={interrupt}><Square size={15} /> Interrupt</button> : <button className="send-button" onClick={() => submit()} disabled={!input.trim()}><Send size={16} /> Send</button>}
        </div>
      </div>
      <div className="voice-footer"><Volume2 size={12} /> Responses {settings.speakDmResponses ? "spoken aloud" : "shown as text"} · AI proposes, rules code decides</div>
    </div>
  );
}
