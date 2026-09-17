import { DEFAULT_FIXTURE_COUNT, DEFAULT_FIXTURE_PROFILE, DEFAULT_GATE_TUNE, LOOK_DEFAULT_DEPTHS, LOOK_DEFAULT_SPEEDS, LOOK_LABELS, SPECTRUM_BAND_COUNT, clamp, emptyAudioFrame } from "./constants";
import {
  applyPeerFrequencyMap,
  applyFrequencyMapPreset,
  assignFrequencyMapFixture,
  autoSpreadFrequencyMap,
  createInitialFrequencyMap,
  setFrequencyMapFixtureBandMask,
  setFrequencyMapFixtureSensitivity,
  setFrequencyMapEnabled,
  setFrequencyMapStyle
} from "./frequency-map";
import { buildUniformFixturePatch, summarizeFixturePatch } from "./fixtures";
import type {
  AudioSource,
  HardwareDeviceRole,
  LinkStatus,
  OutputStatus,
  SimAudioFrame,
  SimEvent,
  SimEventType,
  SimFrequencyMap,
  FrequencyMapPreset,
  SimStateAction,
  SimSystemState,
  UIState
} from "./types";

function createDefaultPowerTelemetry(charging: boolean): SimSystemState["power"] {
  return {
    supported: true,
    externalPower: charging,
    charging,
    low: false,
    critical: false,
    percent: charging ? 86 : 72,
    batteryMv: charging ? 4120 : 3850,
    vbusMv: charging ? 5120 : 0,
    batteryRunSec: 0
  };
}

const MANUAL_BPM_MIN = 40;
const MANUAL_BPM_MAX = 240;

function lookTuneDefaults(look: number, active = false): SimSystemState["lookTune"] {
  return {
    baseLook: look,
    speed: LOOK_DEFAULT_SPEEDS[look] ?? 127,
    depth: LOOK_DEFAULT_DEPTHS[look] ?? 192,
    active
  };
}

export type SimEventHandler = (event: SimEvent) => void;

export class SimEventBus {
  private readonly subscriptions = new Map<SimEventType, Set<SimEventHandler>>();
  private publishCountValue = 0;

  publish(event: SimEvent): void {
    this.publishCountValue += 1;
    const handlers = this.subscriptions.get(event.type);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(event);
    }
  }

  subscribe(type: SimEventType, handler: SimEventHandler): () => void {
    const handlers = this.subscriptions.get(type) ?? new Set<SimEventHandler>();
    handlers.add(handler);
    this.subscriptions.set(type, handlers);
    return () => handlers.delete(handler);
  }

  clear(): void {
    this.subscriptions.clear();
    this.publishCountValue = 0;
  }

  publishedCount(): number {
    return this.publishCountValue;
  }
}

export function createInitialState(role: HardwareDeviceRole, nowMs = 0): SimSystemState {
  const patch = buildUniformFixturePatch(DEFAULT_FIXTURE_PROFILE, DEFAULT_FIXTURE_COUNT);
  return {
    role,
    blackout: false,
    freeze: false,
    audioReactive: false,
    audioReactivityPercent: 70,
    audioSmoothingPercent: 40,
    bpm: 0,
    bpmConfidence: 0,
    lastBeatMs: 0,
    manualBpmActive: false,
    manualBpmUntilMs: 0,
    bpmDetectEnabled: false,
    masterDimmer: 255,
    activeScene: 0,
    activeLook: 0,
    colorPresetIndex: 255,
    linkStatus: "OFFLINE",
    dmxStatus: role === "BRAIN" ? "NoPhysicalOutput" : "OutputDisabled",
    physicalOutputRequested: false,
    peerOutputStatus: "NoPhysicalOutput",
    peerPhysicalOutputRequested: false,
    uiState: "LIVE",
    displayMirrorEnabled: false,
    screenEnabled: true,
    screenBrightness: 180,
    screenRotationDeg: 0,
    gateTune: { ...DEFAULT_GATE_TUNE },
    lookTune: lookTuneDefaults(0),
    frequencyMap: createInitialFrequencyMap(patch),
    peerOutputPreviewStates: [],
    peerOutputPreviewMs: 0,
    peerOutputPreviewFrame: 0,
    fixturePatch: patch,
    fixtureSummary: summarizeFixturePatch(patch),
    audioSource: "LINE",
    audioSourceExplicit: false,
    audioFrame: emptyAudioFrame(nowMs),
    peerAudioFrame: null,
    peerEverSeen: false,
    power: createDefaultPowerTelemetry(role === "BRAIN"),
    peerPower: createDefaultPowerTelemetry(false),
    sequence: 0,
    lastUpdateMs: nowMs
  };
}

