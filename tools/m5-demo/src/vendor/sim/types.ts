export type HardwareDeviceRole = "BRAIN" | "DMX_CONTROLLER";
export type DeviceRole = HardwareDeviceRole | "REMOTE_NODE";
export type CoordinatorPage = "LIVE" | "LOOKS" | "AUDIO" | "NODES" | "PATCH";
export type UIState =
  | "BOOT"
  | "ROLE_DETECTION"
  | "LIVE"
  | "COLOR"
  | "AUDIO"
  | "MORE_MENU"
  | "LOOK_CONTROL"
  | "SAVED_LOOKS"
  | "FIXTURE_SETUP"
  | "OUTPUT_STATUS"
  | "DIAGNOSTICS"
  | "NETWORK"
  | "SETTINGS"
  | "SPECTRUM"
  | "SPECTRUM_ASSIGN"
  | "LIVE_STATUS"
  | "LIGHT_TUNE"
  | "UPDATE"
  | "AUDIO_DETAIL"
  | "AUDIO_ARRANGEMENT"
  | "BATTERY_DETAILS"
  | "BPM"
  | "BLACKOUT"
  | "FREEZE"
  | "LINK_LOST"
  | "ERROR_SAFE";
export type LinkStatus = "UNKNOWN" | "OFFLINE" | "STALE" | "ONLINE" | "LOST";
export type OutputStatus = "NoPhysicalOutput" | "OutputDisabled" | "Ready" | "Active" | "Fault";
export type FixtureProfileId = "unknown" | "rgb7" | "rgbw8";
export type AudioSource = "MIC" | "LINE";
export type AudioInputMode = "none" | "live" | "file" | "demo" | "tone";
export type AudioTestTone = "silence" | "hz60" | "hz125" | "hz1000" | "hz8000" | "sweep" | "kick";
export type RuntimeMode = "simulation" | "live";
export type FrequencyMapReactionStyle = "BRIGHTNESS" | "FLASH" | "MORPH";
export type FrequencyMapPreset = "SPREAD" | "RHYTHM" | "MIRROR" | "VOCAL" | "SPARKLE" | "CUSTOM";

export interface SimAudioFrame {
  frameSeq: number;
  source: AudioSource;
  present: boolean;
  rms: number;
  peak: number;
  beatConfidence: number;
  beatHit: boolean;
  bpm: number;
  tempoLocked: boolean;
  kickEnergy: number;
  snareEnergy: number;
  hatEnergy: number;
  vocalPresence: number;
  vocalPhrase: number;
  buildEnergy: number;
  intensityEnergy: number;
  breakdownEnergy: number;
  buildSlope: number;
  tensionEnergy: number;
  sectionChange: boolean;
  releaseHit: boolean;
  dropHit: boolean;
  analysisUs: number;
  spectrum: number[];
  timestampMs: number;
}

export interface SimFixtureProfileDefinition {
  id: FixtureProfileId;
  key: string;
  name: string;
  channelCount: number;
  defaultValues: number[];
}

export interface SimFixtureDefinition {
  id: number;
  profileId: FixtureProfileId;
  universeId: number;
  startAddress: number;
  groupId: number;
  enabled: boolean;
  name: string;
}

export interface SimFixtureGroupDefinition {
  id: number;
  enabled: boolean;
  fixtureMask: number;
  name: string;
}

export interface SimFixturePatch {
  version: number;
  universeId: number;
  fixtureCount: number;
  groupCount: number;
  fixtures: SimFixtureDefinition[];
  groups: SimFixtureGroupDefinition[];
}

export interface SimFixturePatchSummary {
  universeId: number;
  defaultProfileId: FixtureProfileId;
  fixtureCount: number;
  groupCount: number;
  activeSlots: number;
}

export interface SimFixtureRenderState {
  dimmer: number;
  red: number;
  green: number;
  blue: number;
  white: number;
  strobe: number;
  macro: number;
  speed: number;
  identify: boolean;
}

export interface SimDmxUniverse {
  data: Uint8Array;
  length: number;
  renderedFixtureCount: number;
  checksum: number;
  lastBuildOk: boolean;
  frameCount: number;
  fixtureStates: SimFixtureRenderState[];
}

