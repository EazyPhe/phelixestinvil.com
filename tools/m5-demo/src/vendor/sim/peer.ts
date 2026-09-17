import { PEER_AUDIO_INTERVAL_MS, PEER_LOST_MS, PEER_OUTPUT_PREVIEW_INTERVAL_MS, PEER_STALE_MS, clamp } from "./constants";
import type { SimDevice } from "./device";
import { sanitizeFrequencyMap } from "./frequency-map";
import type { AudioSource, DeviceRole, HardwareDeviceRole, SimAudioFrame, SimEvent, SimFixtureRenderState, SimFrequencyMap, SimPeerLink, SimSystemState, UIState } from "./types";

interface QueuedEvent {
  deliverAtMs: number;
  sourceRole: DeviceRole;
  targetRole: HardwareDeviceRole;
  event: SimEvent;
}

interface QueuedAudio {
  deliverAtMs: number;
  targetRole: HardwareDeviceRole;
  frame: SimAudioFrame;
}

interface QueuedFrequencyMap {
  deliverAtMs: number;
  targetRole: HardwareDeviceRole;
  map: SimFrequencyMap;
}

interface QueuedStateSync {
  deliverAtMs: number;
  sourceRole: HardwareDeviceRole;
  targetRole: HardwareDeviceRole;
  state: SimSystemState;
}

interface QueuedOutputPreview {
  deliverAtMs: number;
  targetRole: HardwareDeviceRole;
  frameSequence: number;
  states: SimFixtureRenderState[];
}

const LOCAL_INPUT_AUTHORITY_MS = 2_000;

export class SimPeerRuntime {
  readonly link: SimPeerLink = {
    connected: true,
    latencyMs: 12,
    dropPercent: 0,
    lastSeenBrainMs: 0,
    lastSeenControllerMs: 0,
    lastAudioSendMs: 0,
    lastOutputPreviewSendMs: 0
  };

  private readonly controlQueue: QueuedEvent[] = [];
  private readonly audioQueue: QueuedAudio[] = [];
  private readonly frequencyMapQueue: QueuedFrequencyMap[] = [];
  private readonly stateSyncQueue: QueuedStateSync[] = [];
  private readonly outputPreviewQueue: QueuedOutputPreview[] = [];
  private readonly uiOverrides: Record<HardwareDeviceRole, { active: boolean; state: UIState; timestampMs: number }> = {
    BRAIN: { active: false, state: "LIVE", timestampMs: 0 },
    DMX_CONTROLLER: { active: false, state: "LIVE", timestampMs: 0 }
  };
  private readonly mirrorOverrides: Record<HardwareDeviceRole, { active: boolean; enabled: boolean; timestampMs: number }> = {
    BRAIN: { active: false, enabled: true, timestampMs: 0 },
    DMX_CONTROLLER: { active: false, enabled: true, timestampMs: 0 }
  };

  constructor(
    private readonly brain: SimDevice,
    private readonly controller: SimDevice
  ) {
  }

  setConnected(connected: boolean, nowMs: number): void {
    this.link.connected = connected;
    if (connected) {
      this.markSeen(nowMs);
      this.brain.setLinkStatus("ONLINE", nowMs);
      this.controller.setLinkStatus("ONLINE", nowMs);
    }
  }

  setLatency(latencyMs: number): void {
    this.link.latencyMs = clamp(latencyMs, 0, 2_000);
  }

  setDropPercent(dropPercent: number): void {
    this.link.dropPercent = clamp(dropPercent, 0, 100);
  }

  sendControl(sourceRole: HardwareDeviceRole, event: SimEvent, nowMs: number, localInput = true): void {
    if (localInput) {
      this.noteLocalOverride(sourceRole, event, nowMs);
    }
    if (!this.link.connected || this.shouldDrop()) {
      return;
    }
    const targetRole = sourceRole === "BRAIN" ? "DMX_CONTROLLER" : "BRAIN";
    if (event.type === "UiStateChanged" || event.type === "DisplayMirrorChanged") {
      return;
    }
    this.controlQueue.push({
      deliverAtMs: nowMs + this.link.latencyMs,
      sourceRole,
      targetRole,
      event: { ...event, timestampMs: event.timestampMs + this.link.latencyMs }
    });
  }

