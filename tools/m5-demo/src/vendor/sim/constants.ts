import type { SimAudioFrame, SimFixtureRenderState } from "./types";

export const SCREEN_W = 320;
export const SCREEN_H = 240;
export const DMX_UNIVERSE_SLOTS = 512;
export const MAX_FIXTURES = 32;
export const DEFAULT_UNIVERSE_ID = 1;
export const DEFAULT_FIXTURE_COUNT = 4;
export const DEFAULT_FIXTURE_PROFILE = "rgb7";
export const PEER_AUDIO_INTERVAL_MS = 40;
export const PEER_OUTPUT_PREVIEW_INTERVAL_MS = 33;
export const PEER_OUTPUT_PREVIEW_FRESH_MS = 180;
export const PEER_STALE_MS = 1_200;
export const PEER_LOST_MS = 5_000;
export const SAFETY_LINK_WARNING_MS = 1_200;
export const SAFETY_FADE_START_MS = 3_000;
export const SAFETY_HARD_BLACKOUT_MS = 5_000;
export const SAFETY_FADE_DURATION_MS = 750;
export const PROTOCOL_MAJOR = 0;
export const PROTOCOL_MINOR = 24;
export const FIRMWARE_VERSION = "0.24.0-light-tune";
export const PEER_AUDIO_AUTHORITY_MS = 500;
export const MISSING_AUDIO_PUBLISH_INTERVAL_MS = 80;
export const DMX_FRAME_INTERVAL_MS = 20;

export const LOOK_LABELS = ["Wash", "Pulse", "Flow", "Flash", "Bass", "Chase", "Gate", "Wave", "Kick Pump", "Snare Pop", "Vocal Glow", "Build Drop"] as const;
export const LOOK_SHORT_LABELS = ["WASH", "PULSE", "FLOW", "FLASH", "BASS", "CHASE", "GATE", "WAVE", "KICK", "SNARE", "VOCAL", "DROP"] as const;
export const LOOK_DEFAULT_SPEEDS = [90, 140, 170, 180, 118, 190, 188, 156, 150, 176, 128, 190] as const;
export const LOOK_DEFAULT_DEPTHS = [160, 220, 200, 255, 230, 235, 224, 224, 238, 232, 220, 245] as const;
export const DEFAULT_GATE_TUNE = {
  intensityPercent: 70,
  flashPercent: 50,
  tailPercent: 50,
  colorPercent: 50
} as const;
export const TAB_LABELS = ["LIGHT", "AUDIO", "TOOLS"] as const;
export const SPECTRUM_BAND_COUNT = 16;
export const SPECTRUM_LABELS = ["45", "80", "120", "180", "280", "420", "700", "1K", "1.4", "2K", "3K", "4.3", "6K", "8K", "10.5", "13K"] as const;

export const SPECTRUM_RANGES_HZ: Array<[number, number]> = [
  [45, 80],
  [80, 120],
  [120, 180],
  [180, 280],
  [280, 420],
  [420, 700],
  [700, 1000],
  [1000, 1400],
  [1400, 2000],
  [2000, 3000],
  [3000, 4300],
  [4300, 6000],
  [6000, 8000],
  [8000, 10500],
  [10500, 13000],
  [13000, 15500]
];

export function emptyAudioFrame(timestampMs = 0): SimAudioFrame {
  return {
    frameSeq: 0,
    source: "LINE",
    present: false,
    rms: 0,
    peak: 0,
    beatConfidence: 0,
    beatHit: false,
    bpm: 0,
    tempoLocked: false,
    kickEnergy: 0,
    snareEnergy: 0,
    hatEnergy: 0,
    vocalPresence: 0,
    vocalPhrase: 0,
    buildEnergy: 0,
    intensityEnergy: 0,
    breakdownEnergy: 0,
    buildSlope: 0,
    tensionEnergy: 0,
    sectionChange: false,
    releaseHit: false,
    dropHit: false,
    analysisUs: 0,
    spectrum: Array.from({ length: SPECTRUM_BAND_COUNT }, () => 0),
    timestampMs
  };
}

export function emptyFixtureRenderState(): SimFixtureRenderState {
  return {
    dimmer: 0,
    red: 0,
    green: 0,
    blue: 0,
    white: 0,
    strobe: 0,
    macro: 0,
    speed: 0,
    identify: false
  };
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}
