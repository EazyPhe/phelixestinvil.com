import {
  SAFETY_FADE_DURATION_MS,
  SAFETY_FADE_START_MS,
  SAFETY_HARD_BLACKOUT_MS,
  SAFETY_LINK_WARNING_MS
} from "./constants";
import type { SimSystemState } from "./types";

export type SafetyMode =
  | "Normal"
  | "OperatorBlackout"
  | "OperatorFreeze"
  | "LinkWarning"
  | "LinkFadeBlackout"
  | "LinkHardBlackout"
  | "ErrorSafe";

export interface SafetyOutputPolicy {
  forceBlackout: boolean;
  holdLastFrame: boolean;
  allowSceneRefresh: boolean;
  outputScale: number;
}

export interface SafetyOverlayDescriptor {
  visible: boolean;
  overlay: "BLACKOUT" | "FREEZE" | "LINK_LOST" | "ERROR_SAFE" | null;
  title: string;
  detail: string;
  action: string | null;
}

export function evaluateSafety(state: SimSystemState, peerAgeMs: number): {
  mode: SafetyMode;
  policy: SafetyOutputPolicy;
  overlay: SafetyOverlayDescriptor;
} {
  let mode: SafetyMode = "Normal";
  const peerLossAffectsOutput = state.role !== "DMX_CONTROLLER";

  if (state.blackout) {
    mode = "OperatorBlackout";
  } else if (state.dmxStatus === "Fault") {
    mode = "ErrorSafe";
  } else if (peerLossAffectsOutput && state.peerEverSeen && peerAgeMs >= SAFETY_HARD_BLACKOUT_MS) {
    mode = "LinkHardBlackout";
  } else if (state.freeze) {
    mode = "OperatorFreeze";
  } else if (peerLossAffectsOutput && state.peerEverSeen && peerAgeMs >= SAFETY_FADE_START_MS) {
    mode = "LinkFadeBlackout";
  } else if (peerLossAffectsOutput && state.peerEverSeen && peerAgeMs >= SAFETY_LINK_WARNING_MS) {
    mode = "LinkWarning";
  }

  const policy: SafetyOutputPolicy = {
    forceBlackout: false,
    holdLastFrame: false,
    allowSceneRefresh: true,
    outputScale: 255
  };

  switch (mode) {
    case "OperatorBlackout":
      policy.forceBlackout = true;
      policy.allowSceneRefresh = false;
      break;
    case "OperatorFreeze":
      policy.holdLastFrame = true;
      policy.allowSceneRefresh = false;
      break;
    case "LinkWarning":
      policy.holdLastFrame = true;
      policy.allowSceneRefresh = false;
      break;
    case "LinkFadeBlackout": {
      policy.holdLastFrame = true;
      policy.allowSceneRefresh = false;
      const fadeElapsed = peerAgeMs - SAFETY_FADE_START_MS;
      if (fadeElapsed >= SAFETY_FADE_DURATION_MS) {
        policy.forceBlackout = true;
        policy.outputScale = 0;
      } else {
        policy.outputScale = Math.round(255 - (fadeElapsed * 255) / SAFETY_FADE_DURATION_MS);
      }
      break;
    }
    case "LinkHardBlackout":
      policy.forceBlackout = true;
      policy.allowSceneRefresh = false;
      break;
    case "ErrorSafe":
      policy.holdLastFrame = true;
      policy.allowSceneRefresh = false;
      break;
    case "Normal":
    default:
      break;
  }

  return {
    mode,
    policy,
    overlay: overlayForMode(mode)
  };
}

function overlayForMode(mode: SafetyMode): SafetyOverlayDescriptor {
  switch (mode) {
    case "OperatorBlackout":
      return {
        visible: true,
        overlay: "BLACKOUT",
        title: "BLACKOUT ACTIVE",
        detail: "Output Disabled",
        action: "RESTORE"
      };
    case "OperatorFreeze":
      return {
        visible: true,
        overlay: "FREEZE",
        title: "FREEZE ACTIVE",
        detail: "Holding Current Look",
        action: "RESUME"
      };
    case "LinkWarning":
      return {
        visible: true,
        overlay: "LINK_LOST",
        title: "LINK DEGRADED",
        detail: "Holding Last Frame",
        action: null
      };
    case "LinkFadeBlackout":
      return {
        visible: true,
        overlay: "LINK_LOST",
        title: "LINK LOST",
        detail: "Fading to Safe Blackout",
        action: null
      };
    case "LinkHardBlackout":
      return {
        visible: true,
        overlay: "LINK_LOST",
        title: "LINK LOST",
        detail: "Output Disabled",
        action: null
      };
    case "ErrorSafe":
      return {
        visible: true,
        overlay: "ERROR_SAFE",
        title: "ERROR SAFE",
        detail: "Output Protected",
        action: null
      };
    case "Normal":
    default:
      return {
        visible: false,
        overlay: null,
        title: "",
        detail: "",
        action: null
      };
  }
}

export function scaleUniverse(data: Uint8Array, length: number, scale: number): void {
  if (scale >= 255) {
    return;
  }
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.round((data[i] * scale) / 255);
  }
}
