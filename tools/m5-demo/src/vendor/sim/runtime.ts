import { DMX_FRAME_INTERVAL_MS, emptyAudioFrame } from "./constants";
import { evaluateSafety } from "./safety";
import { SimDevice } from "./device";
import { autoSpreadFrequencyMap } from "./frequency-map";
import { buildUniformFixturePatch, summarizeFixturePatch } from "./fixtures";
import { SimPeerRuntime } from "./peer";
import {
  eventValue,
  setAudioFrameAction,
  setPeerOutputStatusAction,
  setPeerPhysicalOutputRequestedAction,
  setPhysicalOutputRequestedAction,
  setOutputStatusAction
} from "./state";
import type {
  AudioSource,
  CoordinatorPage,
  FixtureProfileId,
  HardwareDeviceRole,
  ScenarioContext,
  ScenarioDefinition,
  SimAudioFrame,
  SimDmxTransportTelemetry,
  SimEvent,
  SimFixturePatch,
  SimRemoteCoordinatorState,
  UIState
} from "./types";

type RuntimeListener = () => void;

const TAP_TEMPO_MIN_BPM = 70;
const TAP_TEMPO_MAX_BPM = 180;
const TAP_TEMPO_MIN_INTERVAL_MS = 250;
const TAP_TEMPO_MAX_INTERVAL_MS = 2_000;
const TAP_TEMPO_RESET_MS = 2_500;

export class SimulatorRuntime {
  readonly brain = new SimDevice("BRAIN", 0);
  readonly controller = new SimDevice("DMX_CONTROLLER", 0);
  readonly peer = new SimPeerRuntime(this.brain, this.controller);
  coordinator: SimRemoteCoordinatorState = createInitialCoordinatorState(0);

  audioSource: AudioSource = "LINE";
  nowMs = 0;

  private readonly listeners = new Set<RuntimeListener>();
  private readonly tapTempo: Record<HardwareDeviceRole, { lastMs: number; bpm: number; count: number }> = {
    BRAIN: { lastMs: 0, bpm: 0, count: 0 },
    DMX_CONTROLLER: { lastMs: 0, bpm: 0, count: 0 }
  };
  private rafId = 0;
  private lastTickStamp = 0;