export interface SimFrequencyMap {
  revision: number;
  enabled: boolean;
  reactionStyle: FrequencyMapReactionStyle;
  preset: FrequencyMapPreset;
  activeFixtureMask: number;
  bandByFixture: number[];
  bandMaskByFixture: number[];
  colorPresetByFixture: number[];
  sensitivityByFixture: number[];
}

export interface SimFrequencyMapStorageRecord {
  version: number;
  revision: number;
  enabled: boolean;
  reactionStyle: FrequencyMapReactionStyle;
  preset: FrequencyMapPreset;
  activeFixtureMask: number;
  bandByFixture: number[];
  bandMaskByFixture?: number[];
  colorPresetByFixture: number[];
  sensitivityByFixture: number[];
}

export interface SimGateTune {
  intensityPercent: number;
  flashPercent: number;
  tailPercent: number;
  colorPercent: number;
}

export interface SimLookTune {
  baseLook: number;
  speed: number;
  depth: number;
  active: boolean;
}

export interface SimPowerTelemetry {
  supported: boolean;
  externalPower: boolean;
  charging: boolean;
  low: boolean;
  critical: boolean;
  percent: number;
  batteryMv: number;
  vbusMv: number;
  batteryRunSec: number;
}

export interface SimDmxTransportTelemetry {
  frameIntervalMs: number;
  scheduledFrames: number;
  transmittedFrames: number;
  activeSlots: number;
  checksum: number;
  outputEnabled: boolean;
  blackout: boolean;
  freeze: boolean;
  transportStatus: "NoPhysicalOutput" | "SimDisabled" | "SimActive" | "Fault";
}

export interface SimSystemState {
  role: DeviceRole;
  blackout: boolean;
  freeze: boolean;
  audioReactive: boolean;
  audioReactivityPercent: number;
  audioSmoothingPercent: number;
  bpm: number;
  bpmConfidence: number;
  lastBeatMs: number;
  manualBpmActive: boolean;
  manualBpmUntilMs: number;
  bpmDetectEnabled: boolean;
  masterDimmer: number;
  activeScene: number;
  activeLook: number;
  colorPresetIndex: number;
  linkStatus: LinkStatus;
  dmxStatus: OutputStatus;
  physicalOutputRequested: boolean;
  peerOutputStatus: OutputStatus;
  peerPhysicalOutputRequested: boolean;
  uiState: UIState;
  displayMirrorEnabled: boolean;
  screenEnabled: boolean;
  screenBrightness: number;
  screenRotationDeg: 0 | 180;
  gateTune: SimGateTune;
  lookTune: SimLookTune;
  frequencyMap: SimFrequencyMap;
  peerOutputPreviewStates: SimFixtureRenderState[];
  peerOutputPreviewMs: number;
  peerOutputPreviewFrame: number;
  fixturePatch: SimFixturePatch;
  fixtureSummary: SimFixturePatchSummary;
  audioSource: AudioSource;
  audioSourceExplicit: boolean;
  audioFrame: SimAudioFrame;
  peerAudioFrame: SimAudioFrame | null;
  peerEverSeen: boolean;
  power: SimPowerTelemetry;
  peerPower: SimPowerTelemetry;
  sequence: number;
  lastUpdateMs: number;
}

export interface SimRemoteCoordinatorState {
  role: "REMOTE_NODE";
  page: CoordinatorPage;
  dmxStatus: "NoPhysicalOutput";
  physicalOutputRequested: false;
  localAudioAuthority: false;
  selectedAudioSource: AudioSource;
  linkStatus: LinkStatus;
  lastUpdateMs: number;
}

