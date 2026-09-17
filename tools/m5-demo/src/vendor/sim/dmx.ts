import {
  DMX_FRAME_INTERVAL_MS,
  DMX_UNIVERSE_SLOTS,
  LOOK_DEFAULT_DEPTHS,
  LOOK_DEFAULT_SPEEDS,
  PEER_AUDIO_AUTHORITY_MS,
  SPECTRUM_BAND_COUNT,
  clamp,
  emptyAudioFrame,
  emptyFixtureRenderState
} from "./constants";
import { fixtureFitsUniverse, fixtureProfileChannelCount, renderFixtureProfile } from "./fixtures";
import { applyFixtureSensitivity, frequencyMapColorForFixture, frequencyMapRawEnergyForFixture, isFrequencyMapFixtureActive } from "./frequency-map";
import { evaluateSafety, scaleUniverse } from "./safety";
import { manualBpmIsActive } from "./state";
import type { SimAudioFrame, SimDmxUniverse, SimFixturePatch, SimFixtureRenderState, SimSystemState } from "./types";

const PALETTES: Array<[number, number, number, number]> = [
  [255, 170, 72, 96],
  [48, 96, 255, 32],
  [255, 48, 96, 16],
  [255, 255, 255, 255],
  [255, 60, 24, 18],
  [48, 220, 255, 0],
  [255, 242, 210, 112],
  [40, 255, 170, 16],
  [28, 144, 255, 12],
  [255, 52, 120, 24],
  [68, 220, 255, 72],
  [255, 190, 64, 120]
] as const;

const COLOR_PRESETS: Array<[number, number, number, number]> = [
  [255, 0, 0, 0],
  [255, 80, 0, 0],
  [255, 150, 0, 0],
  [0, 255, 0, 0],
  [0, 180, 255, 0],
  [0, 0, 255, 0],
  [160, 0, 255, 0],
  [255, 255, 255, 120],
  [255, 120, 40, 60]
] as const;

const DEFAULT_BEAT_PERIOD_MS = 500;

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
}

export function buildDmxUniverse(
  state: SimSystemState,
  frameCount: number,
  nowMs: number,
  previousUniverse?: SimDmxUniverse,
  peerAgeMs = 0
): SimDmxUniverse {
  const { policy } = evaluateSafety(state, peerAgeMs);

  if (policy.forceBlackout) {
    const data = new Uint8Array(DMX_UNIVERSE_SLOTS);
    const length = previousUniverse?.length ?? state.fixtureSummary.activeSlots;
    return {
      data,
      length,
      renderedFixtureCount: 0,
      checksum: 0,
      lastBuildOk: true,
      fixtureStates: previousUniverse?.fixtureStates ?? [],
      frameCount
    };
  }

  if (policy.holdLastFrame && previousUniverse && previousUniverse.length > 0) {
    const data = new Uint8Array(previousUniverse.data);
    if (policy.outputScale < 255) {
      scaleUniverse(data, previousUniverse.length, policy.outputScale);
    }
    return {
      ...previousUniverse,
      data,
      checksum: checksum(data, previousUniverse.length),
      frameCount
    };
  }

  if (!policy.allowSceneRefresh && previousUniverse && previousUniverse.length > 0) {
    return {
      ...previousUniverse,
      frameCount
    };
  }

  const fixtureStates = state.fixturePatch.fixtures.map((_, index) => previewRenderStateForFixture(state, index, nowMs));
  const universe = buildUniverseFromFixtureStates(state.fixturePatch, fixtureStates);
  if (policy.outputScale < 255 && universe.length > 0) {
    scaleUniverse(universe.data, universe.length, policy.outputScale);
    universe.checksum = checksum(universe.data, universe.length);
  }
  return {
    ...universe,
    frameCount
  };
}