function factoryLookPatch(state: SimSystemState, look: number): SimSystemState {
  if (look < LOOK_LABELS.length) {
    return {
      ...state,
      activeScene: look,
      activeLook: look,
      colorPresetIndex: 255,
      lookTune: lookTuneDefaults(look)
    };
  }

  return {
    ...state,
    activeLook: look,
    colorPresetIndex: 255,
    lookTune: lookTuneDefaults(look)
  };
}

export function dispatchStateAction(state: SimSystemState, action: SimStateAction): SimSystemState {
  let next: SimSystemState = state;

  switch (action.type) {
    case "SetScene": {
      const scene = clamp(action.value8 ?? 0, 0, 255);
      next = factoryLookPatch(state, scene);
      break;
    }
    case "SetLook": {
      const look = clamp(action.value8 ?? 0, 0, 255);
      next = factoryLookPatch(state, look);
      break;
    }
    case "SetMasterDimmer":
      next = { ...state, masterDimmer: clamp(action.value8 ?? 0, 0, 255) };
      break;
    case "SetAudioReactive":
      next = { ...state, audioReactive: Boolean(action.flag ?? ((action.value8 ?? 0) !== 0)) };
      break;
    case "SetAudioDrive":
      next = { ...state, audioReactivityPercent: clamp(action.value16 ?? action.value8 ?? 0, 0, 100) };
      break;
    case "SetAudioSmoothing":
      next = { ...state, audioSmoothingPercent: clamp(action.value16 ?? action.value8 ?? 0, 0, 100) };
      break;
    case "SetUiState": {
      const uiState = uiStateFromValue(action.value8 ?? 0);
      if (state.uiState === uiState) {
        return state;
      }
      next = { ...state, uiState };
      break;
    }
    case "SetDisplayMirror": {
      const displayMirrorEnabled = Boolean(action.flag ?? ((action.value8 ?? 0) !== 0));
      if (state.displayMirrorEnabled === displayMirrorEnabled) {
        return state;
      }
      next = { ...state, displayMirrorEnabled };
      break;
    }
    case "SetScreenPower": {
      const screenEnabled = Boolean(action.flag ?? ((action.value8 ?? 0) !== 0));
      if (state.screenEnabled === screenEnabled) {
        return state;
      }
      next = { ...state, screenEnabled };
      break;
    }
    case "SetScreenBrightness": {
      const screenBrightness = clamp(action.value8 ?? action.value16 ?? 180, 1, 255);
      if (state.screenBrightness === screenBrightness && state.screenEnabled) {
        return state;
      }
      next = { ...state, screenBrightness, screenEnabled: true };
      break;
    }
    case "SetColorPreset": {
      const preset = action.value8 ?? 255;
      if (preset >= 9) {
        return state;
      }
      next = {
        ...state,
        activeScene: 0,
        activeLook: 0,
        colorPresetIndex: preset,
        lookTune: {
          baseLook: 0,
          speed: 127,
          depth: 255,
          active: false
        },
      };
      break;
    }
    case "SetFrequencyMapEnabled": {
      const frequencyMap = setFrequencyMapEnabled(state.frequencyMap, Boolean(action.flag ?? ((action.value8 ?? 0) !== 0)));
      if (frequencyMap === state.frequencyMap) {
        return state;
      }
      next = { ...state, frequencyMap };
      break;
    }
    case "SetFrequencyMapStyle": {
      const style = action.frequencyMapStyle ?? styleFromValue(action.value8 ?? 0);
      const frequencyMap = setFrequencyMapStyle(state.frequencyMap, style);
      if (frequencyMap === state.frequencyMap) {
        return state;
      }
      next = { ...state, frequencyMap };
      break;
    }
    case "SetFrequencyMapAssignment": {
      const fixtureId = action.value8 ?? 0;
      const packed = action.value16 ?? 0;
      const bandIndex = packed & 0xff;
      const colorPreset = (packed >> 8) & 0xff;
      const frequencyMap = assignFrequencyMapFixture(state.frequencyMap, fixtureId, bandIndex, colorPreset);
      if (frequencyMap === state.frequencyMap) {
        return state;
      }
      next = { ...state, frequencyMap };
      break;
    }
    case "SetFrequencyMapBandMask": {
      const fixtureId = action.value8 ?? 0;
      const frequencyMap = setFrequencyMapFixtureBandMask(state.frequencyMap, fixtureId, action.value16 ?? 0);
      if (frequencyMap === state.frequencyMap) {
        return state;
      }
      next = { ...state, frequencyMap };
      break;
    }
    case "SetFrequencyMapSensitivity": {
      const fixtureId = action.value8 ?? 0;
      const sensitivity = action.value16 ?? action.value8 ?? 100;
      const frequencyMap = setFrequencyMapFixtureSensitivity(state.frequencyMap, fixtureId, sensitivity);
      if (frequencyMap === state.frequencyMap) {
        return state;
      }
      next = { ...state, frequencyMap };
      break;
    }
    case "AutoSpreadFrequencyMap": {
      const frequencyMap = autoSpreadFrequencyMap(state.frequencyMap, state.fixturePatch, true);
      if (frequencyMap === state.frequencyMap) {
        return state;
      }
      next = { ...state, frequencyMap };
      break;
    }
    case "ApplyFrequencyMapPreset": {
      const preset = action.frequencyMapPreset ?? presetFromValue(action.value8 ?? 0);
      const frequencyMap = applyFrequencyMapPreset(state.frequencyMap, state.fixturePatch, preset);
      if (frequencyMap === state.frequencyMap) {
        return state;
      }
      next = { ...state, frequencyMap };
      break;
    }
    case "SetGateTune": {
      const value = clamp(action.value16 ?? action.value8 ?? 0, 0, 100);
      switch (action.value8 ?? 0) {
        case 0:
          next = { ...state, gateTune: { ...state.gateTune, intensityPercent: value } };
          break;
        case 1:
          next = { ...state, gateTune: { ...state.gateTune, flashPercent: value } };
          break;
        case 2:
          next = { ...state, gateTune: { ...state.gateTune, tailPercent: value } };
          break;
        case 3:
          next = { ...state, gateTune: { ...state.gateTune, colorPercent: value } };
          break;
        default:
          return state;
      }
      break;
    }
    case "SetLookTune": {
      const parameter = action.value8 ?? 0;
      if (parameter === 2) {
        next = { ...state, lookTune: lookTuneDefaults(state.activeLook, false) };
        break;
      }

      if (parameter !== 0 && parameter !== 1) {
        return state;
      }

      const value = clamp(action.value16 ?? 0, 0, 255);
      const current = state.lookTune.baseLook === state.activeLook
        ? state.lookTune
        : lookTuneDefaults(state.activeLook, Boolean(action.flag));
      next = {
        ...state,
        lookTune: {
          ...current,
          baseLook: state.activeLook,
          speed: parameter === 0 ? value : current.speed,
          depth: parameter === 1 ? value : current.depth,
          active: Boolean(action.flag)
        }
      };
      break;
    }
    case "ApplyFrequencyMapConfig": {
      if (!action.frequencyMap) {
        return state;
      }
      const frequencyMap = applyPeerFrequencyMap(state.frequencyMap, action.frequencyMap);
      if (frequencyMap === state.frequencyMap) {
        return state;
      }
      next = { ...state, frequencyMap };
      break;
    }
    case "SetBlackout":
      next = { ...state, blackout: Boolean(action.flag) };
      break;
    case "SetFreeze":
      next = { ...state, freeze: Boolean(action.flag) };
      break;
    case "SetLinkStatus": {
      const linkStatus = action.linkStatus ?? linkStatusFromValue(action.value8 ?? 0);
      next = {
        ...state,
        linkStatus,
        peerEverSeen: state.peerEverSeen || linkStatus === "ONLINE",
        audioSource: linkStatus === "ONLINE" && !state.audioSourceExplicit ? "MIC" : state.audioSource
      };
      break;
    }
    case "SetBPM":
      if ((action.value16 ?? 0) > 300) {
        return state;
      }
      if (!state.bpmDetectEnabled) {
        return state;
      }
      next = {
        ...state,
        bpm: clamp(action.value16 ?? 0, 0, 300),
        bpmConfidence: clamp(action.value8 ?? 0, 0, 100)
      };
      break;
    case "SetManualBPM": {
      const bpm = action.value16 ?? 0;
      if (bpm === 0) {
        next = {
          ...state,
          manualBpmActive: false,
          manualBpmUntilMs: 0,
          bpmDetectEnabled: true
        };
        break;
      }
      if (bpm < MANUAL_BPM_MIN || bpm > MANUAL_BPM_MAX) {
        return state;
      }
      const confidence = clamp(action.value8 === undefined || action.value8 === 0 ? 100 : action.value8, 0, 100);
      next = {
        ...state,
        bpm,
        bpmConfidence: confidence,
        manualBpmActive: true,
        manualBpmUntilMs: 0,
        bpmDetectEnabled: false,
        lastBeatMs: action.timestampMs,
        audioFrame: {
          ...state.audioFrame,
          bpm,
          beatConfidence: confidence,
          tempoLocked: true
        }
      };
      break;
    }
    case "SetBPMDetectEnabled": {
      const bpmDetectEnabled = Boolean(action.flag ?? ((action.value8 ?? 0) !== 0));
      next = {
        ...state,
        bpmDetectEnabled,
        manualBpmActive: bpmDetectEnabled ? false : state.manualBpmActive,
        manualBpmUntilMs: bpmDetectEnabled ? 0 : state.manualBpmUntilMs
      };
      break;
    }
    case "SetOutputStatus": {
      const requestedStatus = action.outputStatus ?? outputStatusFromValue(action.value8 ?? 0);
      next = {
        ...state,
        dmxStatus: state.role === "BRAIN" ? "NoPhysicalOutput" : requestedStatus
      };
      break;
    }
    case "SetPhysicalOutputRequested":
      next = { ...state, physicalOutputRequested: Boolean(action.flag ?? ((action.value8 ?? 0) !== 0)) };
      break;
    case "SetPeerOutputStatus":
      next = { ...state, peerOutputStatus: action.outputStatus ?? outputStatusFromValue(action.value8 ?? 0) };
      break;
    case "SetPeerPhysicalOutputRequested":
      next = { ...state, peerPhysicalOutputRequested: Boolean(action.flag ?? ((action.value8 ?? 0) !== 0)) };
      break;
    case "ConfigureFixturePatch": {
      const profileId = action.value8 === 2 ? "rgbw8" : "rgb7";
      const fixtureCount = action.value16 === undefined || action.value16 === 0
        ? state.fixtureSummary.fixtureCount
        : action.value16;
      const patch = buildUniformFixturePatch(profileId, fixtureCount, state.fixturePatch.universeId);
      next = {
        ...state,
        fixturePatch: patch,
        fixtureSummary: summarizeFixturePatch(patch),
        frequencyMap: autoSpreadFrequencyMap(state.frequencyMap, patch, true)
      };
      break;
    }
    case "SetAudioFrame": {
      const frame = action.audioFrame;
      if (!frame) {
        return state;
      }
      const manualActive = manualBpmIsActive(state, action.timestampMs);
      const normalized = normalizeAudioFrame(frame, action.timestampMs);
      const audioFrame = manualActive
        ? {
            ...normalized,
            bpm: state.bpm,
            beatConfidence: state.bpmConfidence,
            tempoLocked: true
          }
        : state.bpmDetectEnabled
          ? normalized
          : {
              ...normalized,
              bpm: state.bpm,
              beatConfidence: state.bpmConfidence,
              tempoLocked: false
            };
      next = {
        ...state,
        audioFrame,
        bpm: state.bpmDetectEnabled && !manualActive ? clamp(frame.bpm, 0, 300) : state.bpm,
        bpmConfidence: state.bpmDetectEnabled && !manualActive ? clamp(frame.beatConfidence, 0, 100) : state.bpmConfidence,
        manualBpmActive: manualActive,
        lastBeatMs: frame.beatHit ? action.timestampMs : state.lastBeatMs
      };
      break;
    }
    case "SetAudioSource":
      next = {
        ...state,
        audioSource: action.audioSource ?? state.audioSource,
        audioSourceExplicit: true
      };
      break;
    case "SetPeerAudioSource": {
      const peerExplicit = Boolean(action.flag);
      const peerSource = action.audioSource ?? state.audioSource;
      if (state.audioSourceExplicit && !peerExplicit) {
        break;
      }
      next = {
        ...state,
        audioSource: !peerExplicit && state.linkStatus === "ONLINE" ? "MIC" : peerSource,
        audioSourceExplicit: peerExplicit
      };
      break;
    }
    case "ReportError":
      next = { ...state, dmxStatus: "Fault" };
      break;
  }

  return markUpdated(next, action.timestampMs);
}