  sendCoordinatorControl(event: SimEvent, nowMs: number): void {
    if (!this.link.connected || this.shouldDrop()) {
      return;
    }
    if (event.type === "UiStateChanged" || event.type === "DisplayMirrorChanged") {
      return;
    }
    for (const targetRole of coordinatorTargetsForEvent(event)) {
      this.controlQueue.push({
        deliverAtMs: nowMs + this.link.latencyMs,
        sourceRole: "REMOTE_NODE",
        targetRole,
        event: { ...event, timestampMs: event.timestampMs + this.link.latencyMs }
      });
    }
  }

  sendFrequencyMapConfig(sourceRole: HardwareDeviceRole, map: SimFrequencyMap, nowMs: number): void {
    if (!this.link.connected || this.shouldDrop()) {
      return;
    }
    const targetRole = sourceRole === "BRAIN" ? "DMX_CONTROLLER" : "BRAIN";
    this.frequencyMapQueue.push({
      deliverAtMs: nowMs + this.link.latencyMs,
      targetRole,
      map: cloneFrequencyMap(map)
    });
  }

  sendStateSync(sourceRole: HardwareDeviceRole, nowMs: number): void {
    if (!this.link.connected || this.shouldDrop()) {
      return;
    }
    const targetRole = sourceRole === "BRAIN" ? "DMX_CONTROLLER" : "BRAIN";
    this.stateSyncQueue.push({
      deliverAtMs: nowMs + this.link.latencyMs,
      sourceRole,
      targetRole,
      state: cloneSystemState(this.device(sourceRole).state)
    });
  }

  sendOutputPreview(sourceRole: HardwareDeviceRole, states: SimFixtureRenderState[], frameSequence: number, nowMs: number): void {
    if (sourceRole !== "DMX_CONTROLLER" ||
        !this.link.connected ||
        (this.link.lastOutputPreviewSendMs !== 0 &&
          nowMs - this.link.lastOutputPreviewSendMs < PEER_OUTPUT_PREVIEW_INTERVAL_MS) ||
        this.shouldDrop()) {
      return;
    }
    this.link.lastOutputPreviewSendMs = nowMs;
    this.outputPreviewQueue.push({
      deliverAtMs: nowMs + this.link.latencyMs,
      targetRole: "BRAIN",
      frameSequence,
      states: states.slice(0, 8).map((state) => ({ ...state }))
    });
  }

  tick(nowMs: number, audioSource: AudioSource): boolean {
    const controlDelivered = this.deliverControl(nowMs);
    const stateSyncDelivered = this.deliverStateSyncs(nowMs);
    const frequencyMapDelivered = this.deliverFrequencyMaps(nowMs);
    this.deliverOutputPreviews(nowMs);
    this.queueAudioTelemetry(nowMs, audioSource);
    this.deliverAudio(nowMs);
    this.updateLinkStates(nowMs);
    return controlDelivered || stateSyncDelivered || frequencyMapDelivered;
  }

  private queueAudioTelemetry(nowMs: number, audioSource: AudioSource): void {
    if (!this.link.connected || nowMs - this.link.lastAudioSendMs < PEER_AUDIO_INTERVAL_MS || this.shouldDrop()) {
      return;
    }
    this.link.lastAudioSendMs = nowMs;
    const authority = audioSource === "LINE" ? this.brain : this.controller;
    const target = audioSource === "LINE" ? this.controller : this.brain;
    const frame = authority.state.audioFrame;
    this.audioQueue.push({
      deliverAtMs: nowMs + this.link.latencyMs,
      targetRole: target.role,
      frame: { ...frame, source: audioSource, timestampMs: nowMs }
    });
  }

  private deliverControl(nowMs: number): boolean {
    let delivered = false;
    for (let index = 0; index < this.controlQueue.length;) {
      const item = this.controlQueue[index];
      if (item.deliverAtMs > nowMs) {
        index += 1;
        continue;
      }
      const target = this.device(item.targetRole);
      if (this.shouldDeliverControl(item, target)) {
        if (item.event.type === "PhysicalOutputEnabledChanged" && target.role === "DMX_CONTROLLER") {
          target.setOutputEnabled(Boolean(item.event.flag ?? ((item.event.value8 ?? 0) !== 0)), item.deliverAtMs);
        } else {
          target.handleEvent(item.event);
        }
        delivered = true;
      }
      this.markSeen(nowMs);
      this.controlQueue.splice(index, 1);
    }
    return delivered;
  }

  private deliverAudio(nowMs: number): void {
    for (let index = this.audioQueue.length - 1; index >= 0; index -= 1) {
      const item = this.audioQueue[index];
      if (item.deliverAtMs > nowMs) {
        continue;
      }
      this.device(item.targetRole).setPeerAudioFrame(item.frame, nowMs);
      this.markSeen(nowMs);
      this.audioQueue.splice(index, 1);
    }
  }