export function buildUniverseFromFixtureStates(
  patch: SimFixturePatch,
  fixtureStates: SimFixtureRenderState[]
): Omit<SimDmxUniverse, "frameCount"> {
  const data = new Uint8Array(DMX_UNIVERSE_SLOTS);
  let activeSlots = 0;
  let renderedFixtureCount = 0;
  let lastBuildOk = true;

  for (let i = 0; i < patch.fixtureCount; i += 1) {
    const fixture = patch.fixtures[i];
    if (!fixture || !fixture.enabled || fixture.universeId !== patch.universeId) {
      continue;
    }

    const channelCount = fixtureProfileChannelCount(fixture.profileId);
    if (!fixtureFitsUniverse(fixture.startAddress, channelCount)) {
      lastBuildOk = false;
      break;
    }

    const offset = fixture.startAddress - 1;
    const renderState = fixtureStates[i] ?? emptyFixtureRenderState();
    if (!renderFixtureProfile(fixture.profileId, renderState, data, offset, channelCount)) {
      lastBuildOk = false;
      break;
    }

    activeSlots = Math.max(activeSlots, offset + channelCount);
    renderedFixtureCount += 1;
  }

  return {
    data,
    length: activeSlots,
    renderedFixtureCount,
    checksum: checksum(data, activeSlots),
    lastBuildOk,
    fixtureStates
  };
}

export function checksum(slots: Uint8Array, length: number): number {
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum = (sum + slots[i]) & 0xffff;
  }
  return sum;
}

export function shouldRenderDmx(lastRenderMs: number, nowMs: number): boolean {
  return nowMs - lastRenderMs >= DMX_FRAME_INTERVAL_MS;
}