export function stateActionFromEvent(event: SimEvent): SimStateAction | null {
  switch (event.type) {
    case "SceneChanged":
      return { type: "SetScene", timestampMs: event.timestampMs, value8: event.value8 ?? 0 };
    case "LookChanged":
      return { type: "SetLook", timestampMs: event.timestampMs, value8: event.value8 ?? 0 };
    case "MasterDimmerChanged":
      return { type: "SetMasterDimmer", timestampMs: event.timestampMs, value8: event.value8 ?? 0 };
    case "AudioReactiveChanged":
      return {
        type: "SetAudioReactive",
        timestampMs: event.timestampMs,
        flag: Boolean(event.flag ?? ((event.value8 ?? 0) !== 0))
      };
    case "AudioDriveChanged":
      return { type: "SetAudioDrive", timestampMs: event.timestampMs, value16: event.value16 ?? event.value8 ?? 0 };
    case "AudioSmoothingChanged":
      return { type: "SetAudioSmoothing", timestampMs: event.timestampMs, value16: event.value16 ?? event.value8 ?? 0 };
    case "UiStateChanged":
      return { type: "SetUiState", timestampMs: event.timestampMs, value8: event.value8 ?? 0 };
    case "DisplayMirrorChanged":
      return {
        type: "SetDisplayMirror",
        timestampMs: event.timestampMs,
        flag: Boolean(event.flag ?? ((event.value8 ?? 0) !== 0))
      };
    case "ScreenPowerChanged":
      return {
        type: "SetScreenPower",
        timestampMs: event.timestampMs,
        flag: Boolean(event.flag ?? ((event.value8 ?? 0) !== 0))
      };
    case "ScreenBrightnessChanged":
      return {
        type: "SetScreenBrightness",
        timestampMs: event.timestampMs,
        value8: event.value8 ?? 180,
        value16: event.value16 ?? event.value8 ?? 180
      };
    case "ColorPresetChanged":
      return { type: "SetColorPreset", timestampMs: event.timestampMs, value8: event.value8 ?? 0 };
    case "FrequencyMapEnabledChanged":
      return {
        type: "SetFrequencyMapEnabled",
        timestampMs: event.timestampMs,
        flag: Boolean(event.flag ?? ((event.value8 ?? 0) !== 0))
      };
    case "FrequencyMapStyleChanged":
      return { type: "SetFrequencyMapStyle", timestampMs: event.timestampMs, value8: event.value8 ?? 0 };
    case "FrequencyMapAssignmentChanged":
      return { type: "SetFrequencyMapAssignment", timestampMs: event.timestampMs, value8: event.value8 ?? 0, value16: event.value16 ?? 0 };
    case "FrequencyMapBandMaskChanged":
      return { type: "SetFrequencyMapBandMask", timestampMs: event.timestampMs, value8: event.value8 ?? 0, value16: event.value16 ?? 0 };
    case "FrequencyMapSensitivityChanged":
      return { type: "SetFrequencyMapSensitivity", timestampMs: event.timestampMs, value8: event.value8 ?? 0, value16: event.value16 ?? 100 };
    case "FrequencyMapAutoSpreadRequested":
      return { type: "AutoSpreadFrequencyMap", timestampMs: event.timestampMs };
    case "FrequencyMapPresetRequested":
      return { type: "ApplyFrequencyMapPreset", timestampMs: event.timestampMs, value8: event.value8 ?? 0 };
    case "GateTuneChanged":
      return { type: "SetGateTune", timestampMs: event.timestampMs, value8: event.value8 ?? 0, value16: event.value16 ?? 0 };
    case "LookTuneChanged":
      return {
        type: "SetLookTune",
        timestampMs: event.timestampMs,
        value8: event.value8 ?? 0,
        value16: event.value16 ?? 0,
        flag: Boolean(event.flag)
      };
    case "AudioSourceChanged":
      return {
        type: "SetAudioSource",
        timestampMs: event.timestampMs,
        audioSource: (event.value8 ?? 0) === 1 ? "LINE" : "MIC"
      };
    case "BlackoutEnabled":
      return { type: "SetBlackout", timestampMs: event.timestampMs, flag: true };
    case "BlackoutDisabled":
      return { type: "SetBlackout", timestampMs: event.timestampMs, flag: false };
    case "FreezeEnabled":
      return { type: "SetFreeze", timestampMs: event.timestampMs, flag: true };
    case "FreezeDisabled":
      return { type: "SetFreeze", timestampMs: event.timestampMs, flag: false };
    case "LinkLost":
      return { type: "SetLinkStatus", timestampMs: event.timestampMs, linkStatus: "LOST" };
    case "LinkRestored":
      return { type: "SetLinkStatus", timestampMs: event.timestampMs, linkStatus: "ONLINE" };
    case "BPMUpdated":
      return { type: "SetBPM", timestampMs: event.timestampMs, value16: event.value16 ?? 0, value8: event.value8 ?? 0 };
    case "ManualBPMChanged":
      return { type: "SetManualBPM", timestampMs: event.timestampMs, value16: event.value16 ?? 0, value8: event.value8 ?? 0 };
    case "BPMDetectChanged":
      return {
        type: "SetBPMDetectEnabled",
        timestampMs: event.timestampMs,
        flag: Boolean(event.flag ?? ((event.value8 ?? 0) !== 0))
      };
    case "AudioFeaturesUpdated":
      return null;
    case "FixtureUpdated":
      return { type: "ConfigureFixturePatch", timestampMs: event.timestampMs, value8: event.value8, value16: event.value16 };
    case "PhysicalOutputEnabledChanged":
      return {
        type: "SetPhysicalOutputRequested",
        timestampMs: event.timestampMs,
        flag: Boolean(event.flag ?? ((event.value8 ?? 0) !== 0))
      };
    case "OutputEnabled":
      return { type: "SetPhysicalOutputRequested", timestampMs: event.timestampMs, flag: true };
    case "OutputDisabled":
      return { type: "SetPhysicalOutputRequested", timestampMs: event.timestampMs, flag: false };
    case "ErrorReported":
      return { type: "ReportError", timestampMs: event.timestampMs };
    case "UniverseUpdated":
      return null;
  }
}

