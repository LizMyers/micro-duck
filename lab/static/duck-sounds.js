// Simon's real duck sounds: the chirps (quacks) and the "wheee" that come with Pollen's Microduck simulator,
// in the voice that matches his colour (Pollen's own mapping, from the simulator's game.js). The simulator
// has its sound switched off, so the page plays them itself, through the beak, so it moves with the quack.
// Files: /sim/assets/voices/<bank>/chirp_a..l.wav, wheee_start_a/b.wav, wheee_end_a/b.wav (22 kHz mono).

// (The page modules are loaded when a sound first plays, so the pure parts below can be tested in node.)
const page = () => Promise.all([import("/static/core.js"), import("/static/audio.js")])
  .then(([core, audio]) => ({ state: core.state, ctx: core.ctx, ensureAudio: audio.ensureAudio }));

// Colour → voice bank, exactly as the simulator assigns them.
export const VOICE_BANK = { classic: "duck1", charcoal: "duck2", purple: "duck3", blue: "duck4" };
const CHIRPS = "abcdefghijkl".split("");

// The bank for a colour, and a chirp that isn't the same as last time.
export const bankFor = (colour) => VOICE_BANK[colour] ?? "duck1";
export function nextChirp(last, rand = Math.random) {
  const pool = CHIRPS.filter((c) => c !== last);
  return pool[Math.floor(rand() * pool.length)];
}

const buffers = new Map();   // url → decoded AudioBuffer (each file is fetched once)
async function load(url) {
  if (!buffers.has(url)) {
    const { ensureAudio } = await page();
    const audio = await ensureAudio();
    buffers.set(url, fetch(url).then((r) => r.arrayBuffer()).then((b) => audio.ctx.decodeAudioData(b)));
  }
  return buffers.get(url);
}

// Plays one file through the beak; resolves when it has finished. Never throws (a missing file is silent).
// rate < 1 plays it slower and lower (a deflated quack).
async function play(file, gain = 0.8, rate = 1) {
  const { state, ctx } = await page();
  try {
    const url = `/sim/assets/voices/${bankFor(ctx.body?.colour)}/${file}.wav`;
    const buf = await load(url);
    const ac = state.audio.ctx;
    const src = ac.createBufferSource();
    const g = ac.createGain();
    g.gain.value = gain;
    src.buffer = buf;
    src.playbackRate.value = rate;
    src.connect(g).connect(ctx.body?.attachAudio ? ctx.body.attachAudio(ac) : ac.destination);
    src.start();
    await new Promise((r) => (src.onended = r));
  } catch (e) {
    ctx.inspector?.note(`🦆 page: couldn't play the duck sound ${file} (${e.message})`, null, "warn");
  }
}

// Only at the end of a game (Liz: not after every move), from Simon's side, in his colour's voice.
let lastChirp = null;
export const duckSounds = {
  // Simon wins: "Wheee!"
  async win() {
    const take = Math.random() < 0.5 ? "a" : "b";
    await play(`wheee_start_${take}`, 0.7);
    await play(`wheee_end_${take}`, 0.7);
  },
  // Simon loses: a deflated quack (a chirp, slower and lower).
  lose() {
    lastChirp = nextChirp(lastChirp);
    return play(`chirp_${lastChirp}`, 0.8, 0.7);
  },
};