export type SimEventType =
  | "SceneChanged"
  | "LookChanged"
  | "MasterDimmerChanged"
  | "AudioReactiveChanged"
  | "AudioDriveChanged"
  | "AudioSmoothingChanged"
  | "UiStateChanged"
  | "DisplayMirrorChanged"
  | "ScreenPowerChanged"
  | "ScreenBrightnessChanged"
  | "ColorPresetChanged"
  | "FrequencyMapEnabledChanged"
  | "FrequencyMapStyleChanged"
  | "FrequencyMapAssignmentChanged"
  | "FrequencyMapBandMaskChanged"
  | "FrequencyMapSensitivityChanged"
  | "FrequencyMapAutoSpreadRequested"
  | "FrequencyMapPresetRequested"
  | "GateTuneChanged"
  | "LookTuneChanged"
  | "AudioSourceChanged"
  | "BlackoutEnabled"
  | "BlackoutDisabled"
  | "FreezeEnabled"
  | "FreezeDisabled"
  | "LinkLost"
  | "LinkRestored"
  | "BPMUpdated"
  | "ManualBPMChanged"
  | "BPMDetectChanged"
  | "AudioFeaturesUpdated"
  | "FixtureUpdated"
  | "UniverseUpdated"
  | "PhysicalOutputEnabledChanged"
  | "OutputEnabled"
  | "OutputDisabled"
  | "ErrorReported";

export interface SimEvent {
  type: SimEventType;
  timestampMs: number;
  sequence?: number;
  value16?: number;
  value8?: number;
  flag?: boolean;
}

export type SimStateActionType =
  | "SetScene"
  | "SetLook"
  | "SetMasterDimmer"
  | "SetAudioReactive"
  | "SetAudioDrive"
  | "SetAudioSmoothing"
  | "SetUiState"
  | "SetDisplayMirror"
  | "SetScreenPower"
  | "SetScreenBrightness"
  | "SetColorPreset"
  | "SetFrequencyMapEnabled"
  | "SetFrequencyMapStyle"
  | "SetFrequencyMapAssignment"
  | "SetFrequencyMapBandMask"
  | "SetFrequencyMapSensitivity"
  | "AutoSpreadFrequencyMap"
  | "ApplyFrequencyMapPreset"
  | "SetGateTune"
  | "SetLookTune"
  | "ApplyFrequencyMapConfig"
  | "SetBlackout"
  | "SetFreeze"
  | "SetLinkStatus"
  | "SetBPM"
  | "SetManualBPM"
  | "SetBPMDetectEnabled"
  | "SetOutputStatus"
  | "SetPhysicalOutputRequested"
  | "SetPeerOutputStatus"
  | "SetPeerPhysicalOutputRequested"
  | "ConfigureFixturePatch"
  | "SetAudioFrame"
  | "SetAudioSource"
  | "SetPeerAudioSource"
  | "ReportError";

export interface SimStateAction {
  type: SimStateActionType;
  timestampMs: number;
  value16?: number;
  value8?: number;
  flag?: boolean;
  audioFrame?: SimAudioFrame;
  audioSource?: AudioSource;
  frequencyMap?: SimFrequencyMap;
  frequencyMapStyle?: FrequencyMapReactionStyle;
  frequencyMapPreset?: FrequencyMapPreset;
  linkStatus?: LinkStatus;
  outputStatus?: OutputStatus;
}

export interface SimPeerLink {
  connected: boolean;
  latencyMs: number;
  dropPercent: number;
  lastSeenBrainMs: number;
  lastSeenControllerMs: number;
  lastAudioSendMs: number;
  lastOutputPreviewSendMs: number;
}

export interface RecorderEntry {
  id: number;
  timestampMs: number;
  label: string;
  replay: (context: ScenarioContext) => void | Promise<void>;
}

export interface ScenarioStep {
  label: string;
  run: (context: ScenarioContext) => void | Promise<void>;
  waitMs?: number;
}

export interface ScenarioDefinition {
  id: string;
  title: string;
  steps: ScenarioStep[];
}

export interface ScenarioContext {
  now: () => number;
  dispatch: (role: HardwareDeviceRole, event: SimEvent) => void;
  dispatchCoordinator: (event: SimEvent) => void;
  setCoordinatorPage: (page: CoordinatorPage) => void;
  setLinkConnected: (connected: boolean) => void;
  setLinkLatency: (latencyMs: number) => void;
  setDropPercent: (dropPercent: number) => void;
  setAudioSource: (source: AudioSource) => void;
  setOutputEnabled: (enabled: boolean) => void;
  setScreenRotation: (role: HardwareDeviceRole, degrees: 0 | 180) => void;
  configureFixtures: (profileId: FixtureProfileId, fixtureCount: number) => void;
  setFixturePatch: (patch: SimFixturePatch) => void;
  injectAudio: (frame: SimAudioFrame) => void;
}
