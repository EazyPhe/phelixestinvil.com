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
let currentStep = 1;
let guided = true;
let complete = false;
let guidePhase = 0;
let disconnectedLevel = 0;

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

function resetModel(): void {
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
  lastStamp = 0;
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
  $('controller-mode').textContent = controller.blackout ? 'Lights off locally' : linked ? 'Following Brain' : 'Keeping its setting';
  $('link-state').textContent = linked ? 'Connected' : 'Disconnected';
  document.querySelector('.connection')!.classList.toggle('disconnected', !linked);
  $('link-toggle').textContent = linked ? 'Disconnect' : 'Reconnect';
  $('link-toggle').setAttribute('aria-pressed', String(!linked));
  $('blackout').textContent = controller.blackout ? 'Restore lights' : 'Turn lights off';
  $('blackout').setAttribute('aria-pressed', String(controller.blackout));
  $('output-state').textContent = controller.blackout ? 'Lights off · blackout' : controller.masterDimmer === 0 ? 'Brightness at zero' : 'Lights on';
  $('audio-toggle').textContent = audioEnabled ? 'Stop demo beat' : 'Start demo beat';
  $('audio-toggle').setAttribute('aria-pressed', String(audioEnabled));
  $('audio-state').textContent = audioEnabled ? `120 BPM${paused ? ' · motion paused' : ' · silent'}` : 'Beat off';
  $('audio-hint').textContent = controller.audioReactive ? 'Controller reacting to generated data' : 'Generated music data · no sound';
  $('master-hint').textContent = linked ? 'The Brain sends this setting to the Controller.' : 'Only the Brain changes while the connection is off.';
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
  demo.dataset.mode = guided ? 'guided' : 'explore';
  demo.dataset.step = String(currentStep);
  demo.dataset.stepComplete = String(complete);
  demo.dataset.guidePhase = String(guidePhase);
}

const lessons = [
  { title: 'One change. Two devices.', copy: 'The Brain chooses a brightness setting. The Controller receives it and drives the lights.', task: 'Move Brightness down to about 60%.', watch: 'Both device numbers change together, and the lights dim.', waiting: 'Waiting for your brightness change.', success: 'You did it: one setting reached both devices.', groups: ['master'] },
  { title: 'Give the lights a rhythm.', copy: 'A lighting pattern decides how colors behave. Music data can make that pattern react to a beat.', task: 'Choose Flow or Wave, then start the demo beat.', watch: 'The bars show low to high notes. The lights react to generated music data; no sound is played.', waiting: 'Choose a new pattern and start the demo beat.', success: 'You did it: the Controller has the pattern and music data.', groups: ['look', 'audio'] },
  { title: 'What if the connection drops?', copy: 'These devices send messages to each other. Without a connection, a new Brain setting cannot reach the Controller.', task: 'Disconnect, then change Brightness.', watch: 'The Brain number changes; the Controller keeps its last brightness.', waiting: 'Disconnect the devices to start.', success: 'You did it: a fresh change reached the reconnected Controller.', groups: ['master', 'link'] },
  { title: 'Keep a local lights-off control.', copy: 'This lesson starts disconnected. The Controller can still turn its own lighting output off.', task: 'Turn the lights off, then restore them.', watch: 'The stage goes dark even without a connection. The brightness setting is remembered.', waiting: 'Turn the lights off to try a local blackout.', success: 'Guide complete. You have tried both device roles and their controls.', groups: ['blackout'] }
];

