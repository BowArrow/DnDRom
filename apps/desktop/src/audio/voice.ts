let activeUtterance: SpeechSynthesisUtterance | null = null;

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  activeUtterance = null;
}

export function speak(text: string, enabled: boolean): void {
  if (!enabled || !("speechSynthesis" in window)) return;
  stopSpeaking();
  queueSpeech(text, enabled);
}

export function queueSpeech(text: string, enabled: boolean): void {
  if (!enabled || !("speechSynthesis" in window) || !text.trim()) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.98;
  utterance.pitch = 0.9;
  const voices = window.speechSynthesis.getVoices();
  utterance.voice = voices.find((voice) => /english/i.test(voice.lang) && /male|david|mark|daniel/i.test(voice.name)) ?? voices.find((voice) => /english/i.test(voice.lang)) ?? null;
  utterance.onend = () => {
    if (activeUtterance === utterance) activeUtterance = null;
  };
  activeUtterance = utterance;
  window.speechSynthesis.speak(utterance);
}

export interface VoiceCapture {
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export function startBrowserVoiceCapture(onPartial: (text: string) => void, onFinal: (text: string) => void, onError: (message: string) => void): VoiceCapture {
  const scope = window as typeof window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
  const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Constructor) throw new Error("Live speech recognition is unavailable in this webview. Type your action or configure a local Whisper endpoint in Settings.");
  const recognition = new Constructor();
  recognition.lang = "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = (event) => {
    let partial = "";
    let final = "";
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      if (result.isFinal) final += result[0].transcript;
      else partial += result[0].transcript;
    }
    if (partial) onPartial(partial);
    if (final) onFinal(final.trim());
  };
  recognition.onerror = (event) => onError(`Microphone recognition error: ${event.error}`);
  recognition.start();
  return { stop: () => recognition.stop() };
}