function previewRenderStateForFixture(state: SimSystemState, fixtureIndex: number, nowMs: number): SimFixtureRenderState {
  const renderState = emptyFixtureRenderState();

  if (state.blackout) {
    return renderState;
  }

  const fixture = state.fixturePatch.fixtures[fixtureIndex];
  const colorPreset = state.colorPresetIndex < COLOR_PRESETS.length ? COLOR_PRESETS[state.colorPresetIndex] : null;
  if (colorPreset && state.audioReactive && fixture) {
    return manualColorSpectrumRenderStateForFixture(state, fixture.id, fixtureIndex, nowMs, colorPreset);
  }

  if (state.frequencyMap.enabled && state.audioReactive && fixture) {
    return frequencyMapRenderStateForFixture(state, fixture.id, nowMs);
  }

  const lookSpeed = colorPreset ? 127 : tunedLookSpeed(state);
  const lookDepth = tunedLookDepth(state);
  const defaultSpeed = Math.max(1, LOOK_DEFAULT_SPEEDS[state.activeLook] ?? 127);
  const defaultDepth = colorPreset ? 255 : Math.max(1, LOOK_DEFAULT_DEPTHS[state.activeLook] ?? 192);
  const rateScale = colorPreset ? 1 : clampFloat(lookSpeed / defaultSpeed, 0.25, 1.8);
  const motionMs = nowMs * rateScale;
  renderState.speed = lookSpeed;

  const audio = state.audioReactive ? effectiveAudioFrame(state, nowMs) : emptyAudioFrame(nowMs);
  const [baseRed, baseGreen, baseBlue, baseWhite] = colorPreset ?? PALETTES[state.activeScene % PALETTES.length];
  const rawAudioEnergy = audio.present ? clamp((audio.rms * 2 + bandLevel(audio, fixtureIndex) * 3) / 5, 0, 100) : 34;
  const audioEnergy = fixture && audio.present ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawAudioEnergy) : rawAudioEnergy;
  const beatAccent = audio.present && audio.beatHit ? (fixtureIndex === 0 ? 56 : 28) : 0;
  const movement = Math.sin((motionMs / 420) + fixtureIndex * 0.9);
  let dimmerPercent = 100;
  let red = baseRed;
  let green = baseGreen;
  let blue = baseBlue;
  let white = baseWhite;
  let strobe = 0;

  if (colorPreset) {
    dimmerPercent = 100;
  } else switch (state.activeScene % PALETTES.length) {
    case 0:
      dimmerPercent = 54 + audioEnergy * 0.42;
      white = clamp(baseWhite + audioEnergy * 0.8, 0, 255);
      break;
    case 1:
      dimmerPercent = 20 + audioEnergy * 1.45 + beatAccent;
      red = fixtureIndex % 2 === 0 ? 48 : 220;
      green = 96;
      blue = 255;
      break;
    case 2: {
      const movingBand = audio.spectrum[(fixtureIndex + Math.floor(motionMs / 350)) % SPECTRUM_BAND_COUNT] ?? 0;
      const movingEnergy = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, movingBand) : movingBand;
      const wave = (movement + 1) * 0.5;
      dimmerPercent = 28 + movingEnergy * 0.9 + wave * 26;
      red = fixtureIndex % 3 === 0 ? 255 : 32;
      green = fixtureIndex % 3 === 1 ? 255 : 48;
      blue = fixtureIndex % 3 === 2 ? 255 : 96;
      white = 16;
      break;
    }
    case 3: {
      const beatWindow = state.lastBeatMs > 0 && nowMs - state.lastBeatMs < 90;
      const timedFlash = Math.floor(motionMs / beatPeriodMs(state, nowMs)) % 2 === 0;
      const flash = state.audioReactive && audio.present
        ? beatWindow || audio.beatHit
        : timedFlash;
      dimmerPercent = flash ? 100 : 18;
      strobe = flash && audio.present ? 40 : 0;
      red = 255;
      green = 255;
      blue = 255;
      white = 255;
      break;
    }
    case 4: {
      const rawBass = audio.present ? bassLevel(audio) : (movement + 1) * 50;
      const rawMid = audio.present ? midLevel(audio) : (Math.sin(motionMs / 620 + fixtureIndex) + 1) * 50;
      const bass = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawBass) : rawBass;
      const mid = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawMid) : rawMid;
      dimmerPercent = 28 + bass * 1.08 + (audio.beatHit ? 12 : 0);
      red = 255;
      green = clamp(48 + mid * 1.6, 0, 255);
      blue = clamp(18 + mid * 0.32, 0, 255);
      white = clamp(16 + bass * 0.72, 0, 255);
      break;
    }
    case 5: {
      const movingBand = (fixtureIndex + Math.floor(motionMs / 220)) % SPECTRUM_BAND_COUNT;
      const rawEnergy = audio.present ? audio.spectrum[movingBand] ?? 0 : (Math.sin(motionMs / 230 + fixtureIndex) + 1) * 50;
      const chaseEnergy = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawEnergy) : rawEnergy;
      const [wheelRed, wheelGreen, wheelBlue, wheelWhite] = wheelColor((motionMs / 24 + fixtureIndex * 29 + chaseEnergy) % 255);
      dimmerPercent = 18 + chaseEnergy * 1.02;
      red = wheelRed;
      green = wheelGreen;
      blue = wheelBlue;
      white = wheelWhite;
      break;
    }
    case 6: {
      const tune = state.gateTune;
      const gateWindow = 36 + tune.flashPercent * 0.32;
      const fixtureDelay = 28 - tune.flashPercent * 0.12;
      const burstPeriod = 280 - tune.flashPercent * 1.2;
      const beatFloor = 20 + tune.flashPercent * 0.16;
      const burstThreshold = 96 - tune.flashPercent * 0.24;
      const beatThreshold = 64 - tune.flashPercent * 0.24;
      const flashScale = 65 + tune.intensityPercent * 0.5;
      const tailBase = 12 + tune.tailPercent * 0.16;
      const tailDepth = 28 + tune.tailPercent * 0.56;
      const flashRed = mix(255, 255, tune.colorPercent);
      const flashGreen = mix(255, 229, tune.colorPercent);
      const flashBlue = mix(255, 165, tune.colorPercent);
      const flashWhite = mix(64, 160, tune.colorPercent);
      const tailRed = mix(12, 44, tune.colorPercent);
      const tailGreen = mix(88, 40, tune.colorPercent);
      const tailBlue = mix(220, 180, tune.colorPercent);
      const gateRaw = audio.present ? Math.max(audio.peak, trebleLevel(audio), bassLevel(audio)) : 0;
      const gate = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, gateRaw) : gateRaw;
      const elapsed = state.lastBeatMs > 0 ? nowMs - state.lastBeatMs : Number.POSITIVE_INFINITY;
      const fixturePhaseDelay = fixtureIndex * fixtureDelay;
      const beatWindow = gate >= beatFloor && elapsed >= fixturePhaseDelay && elapsed < fixturePhaseDelay + gateWindow;
      const burstPhase = (motionMs + fixturePhaseDelay) % burstPeriod;
      const energyBurst = gate >= burstThreshold && burstPhase < gateWindow;
      const fallbackPeriod = beatPeriodMs(state, nowMs);
      const fallbackDelay = fixtureIndex * Math.max(24, Math.round(fallbackPeriod * 0.15));
      const flash = audio.present ? beatWindow || energyBurst || (audio.beatHit && gate >= beatThreshold) : Math.floor((nowMs + fallbackDelay) / fallbackPeriod) % 2 === 0;
      dimmerPercent = flash ? flashScale : tailBase + gate * (tailDepth / 100);
      strobe = flash && audio.present ? tune.flashPercent * 0.84 : 0;
      red = flash ? flashRed : tailRed;
      green = flash ? flashGreen : tailGreen;
      blue = flash ? flashBlue : tailBlue;
      white = flash ? flashWhite : 0;
      break;
    }
    case 7:
      {
      const wave = (Math.sin(motionMs / 260 + fixtureIndex * 1.2) + 1) * 50;
      const rawDrive = audio.present ? Math.max(bandLevel(audio, fixtureIndex), midLevel(audio), bassLevel(audio)) : wave;
      const sweepDrive = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawDrive) : rawDrive;
      const drive = Math.max(wave * 0.58, sweepDrive);
      dimmerPercent = 20 + drive * 0.95 + (audio.beatHit ? 10 : 0);
      const blend = clamp(wave + trebleLevel(audio) * 0.35, 0, 100);
      red = mix(40, 64, blend);
      green = mix(255, 80, blend);
      blue = mix(170, 255, blend);
      white = 16;
      break;
    }
    case 8: {
      const rawKick = audio.present ? Math.max(audio.kickEnergy, bassLevel(audio)) : (Math.sin(motionMs / 250 + fixtureIndex) + 1) * 50;
      const kick = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawKick) : rawKick;
      const intensity = audio.present
        ? (fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, audio.intensityEnergy) : audio.intensityEnergy)
        : kick * 0.7;
      const pump = Math.max(kick, audio.beatHit ? 92 : 0);
      dimmerPercent = 10 + intensity * 0.18 + pump * (0.92 + intensity / 260);
      red = clamp(18 + pump * 0.28, 0, 255);
      green = clamp(84 + trebleLevel(audio) * 0.42, 0, 255);
      blue = 255;
      white = clamp(8 + kick * 1.05, 0, 255);
      break;
    }
    case 9: {
      const rawSnare = audio.present ? Math.max(audio.snareEnergy, midLevel(audio)) : (Math.sin(motionMs / 180 + fixtureIndex * 0.7) + 1) * 50;
      const rawHat = audio.present ? Math.max(audio.hatEnergy, trebleLevel(audio)) : (Math.sin(motionMs / 120 + fixtureIndex) + 1) * 42;
      const snare = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawSnare) : rawSnare;
      const hat = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawHat) : rawHat;
      const intensity = audio.present
        ? (fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, audio.intensityEnergy) : audio.intensityEnergy)
        : (snare + hat) / 2;
      const pop = snare >= 54 || hat >= 68 || (audio.beatHit && fixtureIndex % 2 === 0);
      dimmerPercent = 14 + intensity * 0.16 + snare * 0.82 + hat * 0.34 + (pop ? 16 : 0);
      red = 255;
      green = clamp(38 + hat * 1.35, 0, 255);
      blue = clamp(94 + snare * 1.24, 0, 255);
      white = pop ? 128 : clamp(18 + hat * 0.74, 0, 255);
      strobe = pop && audio.present ? 38 : 0;
      break;
    }
    case 10: {
      const rawVocal = audio.present ? Math.max(audio.vocalPresence, audio.vocalPhrase) : (Math.sin(motionMs / 720 + fixtureIndex * 0.8) + 1) * 50;
      const vocal = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawVocal) : rawVocal;
      const phrase = audio.present ? audio.vocalPhrase : vocal;
      const breakdown = audio.present
        ? (fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, audio.breakdownEnergy) : audio.breakdownEnergy)
        : 0;
      const sectionBoost = audio.sectionChange ? 24 : 0;
      const glow = Math.max(vocal, phrase * 0.84);
      const calm = 1 - Math.min(0.42, breakdown / 240);
      dimmerPercent = (22 + glow * 0.92 + sectionBoost) * calm;
      red = clamp(40 + phrase * 0.22, 0, 255);
      green = clamp(120 + vocal * 1.0, 0, 255);
      blue = 255;
      white = clamp(20 + phrase * 1.08 + (audio.sectionChange ? 52 : 0), 0, 255);
      break;
    }
    case 11:
    default: {
      const timedRise = ((motionMs + fixtureIndex * 90) % 2_400) / 24;
      const rawBuild = audio.present ? Math.max(audio.buildEnergy, audio.buildSlope, trebleLevel(audio)) : timedRise;
      const build = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawBuild) : rawBuild;
      const rawTension = audio.present ? Math.max(audio.tensionEnergy, audio.buildSlope) : timedRise;
      const tension = fixture ? applyFixtureSensitivity(state.frequencyMap, fixture.id, rawTension) : rawTension;
      const drop = audio.releaseHit || audio.dropHit || (audio.beatHit && tension >= 76);
      dimmerPercent = 18 + Math.max(build, tension) * 0.88 + (drop ? 54 : 0);
      red = 255;
      green = clamp(86 + tension * 1.38, 0, 255);
      blue = drop ? 255 : clamp(32 + build * 0.55, 0, 255);
      white = drop ? 255 : clamp(24 + tension * 0.82, 0, 255);
      strobe = drop && audio.present ? 62 : 0;
      break;
    }
  }

  dimmerPercent *= clampFloat(lookDepth / defaultDepth, 0, 1.5);

  const dimmer = clamp((state.masterDimmer * clamp(dimmerPercent, 0, 120)) / 100, 0, 255);
  renderState.dimmer = dimmer;
  renderState.red = scaleColor(red, dimmer);
  renderState.green = scaleColor(green, dimmer);
  renderState.blue = scaleColor(blue, dimmer);
  renderState.white = scaleColor(white, dimmer);
  renderState.strobe = strobe;
  return renderState;
}