  private deliverFrequencyMaps(nowMs: number): boolean {
    let delivered = false;
    for (let index = 0; index < this.frequencyMapQueue.length;) {
      const item = this.frequencyMapQueue[index];
      if (item.deliverAtMs > nowMs) {
        index += 1;
        continue;
      }
      this.device(item.targetRole).applyFrequencyMapConfig(item.map, nowMs);
      delivered = true;
      this.markSeen(nowMs);
      this.frequencyMapQueue.splice(index, 1);
    }
    return delivered;
  }

  private deliverStateSyncs(nowMs: number): boolean {
    let delivered = false;
    for (let index = 0; index < this.stateSyncQueue.length;) {
      const item = this.stateSyncQueue[index];
      if (item.deliverAtMs > nowMs) {
        index += 1;
        continue;
      }
      this.applyStateSync(item, nowMs);
      delivered = true;
      this.markSeen(nowMs);
      this.stateSyncQueue.splice(index, 1);
    }
    return delivered;
  }

  private applyStateSync(item: QueuedStateSync, nowMs: number): void {
    const target = this.device(item.targetRole);
    if (item.sourceRole === "DMX_CONTROLLER") {
      target.state = {
        ...target.state,
        masterDimmer: item.state.masterDimmer,
        activeScene: item.state.activeScene,
        activeLook: item.state.activeLook,
        audioReactive: item.state.audioReactive,
        blackout: item.state.blackout,
        freeze: item.state.freeze,
        colorPresetIndex: item.state.colorPresetIndex,
        gateTune: { ...item.state.gateTune },
        lookTune: { ...item.state.lookTune },
        sequence: target.state.sequence + 1,
        lastUpdateMs: nowMs
      };
      return;
    }

    if (item.sourceRole === "BRAIN") {
      target.setPeerAudioSource(item.state.audioSource, item.state.audioSourceExplicit, nowMs);
      target.setAudioDrive(item.state.audioReactivityPercent, nowMs);
      target.setAudioSmoothing(item.state.audioSmoothingPercent, nowMs);
    }
  }

  private deliverOutputPreviews(nowMs: number): void {
    for (let index = 0; index < this.outputPreviewQueue.length;) {
      const item = this.outputPreviewQueue[index];
      if (item.deliverAtMs > nowMs) {
        index += 1;
        continue;
      }
      this.device(item.targetRole).setPeerOutputPreview(item.states, item.frameSequence, nowMs);
      this.markSeen(nowMs);
      this.outputPreviewQueue.splice(index, 1);
    }
  }

  private updateLinkStates(nowMs: number): void {
    if (this.link.connected) {
      this.markSeen(nowMs);
      this.syncPowerTelemetry(nowMs);
      this.brain.setLinkStatus("ONLINE", nowMs);
      this.controller.setLinkStatus("ONLINE", nowMs);
      return;
    }

    const brainAge = nowMs - this.link.lastSeenBrainMs;
    const controllerAge = nowMs - this.link.lastSeenControllerMs;
    this.brain.setLinkStatus(statusForAge(brainAge, this.brain.state.peerEverSeen), nowMs);
    this.controller.setLinkStatus(statusForAge(controllerAge, this.controller.state.peerEverSeen), nowMs);
  }

  private syncPowerTelemetry(nowMs: number): void {
    const brainPower = { ...this.brain.state.power };
    const controllerPower = { ...this.controller.state.power };
    this.brain.state = {
      ...this.brain.state,
      peerPower: controllerPower,
      peerEverSeen: true,
      lastUpdateMs: nowMs
    };
    this.controller.state = {
      ...this.controller.state,
      peerPower: brainPower,
      peerEverSeen: true,
      lastUpdateMs: nowMs
    };
  }

  private markSeen(nowMs: number): void {
    this.link.lastSeenBrainMs = nowMs;
    this.link.lastSeenControllerMs = nowMs;
  }

  private noteLocalOverride(role: HardwareDeviceRole, event: SimEvent, nowMs: number): void {
    const state = this.device(role).state;
    if (event.type === "UiStateChanged") {
      const requestedState = uiStateFromValue(event.value8 ?? 2);
      if (state.uiState !== requestedState || state.lastUpdateMs !== nowMs) {
        return;
      }
      this.uiOverrides[role] = {
        active: true,
        state: requestedState,
        timestampMs: nowMs
      };
    } else if (event.type === "DisplayMirrorChanged") {
      const requestedMirrorEnabled = mirrorEnabledFromEvent(event);
      if (state.displayMirrorEnabled !== requestedMirrorEnabled || state.lastUpdateMs !== nowMs) {
        return;
      }
      this.mirrorOverrides[role] = {
        active: true,
        enabled: requestedMirrorEnabled,
        timestampMs: nowMs
      };
    }
  }

