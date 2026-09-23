// Runs on the browser's audio thread. The microphone delivers sound in tiny
// 128-sample slices; we gather them into 20 ms frames (480 samples at 24 kHz)
// and hand each frame to the page, which sends it to the agent.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(480);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      let i = 0;
      while (i < channel.length) {
        const n = Math.min(channel.length - i, this.frame.length - this.filled);
        this.frame.set(channel.subarray(i, i + n), this.filled);
        this.filled += n;
        i += n;
        if (this.filled === this.frame.length) {
          this.port.postMessage(this.frame.slice());
          this.filled = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("capture", CaptureProcessor);