function tunedLookSpeed(state: SimSystemState): number {
  return state.lookTune.baseLook === state.activeLook
    ? state.lookTune.speed
    : LOOK_DEFAULT_SPEEDS[state.activeLook] ?? 127;
}

function tunedLookDepth(state: SimSystemState): number {
  return state.lookTune.baseLook === state.activeLook
    ? state.lookTune.depth
    : LOOK_DEFAULT_DEPTHS[state.activeLook] ?? 192;
}

function manualColorSpectrumRenderStateForFixture(
  state: SimSystemState,
  fixtureId: number,
  fixtureIndex: number,
  nowMs: number,
  color: [number, number, number, number]
): SimFixtureRenderState {
  const renderState = emptyFixtureRenderState();
  renderState.speed = 127;

  const audio = effectiveAudioFrame(state, nowMs);
  const rawEnergy = audio.present
    ? isFrequencyMapFixtureActive(state.frequencyMap, fixtureId)
      ? frequencyMapRawEnergyForFixture(state.frequencyMap, fixtureId, audio.spectrum)
      : clamp(audio.spectrum[fixtureIndex % SPECTRUM_BAND_COUNT] ?? 0, 0, 100)
    : 0;
  const energy = applyFixtureSensitivity(state.frequencyMap, fixtureId, rawEnergy);
  let dimmerPercent = audio.present ? 18 + energy * 0.82 : 28;
  if (audio.beatHit) {
    dimmerPercent += 10;
  }
  const dimmer = clamp((state.masterDimmer * clamp(dimmerPercent, 0, 100)) / 100, 0, 255);

  renderState.dimmer = dimmer;
  renderState.red = color[0];
  renderState.green = color[1];
  renderState.blue = color[2];
  renderState.white = color[3];
  return renderState;
}