  private shouldDeliverControl(item: QueuedEvent, target: SimDevice): boolean {
    if (item.event.type === "DisplayMirrorChanged") {
      return this.acceptPeerMirror(item.targetRole, mirrorEnabledFromEvent(item.event), item.deliverAtMs);
    }

    if (item.event.type === "UiStateChanged") {
      if (item.sourceRole === "REMOTE_NODE") {
        return false;
      }
      const source = this.device(item.sourceRole);
      return source.state.displayMirrorEnabled &&
        target.state.displayMirrorEnabled &&
        this.acceptPeerUiState(item.targetRole, uiStateFromValue(item.event.value8 ?? 2), item.deliverAtMs);
    }

    return true;
  }

  private acceptPeerMirror(role: HardwareDeviceRole, enabled: boolean, nowMs: number): boolean {
    const override = this.mirrorOverrides[role];
    if (!override.active) {
      return true;
    }
    if (nowMs - override.timestampMs >= LOCAL_INPUT_AUTHORITY_MS) {
      override.active = false;
      return true;
    }
    if (override.enabled === enabled) {
      override.active = false;
      return true;
    }
    return false;
  }

  private acceptPeerUiState(role: HardwareDeviceRole, state: UIState, nowMs: number): boolean {
    const override = this.uiOverrides[role];
    if (!override.active) {
      return true;
    }
    if (nowMs - override.timestampMs >= LOCAL_INPUT_AUTHORITY_MS) {
      override.active = false;
      return true;
    }
    if (override.state === state) {
      override.active = false;
      return true;
    }
    return false;
  }

  private shouldDrop(): boolean {
    return this.link.dropPercent > 0 && Math.random() * 100 < this.link.dropPercent;
  }

  private device(role: HardwareDeviceRole): SimDevice {
    return role === "BRAIN" ? this.brain : this.controller;
  }
}

function coordinatorTargetsForEvent(event: SimEvent): HardwareDeviceRole[] {
  if (event.type === "PhysicalOutputEnabledChanged" ||
      event.type === "OutputEnabled" ||
      event.type === "OutputDisabled") {
    return ["DMX_CONTROLLER"];
  }
  return ["DMX_CONTROLLER", "BRAIN"];
}

function cloneFrequencyMap(map: SimFrequencyMap): SimFrequencyMap {
  const sanitized = sanitizeFrequencyMap(map);
  return {
    ...sanitized,
    bandByFixture: [...sanitized.bandByFixture],
    bandMaskByFixture: [...sanitized.bandMaskByFixture],
    colorPresetByFixture: [...sanitized.colorPresetByFixture],
    sensitivityByFixture: [...sanitized.sensitivityByFixture]
  };
}

function cloneSystemState(state: SimSystemState): SimSystemState {
  return {
    ...state,
    frequencyMap: cloneFrequencyMap(state.frequencyMap),
    peerOutputPreviewStates: state.peerOutputPreviewStates.map((preview) => ({ ...preview })),
    fixturePatch: {
      ...state.fixturePatch,
      fixtures: state.fixturePatch.fixtures.map((fixture) => ({ ...fixture })),
      groups: state.fixturePatch.groups.map((group) => ({ ...group }))
    },
    fixtureSummary: { ...state.fixtureSummary },
    gateTune: { ...state.gateTune },
    lookTune: { ...state.lookTune },
    audioFrame: { ...state.audioFrame, spectrum: [...state.audioFrame.spectrum] },
    peerAudioFrame: state.peerAudioFrame ? { ...state.peerAudioFrame, spectrum: [...state.peerAudioFrame.spectrum] } : null
  };
}

function statusForAge(ageMs: number, peerEverSeen: boolean): "OFFLINE" | "STALE" | "ONLINE" | "LOST" {
  if (!peerEverSeen) {
    return "OFFLINE";
  }
  if (ageMs >= PEER_LOST_MS) {
    return "LOST";
  }
  if (ageMs >= PEER_STALE_MS) {
    return "STALE";
  }
  return "ONLINE";
}

function mirrorEnabledFromEvent(event: SimEvent): boolean {
  return Boolean(event.flag ?? ((event.value8 ?? 0) !== 0));
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