export function eventValue(type: SimEventType, timestampMs: number, value: number): SimEvent {
  return {
    type,
    timestampMs,
    value16: clamp(value, 0, 65_535),
    value8: clamp(value, 0, 255)
  };
}

export function setAudioSourceAction(source: AudioSource, timestampMs: number): SimStateAction {
  return {
    type: "SetAudioSource",
    timestampMs,
    audioSource: source
  };
}

export function setPeerAudioSourceAction(source: AudioSource, explicit: boolean, timestampMs: number): SimStateAction {
  return {
    type: "SetPeerAudioSource",
    timestampMs,
    audioSource: source,
    flag: explicit
  };
}

export function setAudioDriveAction(percent: number, timestampMs: number): SimStateAction {
  return {
    type: "SetAudioDrive",
    timestampMs,
    value16: clamp(percent, 0, 100)
  };
}

export function setAudioSmoothingAction(percent: number, timestampMs: number): SimStateAction {
  return {
    type: "SetAudioSmoothing",
    timestampMs,
    value16: clamp(percent, 0, 100)
  };
}

export function setLinkStatusAction(status: LinkStatus, timestampMs: number): SimStateAction {
  return {
    type: "SetLinkStatus",
    timestampMs,
    linkStatus: status
  };
}

export function setOutputStatusAction(status: OutputStatus, timestampMs: number): SimStateAction {
  return {
    type: "SetOutputStatus",
    timestampMs,
    outputStatus: status
  };
}

