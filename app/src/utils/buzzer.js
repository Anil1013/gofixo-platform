// Loud repeating buzzer + vibration for incoming ride requests (no audio files needed — generated with Web Audio).
// Browsers only allow sound after the user has tapped something on the page, so unlockAudio() is called on the
// first tap/click anywhere (see main.jsx) and again when the provider taps "Go available".
let audioCtx = null;
let buzzTimer = null;

export function unlockAudio() {
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    // audio not available — vibration/visual alert still work
  }
}

function beep(freq, startOffset, duration) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + startOffset;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

function cycle() {
  beep(880, 0, 0.22);
  beep(1175, 0.3, 0.22);
  beep(880, 0.6, 0.22);
  if (navigator.vibrate) navigator.vibrate([300, 120, 300, 120, 300]);
}

export function startBuzzer() {
  if (buzzTimer) return;
  unlockAudio();
  cycle();
  buzzTimer = setInterval(cycle, 1800);
}

export function stopBuzzer() {
  if (buzzTimer) {
    clearInterval(buzzTimer);
    buzzTimer = null;
  }
  if (navigator.vibrate) navigator.vibrate(0);
}