function renderGuide(): void {
  const lesson = lessons[currentStep - 1];
  $('step-number').textContent = guided ? 'STEP ' + currentStep + ' OF 4' : 'EXPLORE AT YOUR OWN PACE';
  $('guide-title').textContent = guided ? lesson.title : 'You are in control.';
  $('guide-copy').textContent = guided ? lesson.copy : 'Change a setting and watch the stage. The Brain sends instructions; the Controller drives the lights.';
  $('guide-task').textContent = guided ? lesson.task : 'Try a pattern, a beat, or a connection change.';
  $('guide-watch').textContent = guided ? lesson.watch : 'The two brightness numbers show whether a setting reached the Controller. Lights off always acts on the Controller.';
  $('explore-toggle').textContent = guided ? 'Explore freely' : 'Start guided tour';
  $('explore-toggle').setAttribute('aria-pressed', String(!guided));
  document.querySelectorAll<HTMLElement>('[data-control-group]').forEach(group => { group.hidden = guided && !lesson.groups.includes(group.dataset.controlGroup!); });
  document.querySelectorAll<HTMLButtonElement>('button[data-step]').forEach(button => { button.setAttribute('aria-pressed', String(guided && Number(button.dataset.step) === currentStep)); });
  document.querySelector<HTMLElement>('.guide-progress')!.hidden = !guided;
  $<HTMLButtonElement>('guide-back').disabled = currentStep === 1;
  $<HTMLButtonElement>('guide-next').disabled = !complete;
  $('guide-next').textContent = ['Next: music & patterns →', 'Next: connection →', 'Next: lights off →', 'Explore all controls →'][currentStep - 1];
  $('restart-guide').hidden = !(guided && currentStep === 4 && complete);
  $('guide-completion').textContent = complete ? lesson.success : lesson.waiting;
  $('guide-completion').classList.toggle('complete', complete);
  if (guided && currentStep === 3 && !complete) {
    if (guidePhase === 1) {
      $('guide-task').textContent = 'Now change Brightness while disconnected.';
      $('guide-completion').textContent = 'Disconnected. Try sending a new brightness setting.';
    } else if (guidePhase === 2) {
      $('guide-task').textContent = 'Reconnect, then move Brightness again.';
      $('guide-watch').textContent = 'Missed changes are not replayed. A fresh change brings both numbers together.';
      $('guide-completion').textContent = 'The Controller kept its brightness. Reconnect to continue.';
    } else if (guidePhase === 3) {
      $('guide-task').textContent = 'Move Brightness again to send a fresh setting.';
      $('guide-watch').textContent = 'Both numbers match once the new setting arrives.';
      $('guide-completion').textContent = 'Connection restored. Send one more brightness change.';
    }
  }
  if (guided && currentStep === 4 && guidePhase === 1 && !complete) {
    $('guide-task').textContent = 'Now restore the lights.';
    $('guide-completion').textContent = 'All lighting output is zero. Restore the lights to finish.';
  }
}

function setStep(step: number, focus = false): void {
  currentStep = Math.max(1, Math.min(4, step)); guided = true; complete = false; guidePhase = 0;
  resetModel();
  if (currentStep === 4) { runtime.setLinkConnected(false); advance(80); }
  renderGuide(); paint();
  say(currentStep === 4 ? 'This lesson starts with the connection off. Local Controller controls still work.' : 'Ready when you are. Try the action above.');
  if (focus) {
    $('controls').focus({ preventScroll: true });
    if (matchMedia('(max-width: 760px)').matches) {
      const stageHeight = document.querySelector<HTMLElement>('.stage-panel')!.offsetHeight;
      window.scrollTo({ top: window.scrollY + $('controls').getBoundingClientRect().top - stageHeight, behavior: 'instant' });
    }
  }
}

function explore(): void {
  guided = false; renderGuide(); paint();
  say(runtime.peer.link.connected ? 'All controls are available. Start the guided tour any time.' : 'All controls are available. The connection is off: reconnect to send new Brain settings.');
}

type Action = 'master' | 'look' | 'audio' | 'link' | 'blackout';
function checkProgress(action: Action): void {
  if (!guided || complete) return;
  const brain = runtime.brain.state;
  const controller = runtime.controller.state;
  const linked = runtime.peer.link.connected;
  if (currentStep === 1) {
    complete = action === 'master' && brain.masterDimmer !== Math.round(70 * 2.55) && brain.masterDimmer === controller.masterDimmer;
  } else if (currentStep === 2) {
    complete = controller.activeLook !== 0 && controller.activeLook === brain.activeLook && audioEnabled && controller.audioReactive && controller.peerAudioFrame?.present === true;
  } else if (currentStep === 3) {
    if (action === 'link' && !linked) { guidePhase = 1; disconnectedLevel = controller.masterDimmer; }
    if (action === 'master' && guidePhase === 1 && !linked && brain.masterDimmer !== disconnectedLevel && controller.masterDimmer === disconnectedLevel) guidePhase = 2;
    if (action === 'link' && linked && guidePhase === 1) guidePhase = 0;
    if (action === 'link' && linked && guidePhase === 2) guidePhase = 3;
    if (action === 'master' && guidePhase === 3 && linked && brain.masterDimmer === controller.masterDimmer) complete = true;
  } else if (currentStep === 4 && action === 'blackout') {
    const allOff = runtime.controller.universe.data.every(value => value === 0);
    if (!linked && controller.blackout && allOff) guidePhase = 1;
    if (guidePhase === 1 && !controller.blackout && !allOff) complete = true;
  }
  renderGuide(); paint();
}