export function setPhysicalOutputRequestedAction(enabled: boolean, timestampMs: number): SimStateAction {
  return {
    type: "SetPhysicalOutputRequested",
    timestampMs,
    flag: enabled
  };
}

export function setPeerOutputStatusAction(status: OutputStatus, timestampMs: number): SimStateAction {
  return {
    type: "SetPeerOutputStatus",
    timestampMs,
    outputStatus: status
  };
}

export function setPeerPhysicalOutputRequestedAction(enabled: boolean, timestampMs: number): SimStateAction {
  return {
    type: "SetPeerPhysicalOutputRequested",
    timestampMs,
    flag: enabled
  };
}

export function setAudioFrameAction(frame: SimAudioFrame, timestampMs: number): SimStateAction {
  return {
    type: "SetAudioFrame",
    timestampMs,
    audioFrame: frame
  };
}

export function applyFrequencyMapConfigAction(frequencyMap: SimFrequencyMap, timestampMs: number): SimStateAction {
  return {
    type: "ApplyFrequencyMapConfig",
    timestampMs,
    frequencyMap
  };
}

function markUpdated(state: SimSystemState, nowMs: number): SimSystemState {
  return {
    ...state,
    sequence: state.sequence + 1,
    lastUpdateMs: nowMs
  };
}

