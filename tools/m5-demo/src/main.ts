import './styles.css';
import { SimulatorRuntime } from './vendor/sim/runtime';
import { emptyAudioFrame, LOOK_LABELS, SPECTRUM_BAND_COUNT } from './vendor/sim/constants';
import { eventValue } from './vendor/sim/state';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const demo = $('demo');
const master = $<HTMLInputElement>('master');
const look = $<HTMLSelectElement>('look');
const feedback = $('feedback');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let paused = motionPreference.matches;
let audioEnabled = false;
let runtime: SimulatorRuntime;
let lastStamp = 0;
let lastPaint = 0;
let sequence = 0;

const fixtures = document.querySelector('.fixtures')!;
for (let i = 0; i < 4; i++) {
  const fixture = document.createElement('div');
  fixture.className = 'fixture';
  fixture.innerHTML = `<div class="fixture-head"></div><div class="beam"></div><div class="fixture-pool"></div><span class="fixture-num">0${i + 1}</span>`;
  fixtures.append(fixture);
}
const fixtureElements = [...document.querySelectorAll<HTMLElement>('.fixture')];
const spectrum = $('spectrum');
for (let i = 0; i < SPECTRUM_BAND_COUNT; i++) {
  const band = document.createElement('span');
  band.className = 'band';
  band.setAttribute('aria-hidden', 'true');
  spectrum.append(band);
}
const bands = [...spectrum.children] as HTMLElement[];

function reset(): void {
  runtime = new SimulatorRuntime();
  audioEnabled = false;
  sequence = 0;
  runtime.configureFixtures('rgb7', 4);
  runtime.setLinkConnected(true);
  runtime.setOutputEnabled(true);
  runtime.setAudioSource('LINE');
  runtime.setMaster('BRAIN', 70);
  runtime.tick(100);
  master.value = '70';
  look.value = '0';
  setStep(1);
  paint();
}

// Deliberately synthetic test input. All lighting and peer behavior is calculated
// by the unchanged vendored project model, not by this presentation layer.
function injectSyntheticPulse(): void {
  const now = runtime.nowMs;
  if (!audioEnabled) {
    runtime.injectAudio(emptyAudioFrame(now));
    return;
  }
  const phase = (now % 500) / 500;
  const beat = phase < .12;
  const envelope = Math.exp(-phase * 5);
  const levels = Array.from({ length: SPECTRUM_BAND_COUNT }, (_, i) => Math.round(Math.max(0, Math.min(100,
    16 + 24 * (Math.sin(now / (200 + i * 31) + i * .7) + 1) / 2 + envelope * (i < 4 ? 60 : 22)
  ))));
  runtime.injectAudio({
    ...emptyAudioFrame(now), frameSeq: ++sequence, present: true, rms: Math.round(28 + 50 * envelope),
    peak: Math.round(50 + 40 * envelope), beatHit: beat, bpm: 120, tempoLocked: true,
    beatConfidence: 100, kickEnergy: Math.round(100 * envelope), snareEnergy: Math.round(levels[7]),
    hatEnergy: Math.round(levels[13]), vocalPresence: levels[6], intensityEnergy: Math.round(50 + 40 * envelope), spectrum: levels
  });
}

function advance(milliseconds: number): void {
  // Small steps preserve the model’s queued peer delivery order even while the
  // visual animation is paused. A user action still produces a static result.
  const count = Math.max(1, Math.ceil(milliseconds / 20));
  for (let i = 0; i < count; i++) {
    injectSyntheticPulse();
    runtime.tick(runtime.nowMs + milliseconds / count);
  }
}

function settle(): void { advance(80); paint(); }
function say(message: string): void { feedback.textContent = message; }
function percent(value: number): string { return `${Math.round(value / 2.55)}%`; }

function paint(): void {
  const brain = runtime.brain.state;
  const controller = runtime.controller.state;
  const linked = runtime.peer.link.connected;
  const data = runtime.controller.universe.data;
  $('brain-master').textContent = percent(brain.masterDimmer);
  $('controller-master').textContent = percent(controller.masterDimmer);
  $('master-value').textContent = `${master.value}%`;
  $('brain-look').textContent = LOOK_LABELS[brain.activeLook];
  $('controller-look').textContent = LOOK_LABELS[controller.activeLook];
  $('stage-look').textContent = controller.blackout ? 'Blackout' : LOOK_LABELS[controller.activeLook];
  $('controller-mode').textContent = controller.blackout ? 'Local blackout' : linked ? 'Peer control' : 'Local control';
  $('link-state').textContent = linked ? 'Linked' : 'Disconnected';
  document.querySelector('.connection')!.classList.toggle('disconnected', !linked);
  $('link-toggle').textContent = linked ? 'Disconnect' : 'Reconnect';
  $('link-toggle').setAttribute('aria-pressed', String(!linked));
  $('blackout').textContent = controller.blackout ? 'Restore Controller' : 'Blackout Controller';
  $('blackout').setAttribute('aria-pressed', String(controller.blackout));
  $('output-state').textContent = controller.blackout ? 'Virtual output blacked out' : 'Virtual output active';
  $('audio-toggle').textContent = audioEnabled ? 'Stop pulse' : 'Start pulse';
  $('audio-toggle').setAttribute('aria-pressed', String(audioEnabled));
  $('audio-state').textContent = audioEnabled ? `120 BPM${paused ? ' · paused' : ' · synthetic'}` : 'Pulse off';
  $('audio-hint').textContent = controller.audioReactive ? 'Controller audio: reactive' : 'Controller audio: off';
  $('motion-toggle').textContent = paused ? 'Resume motion' : 'Pause motion';
  $('motion-toggle').setAttribute('aria-pressed', String(paused));
  spectrum.setAttribute('aria-label', audioEnabled ? `Sixteen synthetic frequency bands at 120 BPM${paused ? ', motion paused' : ''}.` : 'Sixteen simulated frequency bands; synthetic pulse is off.');
  for (let i = 0; i < fixtureElements.length; i++) {
    // Derive visuals from final DMX bytes: fixtureStates retains a previous
    // preview under the model’s blackout policy and is not the output truth.
    const offset = i * 7;
    fixtureElements[i].style.setProperty('--rgb', `${data[offset + 1]},${data[offset + 2]},${data[offset + 3]}`);
    fixtureElements[i].style.setProperty('--level', String(data[offset] / 255));
    fixtureElements[i].dataset.dimmer = String(data[offset]);
  }
  bands.forEach((band, i) => { band.style.transform = `scaleY(${Math.max(.025, brain.audioFrame.spectrum[i] / 100)})`; });
  demo.dataset.ready = 'true';
  demo.dataset.brainMaster = String(brain.masterDimmer);
  demo.dataset.controllerMaster = String(controller.masterDimmer);
  demo.dataset.brainLook = String(brain.activeLook);
  demo.dataset.controllerLook = String(controller.activeLook);
  demo.dataset.linked = String(linked);
  demo.dataset.blackout = String(controller.blackout);
  demo.dataset.audio = String(audioEnabled);
  demo.dataset.brainReactive = String(brain.audioReactive);
  demo.dataset.controllerReactive = String(controller.audioReactive);
  demo.dataset.paused = String(paused);
  demo.dataset.dmxZero = String(data.every(value => value === 0));
  demo.dataset.checksum = String(runtime.controller.universe.checksum);
  demo.dataset.controllerDmx = controller.dmxStatus;
  demo.dataset.brainDmx = brain.dmxStatus;
  demo.dataset.simTime = String(Math.round(runtime.nowMs));
}