  start(): void {
    if (this.rafId !== 0) {
      return;
    }
    const step = (stamp: number): void => {
      if (this.lastTickStamp === 0) {
        this.lastTickStamp = stamp;
      }
      const delta = Math.min(100, stamp - this.lastTickStamp);
      this.lastTickStamp = stamp;
      this.tick(this.nowMs + delta);
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.rafId !== 0) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  tick(nowMs: number): void {
    this.nowMs = nowMs;
    const previousBrainLink = this.brain.state.linkStatus;
    const previousControllerLink = this.controller.state.linkStatus;
    this.updateBatteryRunTimer(this.brain, nowMs);
    this.updateBatteryRunTimer(this.controller, nowMs);
    const peerDeliveredState = this.peer.tick(nowMs, this.audioSource);
    this.updateCoordinatorStatus(nowMs);
    if (peerDeliveredState) {
      this.refreshUniverses();
    }
    const brainPeerAge = this.peerAgeForDevice("BRAIN", nowMs);
    const controllerPeerAge = this.peerAgeForDevice("DMX_CONTROLLER", nowMs);
    this.brain.tick(nowMs, brainPeerAge);
    const controllerRendered = this.controller.tick(nowMs, controllerPeerAge);
    if (controllerRendered) {
      this.peer.sendOutputPreview("DMX_CONTROLLER", this.controller.universe.fixtureStates, this.controller.universe.frameCount, nowMs);
    }
    if (peerDeliveredState || this.brain.state.linkStatus !== previousBrainLink || this.controller.state.linkStatus !== previousControllerLink) {
      this.emit();
    }
  }

  dispatch(role: HardwareDeviceRole, event: SimEvent): void {
    const source = this.device(role);
    source.handleEvent(event);
    if (isFrequencyMapEvent(event)) {
      this.peer.sendFrequencyMapConfig(role, source.state.frequencyMap, this.nowMs);
    } else {
      this.peer.sendControl(role, event, this.nowMs);
    }

    if (event.type === "DisplayMirrorChanged" && (event.flag || (event.value8 ?? 0) !== 0)) {
      this.peer.sendControl(role, eventValue("UiStateChanged", event.timestampMs, uiStateValue(source.state.uiState)), this.nowMs);
    }

    if (event.type === "SceneChanged") {
      const lookEvent = eventValue("LookChanged", event.timestampMs, event.value8 ?? 0);
      source.handleEvent(lookEvent);
      this.peer.sendControl(role, lookEvent, this.nowMs);
    }

    this.refreshUniverses();
    this.emit();
  }

  setMaster(role: HardwareDeviceRole, percent: number): void {
    const value = Math.max(0, Math.min(255, Math.round(percent * 2.55)));
    this.dispatch(role, eventValue("MasterDimmerChanged", this.nowMs, value));
  }

  dispatchCoordinator(event: SimEvent): void {
    if (event.type === "AudioSourceChanged") {
      this.audioSource = (event.value8 ?? 0) === 1 ? "LINE" : "MIC";
      this.coordinator = {
        ...this.coordinator,
        selectedAudioSource: this.audioSource,
        lastUpdateMs: this.nowMs
      };
    } else {
      this.coordinator = {
        ...this.coordinator,
        lastUpdateMs: this.nowMs
      };
    }

    this.peer.sendCoordinatorControl(event, this.nowMs);
    if (event.type === "SceneChanged") {
      this.peer.sendCoordinatorControl(eventValue("LookChanged", event.timestampMs, event.value8 ?? 0), this.nowMs);
    }
    this.refreshUniverses();
    this.emit();
  }

  setCoordinatorPage(page: CoordinatorPage): void {
    if (this.coordinator.page === page) {
      return;
    }
    this.coordinator = {
      ...this.coordinator,
      page,
      lastUpdateMs: this.nowMs
    };
    this.emit();
  }

  setCoordinatorMaster(percent: number): void {
    const value8 = Math.max(0, Math.min(255, Math.round(percent * 2.55)));
    this.dispatchCoordinator(eventValue("MasterDimmerChanged", this.nowMs, value8));
  }

  setCoordinatorOutputEnabled(enabled: boolean): void {
    this.dispatchCoordinator(eventValue("PhysicalOutputEnabledChanged", this.nowMs, enabled ? 1 : 0));
  }

  setAudioSource(source: AudioSource): void {
    this.audioSource = source;
    const sourceValue = source === "LINE" ? 1 : 0;
    this.brain.handleEvent(eventValue("AudioSourceChanged", this.nowMs, sourceValue));
    this.controller.handleEvent(eventValue("AudioSourceChanged", this.nowMs, sourceValue));
    this.refreshUniverses();
    this.emit();
  }

  setAudioDrive(percent: number): void {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    this.brain.handleEvent(eventValue("AudioDriveChanged", this.nowMs, value));
    this.controller.handleEvent(eventValue("AudioDriveChanged", this.nowMs, value));
    this.refreshUniverses();
    this.emit();
  }

  setAudioSmoothing(percent: number): void {
    const value = Math.max(0, Math.min(100, Math.round(percent)));
    this.brain.handleEvent(eventValue("AudioSmoothingChanged", this.nowMs, value));
    this.controller.handleEvent(eventValue("AudioSmoothingChanged", this.nowMs, value));
    this.refreshUniverses();
    this.emit();
  }

  prepareTapBpm(role: HardwareDeviceRole): SimEvent | null {
    if (this.device(role).state.uiState !== "BPM") {
      this.dispatch(role, eventValue("UiStateChanged", this.nowMs, uiStateValue("BPM")));
    }

    const tap = this.tapTempo[role];
    if (tap.lastMs === 0 || this.nowMs - tap.lastMs > TAP_TEMPO_RESET_MS) {
      tap.lastMs = this.nowMs;
      tap.bpm = 0;
      tap.count = 1;
      return null;
    }

    const intervalMs = this.nowMs - tap.lastMs;
    tap.lastMs = this.nowMs;
    const instantBpm = normalizeTapTempoBpm(intervalMs);
    if (instantBpm === 0) {
      tap.bpm = 0;
      tap.count = 1;
      return null;
    }

    if (tap.bpm === 0 || tap.count < 2) {
      tap.bpm = instantBpm;
    } else {
      const weight = Math.min(tap.count, 5);
      tap.bpm = Math.round((tap.bpm * weight + instantBpm) / (weight + 1));
    }
    tap.count = Math.min(tap.count + 1, 6);

    const confidence = tap.count >= 4 ? 100 : Math.min(100, 88 + tap.count * 4);
    return {
      type: "ManualBPMChanged",
      timestampMs: this.nowMs,
      value16: tap.bpm,
      value8: confidence,
      flag: true
    };
  }

  tapBpm(role: HardwareDeviceRole): SimEvent | null {
    const event = this.prepareTapBpm(role);
    if (!event) {
      this.emit();
      return null;
    }
    this.dispatch(role, event);
    return event;
  }

  setOutputEnabled(enabled: boolean): void {
    const controllerStatus = enabled ? "Active" : "OutputDisabled";
    this.brain.dispatch(setPhysicalOutputRequestedAction(enabled, this.nowMs));
    this.brain.dispatch(setOutputStatusAction("NoPhysicalOutput", this.nowMs));
    this.brain.dispatch(setPeerPhysicalOutputRequestedAction(enabled, this.nowMs));
    this.brain.dispatch(setPeerOutputStatusAction(controllerStatus, this.nowMs));
    this.controller.dispatch(setPhysicalOutputRequestedAction(enabled, this.nowMs));
    this.controller.dispatch(setOutputStatusAction(controllerStatus, this.nowMs));
    this.refreshUniverses();
    this.emit();
  }

  setScreenRotation(role: HardwareDeviceRole, degrees: 0 | 180): void {
    const device = this.device(role);
    if (device.state.screenRotationDeg === degrees) {
      return;
    }
    device.state = {
      ...device.state,
      screenRotationDeg: degrees,
      sequence: device.state.sequence + 1,
      lastUpdateMs: this.nowMs
    };
    this.emit();
  }

  setLinkConnected(connected: boolean): void {
    this.peer.setConnected(connected, this.nowMs);
    this.emit();
  }

  setLinkLatency(latencyMs: number): void {
    this.peer.setLatency(latencyMs);
    this.emit();
  }

  setDropPercent(dropPercent: number): void {
    this.peer.setDropPercent(dropPercent);
    this.emit();
  }

  configureFixtures(profileId: FixtureProfileId, fixtureCount: number): void {
    const patch = buildUniformFixturePatch(profileId, fixtureCount);
    this.setFixturePatch(patch);
  }

  setFixturePatch(patch: SimFixturePatch): void {
    const summary = summarizeFixturePatch(patch);
    for (const device of [this.brain, this.controller]) {
      device.state = {
        ...device.state,
        fixturePatch: patch,
        fixtureSummary: summary,
        frequencyMap: autoSpreadFrequencyMap(device.state.frequencyMap, patch, true),
        sequence: device.state.sequence + 1,
        lastUpdateMs: this.nowMs
      };
    }
    this.refreshUniverses();
    this.emit();
  }

  dmxTransportTelemetry(): SimDmxTransportTelemetry {
    const outputEnabled = this.controller.state.dmxStatus === "Active";
    return {
      frameIntervalMs: DMX_FRAME_INTERVAL_MS,
      scheduledFrames: this.controller.universe.frameCount,
      transmittedFrames: outputEnabled ? this.controller.universe.frameCount : 0,
      activeSlots: this.controller.universe.length,
      checksum: this.controller.universe.checksum,
      outputEnabled,
      blackout: this.controller.state.blackout,
      freeze: this.controller.state.freeze,
      transportStatus: this.controller.state.dmxStatus === "Fault"
        ? "Fault"
        : outputEnabled
          ? "SimActive"
          : "SimDisabled"
    };
  }

  injectAudio(frame: SimAudioFrame): void {
    const authority = this.audioSource === "LINE" ? this.brain : this.controller;
    const idle = this.audioSource === "LINE" ? this.controller : this.brain;
    authority.dispatch(setAudioFrameAction({ ...frame, source: this.audioSource }, this.nowMs));
    idle.dispatch(setAudioFrameAction({ ...emptyAudioFrame(this.nowMs), source: this.audioSource }, this.nowMs));
    this.refreshUniverses();
    this.emit();
  }

  async runScenario(scenario: ScenarioDefinition, onStep?: (label: string) => void): Promise<void> {
    const context: ScenarioContext = {
      now: () => this.nowMs,
      dispatch: (role, event) => this.dispatch(role, event),
      dispatchCoordinator: (event) => this.dispatchCoordinator(event),
      setCoordinatorPage: (page) => this.setCoordinatorPage(page),
      setLinkConnected: (connected) => this.setLinkConnected(connected),
      setLinkLatency: (latencyMs) => this.setLinkLatency(latencyMs),
      setDropPercent: (dropPercent) => this.setDropPercent(dropPercent),
      setAudioSource: (source) => this.setAudioSource(source),
      setOutputEnabled: (enabled) => this.setOutputEnabled(enabled),
      setScreenRotation: (role, degrees) => this.setScreenRotation(role, degrees),
      configureFixtures: (profileId, fixtureCount) => this.configureFixtures(profileId, fixtureCount),
      setFixturePatch: (patch) => this.setFixturePatch(patch),
      injectAudio: (frame) => this.injectAudio(frame)
    };

    for (const step of scenario.steps) {
      onStep?.(step.label);
      await step.run(context);
      this.tick(this.nowMs + (step.waitMs ?? 180));
      const waitMs = step.waitMs ?? 0;
      if (waitMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, Math.min(waitMs, 500)));
      }
    }
    this.emit();
  }

  private device(role: HardwareDeviceRole): SimDevice {
    return role === "BRAIN" ? this.brain : this.controller;
  }

  private updateBatteryRunTimer(device: SimDevice, nowMs: number): void {
    const power = device.state.power;
    const external = power.externalPower || power.vbusMv >= 4000;
    const nextRunSec = external ? 0 : Math.floor(Math.max(0, nowMs) / 1000);
    if (power.batteryRunSec === nextRunSec) {
      return;
    }

    device.state = {
      ...device.state,
      power: {
        ...power,
        batteryRunSec: nextRunSec
      },
      sequence: device.state.sequence + 1,
      lastUpdateMs: nowMs
    };
  }

  safetyOverlay(role: HardwareDeviceRole) {
    const peerAge = this.peerAgeForDevice(role, this.nowMs);
    const state = role === "BRAIN" ? this.brain.state : this.controller.state;
    return evaluateSafety(state, peerAge).overlay;
  }

  private peerAgeForDevice(role: HardwareDeviceRole, nowMs: number): number {
    if (!this.brain.state.peerEverSeen && !this.controller.state.peerEverSeen) {
      return 0;
    }
    if (this.peer.link.connected) {
      return 0;
    }
    const age = role === "BRAIN"
      ? nowMs - this.peer.link.lastSeenBrainMs
      : nowMs - this.peer.link.lastSeenControllerMs;
    return Math.max(0, age);
  }

  private refreshUniverses(): void {
    this.brain.renderNow(this.nowMs, this.peerAgeForDevice("BRAIN", this.nowMs));
    this.controller.renderNow(this.nowMs, this.peerAgeForDevice("DMX_CONTROLLER", this.nowMs));
    this.peer.sendOutputPreview("DMX_CONTROLLER", this.controller.universe.fixtureStates, this.controller.universe.frameCount, this.nowMs);
  }

  private updateCoordinatorStatus(nowMs: number): void {
    const linkStatus = this.peer.link.connected ? "ONLINE" : this.brain.state.linkStatus === "LOST" || this.controller.state.linkStatus === "LOST" ? "LOST" : "STALE";
    if (this.coordinator.linkStatus === linkStatus && this.coordinator.selectedAudioSource === this.audioSource) {
      return;
    }
    this.coordinator = {
      ...this.coordinator,
      linkStatus,
      selectedAudioSource: this.audioSource,
      lastUpdateMs: nowMs
    };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

function createInitialCoordinatorState(nowMs: number): SimRemoteCoordinatorState {
  return {
    role: "REMOTE_NODE",
    page: "LIVE",
    dmxStatus: "NoPhysicalOutput",
    physicalOutputRequested: false,
    localAudioAuthority: false,
    selectedAudioSource: "LINE",
    linkStatus: "OFFLINE",
    lastUpdateMs: nowMs
  };
}

function uiStateValue(state: UIState): number {
  switch (state) {
    case "BOOT":
      return 0;
    case "ROLE_DETECTION":
      return 1;
    case "LIVE":
      return 2;
    case "COLOR":
      return 3;
    case "AUDIO":
      return 4;
    case "MORE_MENU":
      return 5;
    case "LOOK_CONTROL":
      return 6;
    case "SAVED_LOOKS":
      return 7;
    case "FIXTURE_SETUP":
      return 8;
    case "OUTPUT_STATUS":
      return 9;
    case "DIAGNOSTICS":
      return 10;
    case "NETWORK":
      return 11;
    case "SETTINGS":
      return 12;
    case "SPECTRUM":
      return 17;
    case "LIVE_STATUS":
      return 18;
    case "LIGHT_TUNE":
      return 19;
    case "UPDATE":
      return 20;
    case "AUDIO_DETAIL":
      return 21;
    case "AUDIO_ARRANGEMENT":
      return 22;
    case "SPECTRUM_ASSIGN":
      return 23;
    case "BATTERY_DETAILS":
      return 24;
    case "BPM":
      return 25;
    case "BLACKOUT":
      return 13;
    case "FREEZE":
      return 14;
    case "LINK_LOST":
      return 15;
    case "ERROR_SAFE":
      return 16;
  }
}

function isFrequencyMapEvent(event: SimEvent): boolean {
  return event.type === "FrequencyMapEnabledChanged" ||
    event.type === "FrequencyMapStyleChanged" ||
    event.type === "FrequencyMapAssignmentChanged" ||
    event.type === "FrequencyMapBandMaskChanged" ||
    event.type === "FrequencyMapSensitivityChanged" ||
    event.type === "FrequencyMapAutoSpreadRequested" ||
    event.type === "FrequencyMapPresetRequested";
}

function normalizeTapTempoBpm(intervalMs: number): number {
  if (intervalMs < TAP_TEMPO_MIN_INTERVAL_MS || intervalMs > TAP_TEMPO_MAX_INTERVAL_MS) {
    return 0;
  }

  let bpm = Math.round(60_000 / intervalMs);
  while (bpm < TAP_TEMPO_MIN_BPM) {
    bpm *= 2;
  }
  while (bpm > TAP_TEMPO_MAX_BPM) {
    bpm = Math.round(bpm / 2);
  }
  return bpm >= TAP_TEMPO_MIN_BPM && bpm <= TAP_TEMPO_MAX_BPM ? bpm : 0;
}