function effectiveAudioFrame(state: SimSystemState, nowMs: number): SimAudioFrame {
  const localIsAuthority =
    (state.role === "BRAIN" && state.audioSource === "LINE") ||
    (state.role === "DMX_CONTROLLER" && state.audioSource === "MIC");
  const candidate = localIsAuthority ? state.audioFrame : state.peerAudioFrame;
  const manualActive = manualBpmIsActive(state, nowMs);
  if (!candidate || nowMs - candidate.timestampMs > PEER_AUDIO_AUTHORITY_MS) {
    const empty = { ...emptyAudioFrame(nowMs), source: state.audioSource };
    return manualActive
      ? { ...empty, bpm: state.bpm, beatConfidence: state.bpmConfidence, tempoLocked: true }
      : empty;
  }
  return manualActive
    ? { ...candidate, bpm: state.bpm, beatConfidence: state.bpmConfidence, tempoLocked: true }
    : candidate;
}

function beatPeriodMs(state: SimSystemState, nowMs: number, audioTempoEnabled = false): number {
  const tempoEnabled = audioTempoEnabled || manualBpmIsActive(state, nowMs) || state.bpmDetectEnabled;
  if (tempoEnabled && state.bpm >= 40 && state.bpm <= 240) {
    return Math.round(60_000 / state.bpm);
  }
  return DEFAULT_BEAT_PERIOD_MS;
}