function normalizeAudioFrame(frame: SimAudioFrame, timestampMs: number): SimAudioFrame {
  return {
    ...frame,
    timestampMs,
    rms: clamp(frame.rms, 0, 100),
    peak: clamp(frame.peak, 0, 100),
    beatConfidence: clamp(frame.beatConfidence, 0, 100),
    bpm: clamp(frame.bpm, 0, 300),
    tempoLocked: Boolean(frame.tempoLocked),
    kickEnergy: clamp(frame.kickEnergy, 0, 100),
    snareEnergy: clamp(frame.snareEnergy, 0, 100),
    hatEnergy: clamp(frame.hatEnergy, 0, 100),
    vocalPresence: clamp(frame.vocalPresence, 0, 100),
    vocalPhrase: clamp(frame.vocalPhrase, 0, 100),
    buildEnergy: clamp(frame.buildEnergy, 0, 100),
    intensityEnergy: clamp(frame.intensityEnergy, 0, 100),
    breakdownEnergy: clamp(frame.breakdownEnergy, 0, 100),
    buildSlope: clamp(frame.buildSlope, 0, 100),
    tensionEnergy: clamp(frame.tensionEnergy, 0, 100),
    sectionChange: Boolean(frame.sectionChange),
    releaseHit: Boolean(frame.releaseHit),
    dropHit: Boolean(frame.dropHit),
    analysisUs: clamp(frame.analysisUs, 0, 65_535),
    spectrum: Array.from({ length: SPECTRUM_BAND_COUNT }, (_, index) => clamp(frame.spectrum[index] ?? 0, 0, 100))
  };
}