const guides = [
  ['Shape the light', 'Choose a look and adjust the Brain’s master. The simulated link carries those changes to the Controller and its virtual fixtures.'],
  ['Add an audio pulse', 'Start the synthetic 120 BPM pulse. The Brain receives generated audio data; the Controller uses that data to vary its lighting look. The demo is silent.'],
  ['Test the connection', 'Disconnect, then change the Brain’s master. The Controller keeps its last setting and local control. Try its blackout, reconnect, and move the master again.']
];
function setStep(step: number): void {
  $('step-number').textContent = `0${step} / 03`;
  $('guide-title').textContent = guides[step - 1][0];
  $('guide-copy').textContent = guides[step - 1][1];
  document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.step) === step)));
}
document.querySelectorAll<HTMLButtonElement>('[data-step]').forEach(button => button.addEventListener('click', () => { setStep(Number(button.dataset.step)); }));
master.addEventListener('input', () => {
  runtime.setMaster('BRAIN', Number(master.value)); settle();
  say(runtime.peer.link.connected ? `Brain master sent to the Controller: ${percent(runtime.controller.state.masterDimmer)}.` : 'The Brain changed locally. The disconnected Controller kept its own master level.');
});
look.addEventListener('change', () => {
  runtime.dispatch('BRAIN', eventValue('SceneChanged', runtime.nowMs, Number(look.value))); settle();
  say(runtime.peer.link.connected ? `${LOOK_LABELS[Number(look.value)]} sent to the Controller.` : 'The Brain changed its look. Reconnect and choose a look again to send it to the Controller.');
});
$('audio-toggle').addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  runtime.dispatch('BRAIN', { type: 'AudioReactiveChanged', timestampMs: runtime.nowMs, flag: audioEnabled });
  settle();
  if (audioEnabled) setStep(2);
  say(!runtime.peer.link.connected
    ? 'Pulse changed on the Brain only. Reconnect, then toggle the pulse again to send a fresh setting to the Controller.'
    : audioEnabled ? `Synthetic pulse ${paused ? 'loaded as a still frame; resume motion to animate' : 'running'}. No sound is played or recorded.` : 'Synthetic pulse stopped.');
});
$('link-toggle').addEventListener('click', () => {
  const connected = !runtime.peer.link.connected;
  runtime.setLinkConnected(connected); settle(); setStep(3);
  say(connected ? 'Link restored. Change the master, look, or pulse to send a fresh command; missed changes are not replayed.' : 'Peer disconnected. Brain changes no longer reach the Controller; its local blackout remains available.');
});
$('blackout').addEventListener('click', () => {
  const next = !runtime.controller.state.blackout;
  runtime.dispatch('DMX_CONTROLLER', { type: next ? 'BlackoutEnabled' : 'BlackoutDisabled', timestampMs: runtime.nowMs });
  settle();
  say(next ? 'Controller blackout: all 512 virtual DMX slots are zero.' : 'Controller restored its virtual lighting output.');
});
$('motion-toggle').addEventListener('click', () => {
  paused = !paused; lastStamp = 0; paint();
  say(paused ? 'Motion paused. Controls still update a still frame.' : 'Motion resumed.');
});
$('reset').addEventListener('click', () => { reset(); say('Reset: Wash look, 70% master, linked peers, synthetic pulse off.'); });
motionPreference.addEventListener('change', event => { if (event.matches) { paused = true; lastStamp = 0; paint(); } });
document.addEventListener('visibilitychange', () => { lastStamp = 0; });

reset();
function loop(stamp: number): void {
  if (!paused && !document.hidden) {
    if (lastStamp) advance(Math.min(60, stamp - lastStamp));
    if (stamp - lastPaint > 40) { paint(); lastPaint = stamp; }
  }
  lastStamp = stamp;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
