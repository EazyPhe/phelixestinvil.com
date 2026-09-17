import { buildDmxUniverse, shouldRenderDmx } from "./dmx";
import { PEER_AUDIO_AUTHORITY_MS, clamp, emptyAudioFrame } from "./constants";
import {
  applyFrequencyMapConfigAction,
  createInitialState,
  dispatchStateAction,
  manualBpmIsActive,
  setAudioDriveAction,
  setAudioSmoothingAction,
  setAudioFrameAction,
  setAudioSourceAction,
  setPeerAudioSourceAction,
  setLinkStatusAction,
  setPhysicalOutputRequestedAction,
  setOutputStatusAction,
  stateActionFromEvent
} from "./state";
import type {
  AudioSource,
  HardwareDeviceRole,
  LinkStatus,
  OutputStatus,
  SimAudioFrame,
  SimDmxUniverse,
  SimEvent,
  SimFrequencyMap,
  SimFixtureRenderState,
  SimStateAction,
  SimSystemState
} from "./types";

export class SimDevice {
  readonly role: HardwareDeviceRole;
  state: SimSystemState;
  universe: SimDmxUniverse;

  private frameCount = 0;
  private lastDmxRenderMs = -Infinity;

  constructor(role: HardwareDeviceRole, nowMs = 0) {
    this.role = role;
    this.state = createInitialState(role, nowMs);
    this.universe = buildDmxUniverse(this.state, this.frameCount, nowMs);
  }

  dispatch(action: SimStateAction): void {
    this.state = dispatchStateAction(this.state, action);
  }

  handleEvent(event: SimEvent): void {
    const action = stateActionFromEvent(event);
    if (action) {
      this.dispatch(action);
    }
  }

  setLinkStatus(status: LinkStatus, nowMs: number): void {
    if (this.state.linkStatus === status) {
      return;
    }
    this.dispatch(setLinkStatusAction(status, nowMs));
  }

  setOutputEnabled(enabled: boolean, nowMs: number): void {
    const nextStatus: OutputStatus = this.role === "BRAIN" ? "NoPhysicalOutput" : enabled ? "Active" : "OutputDisabled";
    this.dispatch(setPhysicalOutputRequestedAction(enabled, nowMs));
    this.dispatch(setOutputStatusAction(nextStatus, nowMs));
  }

  setAudioSource(source: AudioSource, nowMs: number): void {
    this.dispatch(setAudioSourceAction(source, nowMs));
  }

  setPeerAudioSource(source: AudioSource, explicit: boolean, nowMs: number): void {
    this.dispatch(setPeerAudioSourceAction(source, explicit, nowMs));
  }

  setAudioDrive(percent: number, nowMs: number): void {
    this.dispatch(setAudioDriveAction(percent, nowMs));
  }

  setAudioSmoothing(percent: number, nowMs: number): void {
    this.dispatch(setAudioSmoothingAction(percent, nowMs));
  }

  setLocalAudioFrame(frame: SimAudioFrame, nowMs: number): void {
    this.dispatch(setAudioFrameAction(frame, nowMs));
  }

  setPeerAudioFrame(frame: SimAudioFrame, nowMs: number): void {
    const manualActive = manualBpmIsActive(this.state, nowMs);
    const allowDetectedBpm = this.state.bpmDetectEnabled && !manualActive;
    const peerAudioFrame = manualActive
      ? { ...frame, timestampMs: nowMs, bpm: this.state.bpm, beatConfidence: this.state.bpmConfidence, tempoLocked: true }
      : allowDetectedBpm
        ? { ...frame, timestampMs: nowMs }
        : { ...frame, timestampMs: nowMs, bpm: this.state.bpm, beatConfidence: this.state.bpmConfidence, tempoLocked: false };
    this.state = {
      ...this.state,
      peerAudioFrame,
      bpm: allowDetectedBpm ? clamp(frame.bpm, 0, 300) : this.state.bpm,
      bpmConfidence: allowDetectedBpm ? clamp(frame.beatConfidence, 0, 100) : this.state.bpmConfidence,
      lastBeatMs: frame.beatHit ? nowMs : this.state.lastBeatMs,
      peerEverSeen: true,
      sequence: this.state.sequence + 1,
      lastUpdateMs: nowMs
    };
  }

  applyFrequencyMapConfig(frequencyMap: SimFrequencyMap, nowMs: number): void {
    this.dispatch(applyFrequencyMapConfigAction(frequencyMap, nowMs));
  }

  setPeerOutputPreview(states: SimFixtureRenderState[], frameSequence: number, nowMs: number): void {
    this.state = {
      ...this.state,
      peerOutputPreviewStates: states.map((state) => ({ ...state })),
      peerOutputPreviewFrame: frameSequence,
      peerOutputPreviewMs: nowMs,
      peerEverSeen: true
    };
  }

  tick(nowMs: number, peerAgeMs = 0): boolean {
    if (!shouldRenderDmx(this.lastDmxRenderMs, nowMs)) {
      return false;
    }
    this.lastDmxRenderMs = nowMs;
    this.frameCount += 1;
    this.universe = buildDmxUniverse(this.state, this.frameCount, nowMs, this.universe, peerAgeMs);
    return true;
  }

  renderNow(nowMs: number, peerAgeMs = 0): void {
    this.lastDmxRenderMs = nowMs;
    this.frameCount += 1;
    this.universe = buildDmxUniverse(this.state, this.frameCount, nowMs, this.universe, peerAgeMs);
  }

  effectiveAudioFrame(nowMs: number): SimAudioFrame {
    const localIsAuthority =
      (this.role === "BRAIN" && this.state.audioSource === "LINE") ||
      (this.role === "DMX_CONTROLLER" && this.state.audioSource === "MIC");
    const candidate = localIsAuthority ? this.state.audioFrame : this.state.peerAudioFrame;
    const manualActive = manualBpmIsActive(this.state, nowMs);
    if (!candidate || nowMs - candidate.timestampMs > PEER_AUDIO_AUTHORITY_MS) {
      const empty = { ...emptyAudioFrame(nowMs), source: this.state.audioSource };
      return manualActive
        ? { ...empty, bpm: this.state.bpm, beatConfidence: this.state.bpmConfidence, tempoLocked: true }
        : empty;
    }
    return manualActive
      ? { ...candidate, bpm: this.state.bpm, beatConfidence: this.state.bpmConfidence, tempoLocked: true }
      : this.state.bpmDetectEnabled
        ? candidate
        : { ...candidate, bpm: this.state.bpm, beatConfidence: this.state.bpmConfidence, tempoLocked: false };
  }
}
