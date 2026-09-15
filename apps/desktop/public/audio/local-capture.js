// Local PCM capture only: this worklet has no network or transcription code.
class DndromCapture extends AudioWorkletProcessor {
  constructor() { super(); this.samples = []; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (const sample of channel) this.samples.push(sample);
    if (this.samples.length >= sampleRate * .1) {
      const data = new Float32Array(this.samples);
      this.port.postMessage(data, [data.buffer]); this.samples = [];
    }
    return true;
  }
}
registerProcessor('dndrom-local-capture', DndromCapture);