export function manualBpmIsActive(state: SimSystemState, nowMs: number): boolean {
  void nowMs;
  return state.manualBpmActive;
}

function styleFromValue(value: number) {
  switch (clamp(value, 0, 2)) {
    case 1:
      return "FLASH";
    case 2:
      return "MORPH";
    case 0:
    default:
      return "BRIGHTNESS";
  }
}

function presetFromValue(value: number): FrequencyMapPreset {
  switch (value) {
    case 1:
      return "RHYTHM";
    case 2:
      return "MIRROR";
    case 3:
      return "VOCAL";
    case 4:
      return "SPARKLE";
    default:
      return "SPREAD";
  }
}

function linkStatusFromValue(value: number): LinkStatus {
  return ["UNKNOWN", "OFFLINE", "STALE", "ONLINE", "LOST"][clamp(value, 0, 4)] as LinkStatus;
}

function outputStatusFromValue(value: number): OutputStatus {
  return ["NoPhysicalOutput", "OutputDisabled", "Ready", "Active", "Fault"][clamp(value, 0, 4)] as OutputStatus;
}

function uiStateFromValue(value: number): UIState {
  switch (value) {
    case 0:
      return "BOOT";
    case 1:
      return "ROLE_DETECTION";
    case 2:
      return "LIVE";
    case 3:
      return "COLOR";
    case 4:
      return "AUDIO";
    case 5:
      return "MORE_MENU";
    case 6:
      return "LOOK_CONTROL";
    case 7:
      return "SAVED_LOOKS";
    case 8:
      return "FIXTURE_SETUP";
    case 9:
      return "OUTPUT_STATUS";
    case 10:
      return "DIAGNOSTICS";
    case 11:
      return "NETWORK";
    case 12:
      return "SETTINGS";
    case 13:
      return "BLACKOUT";
    case 14:
      return "FREEZE";
    case 15:
      return "LINK_LOST";
    case 16:
      return "ERROR_SAFE";
    case 17:
      return "SPECTRUM";
    case 18:
      return "LIVE_STATUS";
    case 19:
      return "LIGHT_TUNE";
    case 20:
      return "UPDATE";
    case 21:
      return "AUDIO_DETAIL";
    case 22:
      return "AUDIO_ARRANGEMENT";
    case 23:
      return "SPECTRUM_ASSIGN";
    case 24:
      return "BATTERY_DETAILS";
    case 25:
      return "BPM";
    default:
      return "LIVE";
  }
}