document.querySelectorAll<HTMLButtonElement>('button[data-step]').forEach(button => button.addEventListener('click', () => { setStep(Number(button.dataset.step)); }));
$('guide-next').addEventListener('click', () => { if (!complete) return; if (currentStep === 4) explore(); else setStep(currentStep + 1, true); });
$('guide-back').addEventListener('click', () => { setStep(currentStep - 1, true); });
$('explore-toggle').addEventListener('click', () => { if (guided) explore(); else setStep(1, true); });
$('restart-guide').addEventListener('click', () => { setStep(1, true); });

master.addEventListener('input', () => {
  runtime.setMaster('BRAIN', Number(master.value)); settle();
  say(runtime.peer.link.connected
    ? 'Brightness received: both devices are set to ' + percent(runtime.controller.state.masterDimmer) + '.'
    : 'Brain: ' + percent(runtime.brain.state.masterDimmer) + '. Controller: still ' + percent(runtime.controller.state.masterDimmer) + '. No connection, so the new setting stayed on the Brain.');
  checkProgress('master');
});
look.addEventListener('change', () => {
  runtime.dispatch('BRAIN', eventValue('SceneChanged', runtime.nowMs, Number(look.value))); settle();
  say(runtime.peer.link.connected ? LOOK_LABELS[Number(look.value)] + ' pattern sent to the Controller.' : 'Only the Brain changed pattern. Reconnect and choose a pattern again to send it to the Controller.');
  checkProgress('look');
});
$('audio-toggle').addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  runtime.dispatch('BRAIN', { type: 'AudioReactiveChanged', timestampMs: runtime.nowMs, flag: audioEnabled });
  settle();
  say(!runtime.peer.link.connected
    ? 'Demo beat changed on the Brain only. Reconnect, then switch the beat again to send a fresh setting.'
    : audioEnabled ? 'Demo beat ' + (paused ? 'loaded as a still frame; resume motion to animate' : 'running') + '. These are generated numbers: no sound is played or recorded.' : 'Demo beat stopped.');
  checkProgress('audio');
});
$('link-toggle').addEventListener('click', () => {
  const connected = !runtime.peer.link.connected;
  runtime.setLinkConnected(connected); settle();
  say(connected ? 'Connected again. Change brightness, pattern, or beat to send a fresh instruction; missed changes are not replayed.' : 'Disconnected. New Brain settings cannot reach the Controller. The Controller keeps control of its lights.');
  checkProgress('link');
});
$('blackout').addEventListener('click', () => {
  const next = !runtime.controller.state.blackout;
  runtime.dispatch('DMX_CONTROLLER', { type: next ? 'BlackoutEnabled' : 'BlackoutDisabled', timestampMs: runtime.nowMs });
  settle();
  say(next ? 'All lights off. The Controller set every virtual lighting output value to zero.' : 'Lights restored. The Controller uses its remembered brightness setting.');
  checkProgress('blackout');
});
$('motion-toggle').addEventListener('click', () => {
  paused = !paused; lastStamp = 0; paint();
  say(paused ? 'Motion paused. Controls still update a still frame.' : 'Motion resumed.');
});
$('reset').addEventListener('click', () => { setStep(1); say('Guide restarted: 70% brightness, Wash pattern, connected devices, demo beat off.'); });
motionPreference.addEventListener('change', event => { if (event.matches) { paused = true; lastStamp = 0; paint(); } });
document.addEventListener('visibilitychange', () => { lastStamp = 0; });

setStep(1);
function loop(stamp: number): void {
  if (!paused && !document.hidden) {
    if (lastStamp) advance(Math.min(60, stamp - lastStamp));
    if (stamp - lastPaint > 40) { paint(); lastPaint = stamp; }
  }
  lastStamp = stamp;
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