function bandLevel(audio: SimAudioFrame, fixtureIndex: number): number {
  if (!audio.present) {
    return 0;
  }
  const primary = fixtureIndex % SPECTRUM_BAND_COUNT;
  const secondary = (primary + 1) % SPECTRUM_BAND_COUNT;
  return Math.max(audio.spectrum[primary] ?? 0, Math.round((audio.spectrum[secondary] ?? 0) * 0.72));
}

function bandAverage(audio: SimAudioFrame, start: number, end: number): number {
  if (!audio.present) {
    return 0;
  }
  let sum = 0;
  let count = 0;
  for (let index = start; index <= end && index < audio.spectrum.length; index += 1) {
    sum += audio.spectrum[index] ?? 0;
    count += 1;
  }
  return count === 0 ? 0 : clamp(sum / count, 0, 100);
}

function bassLevel(audio: SimAudioFrame): number {
  return Math.max(bandAverage(audio, 0, 3), audio.rms * 0.85);
}

function midLevel(audio: SimAudioFrame): number {
  return bandAverage(audio, 4, 9);
}

function trebleLevel(audio: SimAudioFrame): number {
  return bandAverage(audio, 10, 15);
}

function frequencyMapRenderStateForFixture(state: SimSystemState, fixtureId: number, nowMs: number): SimFixtureRenderState {
  const renderState = emptyFixtureRenderState();
  renderState.speed = 127;
  if (!isFrequencyMapFixtureActive(state.frequencyMap, fixtureId)) {
    return renderState;
  }

  const audio = effectiveAudioFrame(state, nowMs);
  const rawEnergy = audio.present ? frequencyMapRawEnergyForFixture(state.frequencyMap, fixtureId, audio.spectrum) : 0;
  const energy = applyFixtureSensitivity(state.frequencyMap, fixtureId, rawEnergy);
  let [red, green, blue, white] = COLOR_PRESETS[frequencyMapColorForFixture(state.frequencyMap, fixtureId)] ?? COLOR_PRESETS[0];
  let dimmer = 0;
  let strobe = 0;

  switch (state.frequencyMap.reactionStyle) {
    case "BRIGHTNESS":
      dimmer = clamp((state.masterDimmer * energy) / 100, 0, 255);
      break;
    case "FLASH": {
      const flash = energy >= 62 || (audio.beatHit && energy >= 42);
      dimmer = flash ? state.masterDimmer : clamp((state.masterDimmer * 18) / 100, 0, 255);
      strobe = flash ? 48 : 0;
      break;
    }
    case "MORPH": {
      const [accentRed, accentGreen, accentBlue, accentWhite] = COLOR_PRESETS[7];
      red = mix(red, accentRed, energy);
      green = mix(green, accentGreen, energy);
      blue = mix(blue, accentBlue, energy);
      white = mix(white, accentWhite, energy);
      dimmer = clamp((state.masterDimmer * (20 + energy * 0.8)) / 100, 0, 255);
      break;
    }
  }

  renderState.dimmer = dimmer;
  renderState.red = red;
  renderState.green = green;
  renderState.blue = blue;
  renderState.white = white;
  renderState.strobe = strobe;
  return renderState;
}

function scaleColor(value: number, dimmer: number): number {
  return clamp((value * dimmer) / 255, 0, 255);
}

function mix(base: number, accent: number, amountPercent: number): number {
  return clamp((base * (100 - amountPercent) + accent * amountPercent) / 100, 0, 255);
}

function wheelColor(phaseValue: number): [number, number, number, number] {
  let phase = clamp(phaseValue, 0, 255);
  if (phase < 85) {
    return [255 - phase * 3, phase * 3, 0, 0].map((value) => clamp(value, 0, 255)) as [number, number, number, number];
  }
  if (phase < 170) {
    phase -= 85;
    return [0, 255 - phase * 3, phase * 3, 0].map((value) => clamp(value, 0, 255)) as [number, number, number, number];
  }
  phase -= 170;
  return [phase * 3, 0, 255 - phase * 3, 0].map((value) => clamp(value, 0, 255)) as [number, number, number, number];
}
