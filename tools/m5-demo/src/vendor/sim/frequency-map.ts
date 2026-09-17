import { MAX_FIXTURES, SPECTRUM_BAND_COUNT, clamp } from "./constants";
import type { FrequencyMapPreset, FrequencyMapReactionStyle, SimFixturePatch, SimFrequencyMap, SimFrequencyMapStorageRecord } from "./types";

export const FREQUENCY_MAP_COLOR_PRESET_COUNT = 9;
export const FREQUENCY_MAP_DEFAULT_SENSITIVITY = 100;
export const FREQUENCY_MAP_MAX_SENSITIVITY = 200;
export const FREQUENCY_MAP_PRESETS: Exclude<FrequencyMapPreset, "CUSTOM">[] = ["SPREAD", "RHYTHM", "MIRROR", "VOCAL", "SPARKLE"];
export const FREQUENCY_MAP_ALL_BAND_MASK = (2 ** SPECTRUM_BAND_COUNT) - 1;

const PRESET_DEFINITIONS: Record<Exclude<FrequencyMapPreset, "CUSTOM">, { reactionStyle: FrequencyMapReactionStyle; bands: number[]; colors: number[] }> = {
  SPREAD: { reactionStyle: "BRIGHTNESS", bands: [1, 5, 9, 13], colors: [0, 2, 4, 6] },
  RHYTHM: { reactionStyle: "FLASH", bands: [0, 2, 8, 13], colors: [0, 2, 4, 7] },
  MIRROR: { reactionStyle: "MORPH", bands: [1, 6, 6, 1], colors: [5, 6, 6, 5] },
  VOCAL: { reactionStyle: "MORPH", bands: [3, 6, 9, 12], colors: [2, 3, 4, 6] },
  SPARKLE: { reactionStyle: "FLASH", bands: [0, 10, 13, 15], colors: [0, 5, 7, 6] }
};

export function createInitialFrequencyMap(patch: SimFixturePatch): SimFrequencyMap {
  const map: SimFrequencyMap = {
    revision: 0,
    enabled: false,
    reactionStyle: "BRIGHTNESS",
    preset: "SPREAD",
    activeFixtureMask: 0,
    bandByFixture: Array.from({ length: MAX_FIXTURES }, (_, index) => index % SPECTRUM_BAND_COUNT),
    bandMaskByFixture: Array.from({ length: MAX_FIXTURES }, (_, index) => bandMaskForBand(index % SPECTRUM_BAND_COUNT)),
    colorPresetByFixture: Array.from({ length: MAX_FIXTURES }, (_, index) => index % FREQUENCY_MAP_COLOR_PRESET_COUNT),
    sensitivityByFixture: Array.from({ length: MAX_FIXTURES }, () => FREQUENCY_MAP_DEFAULT_SENSITIVITY)
  };
  return autoSpreadFrequencyMap(map, patch, false);
}

export function sanitizeFrequencyMap(map: SimFrequencyMap): SimFrequencyMap {
  const bandByFixture = Array.from({ length: MAX_FIXTURES }, (_, index) => clamp(map.bandByFixture[index] ?? index, 0, SPECTRUM_BAND_COUNT - 1));
  const bandMaskByFixture = Array.from({ length: MAX_FIXTURES }, (_, index) => sanitizeBandMask(map.bandMaskByFixture?.[index], bandByFixture[index] ?? index));
  for (let index = 0; index < MAX_FIXTURES; index += 1) {
    if ((bandMaskByFixture[index] & bandMaskForBand(bandByFixture[index])) === 0) {
      bandByFixture[index] = firstBandInMask(bandMaskByFixture[index]);
    }
  }
  return {
    revision: Math.max(0, Math.trunc(map.revision)),
    enabled: map.enabled,
    reactionStyle: isFrequencyMapStyle(map.reactionStyle) ? map.reactionStyle : "BRIGHTNESS",
    preset: isFrequencyMapPreset(map.preset) ? map.preset : "CUSTOM",
    activeFixtureMask: Math.max(0, Math.trunc(map.activeFixtureMask)) >>> 0,
    bandByFixture,
    bandMaskByFixture,
    colorPresetByFixture: Array.from({ length: MAX_FIXTURES }, (_, index) => clamp(map.colorPresetByFixture[index] ?? index, 0, FREQUENCY_MAP_COLOR_PRESET_COUNT - 1)),
    sensitivityByFixture: Array.from({ length: MAX_FIXTURES }, (_, index) => clamp(map.sensitivityByFixture[index] ?? FREQUENCY_MAP_DEFAULT_SENSITIVITY, 0, FREQUENCY_MAP_MAX_SENSITIVITY))
  };
}

export function autoSpreadFrequencyMap(map: SimFrequencyMap, patch: SimFixturePatch, bumpRevision: boolean): SimFrequencyMap {
  const current = sanitizeFrequencyMap(map);
  const next: SimFrequencyMap = {
    ...current,
    preset: "SPREAD",
    bandByFixture: [...current.bandByFixture],
    bandMaskByFixture: [...current.bandMaskByFixture],
    colorPresetByFixture: [...current.colorPresetByFixture],
    sensitivityByFixture: [...current.sensitivityByFixture],
    activeFixtureMask: 0
  };
  const activeIds = patch.fixtures
    .filter((fixture) => fixture.enabled && fixture.id >= 1 && fixture.id <= MAX_FIXTURES)
    .map((fixture) => fixture.id)
    .sort((left, right) => left - right);

  activeIds.forEach((fixtureId, index) => {
    const slot = fixtureId - 1;
    const wasActive = isFrequencyMapFixtureActive(current, fixtureId);
    next.activeFixtureMask += maskForSlot(slot);
    next.bandByFixture[slot] = clamp(Math.floor(((2 * index + 1) * SPECTRUM_BAND_COUNT) / (2 * activeIds.length)), 0, SPECTRUM_BAND_COUNT - 1);
    next.bandMaskByFixture[slot] = bandMaskForBand(next.bandByFixture[slot]);
    if (!wasActive || next.colorPresetByFixture[slot] >= FREQUENCY_MAP_COLOR_PRESET_COUNT) {
      next.colorPresetByFixture[slot] = index % FREQUENCY_MAP_COLOR_PRESET_COUNT;
    }
  });

  if (frequencyMapsEqual(current, next)) {
    return current;
  }
  return {
    ...next,
    revision: bumpRevision ? current.revision + 1 : current.revision
  };
}

export function assignFrequencyMapFixture(
  map: SimFrequencyMap,
  fixtureId: number,
  bandIndex: number,
  colorPreset: number
): SimFrequencyMap {
  if (fixtureId < 1 || fixtureId > MAX_FIXTURES || bandIndex < 0 || bandIndex >= SPECTRUM_BAND_COUNT || colorPreset < 0 || colorPreset >= FREQUENCY_MAP_COLOR_PRESET_COUNT) {
    return map;
  }
  const current = sanitizeFrequencyMap(map);
  const slot = fixtureId - 1;
  const bandMask = bandMaskForBand(bandIndex);
  if (current.bandByFixture[slot] === bandIndex && current.bandMaskByFixture[slot] === bandMask && current.colorPresetByFixture[slot] === colorPreset) {
    return current;
  }
  const next = {
    ...current,
    revision: current.revision + 1,
    preset: "CUSTOM" as FrequencyMapPreset,
    bandByFixture: [...current.bandByFixture],
    bandMaskByFixture: [...current.bandMaskByFixture],
    colorPresetByFixture: [...current.colorPresetByFixture],
    sensitivityByFixture: [...current.sensitivityByFixture]
  };
  next.bandByFixture[slot] = bandIndex;
  next.bandMaskByFixture[slot] = bandMask;
  next.colorPresetByFixture[slot] = colorPreset;
  return next;
}

export function setFrequencyMapFixtureBandMask(
  map: SimFrequencyMap,
  fixtureId: number,
  bandMask: number
): SimFrequencyMap {
  if (fixtureId < 1 || fixtureId > MAX_FIXTURES) {
    return map;
  }
  const current = sanitizeFrequencyMap(map);
  const slot = fixtureId - 1;
  const sanitizedMask = sanitizeBandMask(bandMask, current.bandByFixture[slot] ?? 0);
  const primaryBand = firstBandInMask(sanitizedMask);
  if (current.bandMaskByFixture[slot] === sanitizedMask && current.bandByFixture[slot] === primaryBand) {
    return current;
  }
  const next = {
    ...current,
    revision: current.revision + 1,
    preset: "CUSTOM" as FrequencyMapPreset,
    bandByFixture: [...current.bandByFixture],
    bandMaskByFixture: [...current.bandMaskByFixture],
    colorPresetByFixture: [...current.colorPresetByFixture],
    sensitivityByFixture: [...current.sensitivityByFixture]
  };
  next.bandByFixture[slot] = primaryBand;
  next.bandMaskByFixture[slot] = sanitizedMask;
  return next;
}

export function setFrequencyMapFixtureSensitivity(
  map: SimFrequencyMap,
  fixtureId: number,
  sensitivityPercent: number
): SimFrequencyMap {
  if (fixtureId < 1 || fixtureId > MAX_FIXTURES) {
    return map;
  }
  const current = sanitizeFrequencyMap(map);
  const slot = fixtureId - 1;
  const sensitivity = clamp(sensitivityPercent, 0, FREQUENCY_MAP_MAX_SENSITIVITY);
  if (current.sensitivityByFixture[slot] === sensitivity) {
    return current;
  }
  const next = {
    ...current,
    revision: current.revision + 1,
    preset: "CUSTOM" as FrequencyMapPreset,
    sensitivityByFixture: [...current.sensitivityByFixture]
  };
  next.sensitivityByFixture[slot] = sensitivity;
  return next;
}

export function setFrequencyMapEnabled(map: SimFrequencyMap, enabled: boolean): SimFrequencyMap {
  const current = sanitizeFrequencyMap(map);
  return current.enabled === enabled ? current : { ...current, enabled, revision: current.revision + 1 };
}

export function setFrequencyMapStyle(map: SimFrequencyMap, reactionStyle: FrequencyMapReactionStyle): SimFrequencyMap {
  const current = sanitizeFrequencyMap(map);
  return current.reactionStyle === reactionStyle ? current : { ...current, reactionStyle, preset: "CUSTOM", revision: current.revision + 1 };
}

export function applyFrequencyMapPreset(map: SimFrequencyMap, patch: SimFixturePatch, preset: FrequencyMapPreset): SimFrequencyMap {
  const selected: Exclude<FrequencyMapPreset, "CUSTOM"> = preset === "CUSTOM" || !isFrequencyMapPreset(preset) ? "SPREAD" : preset;
  const current = sanitizeFrequencyMap(map);
  const definition = PRESET_DEFINITIONS[selected];
  const next: SimFrequencyMap = {
    ...current,
    enabled: true,
    reactionStyle: definition.reactionStyle,
    preset: selected,
    activeFixtureMask: 0,
    bandByFixture: [...current.bandByFixture],
    bandMaskByFixture: [...current.bandMaskByFixture],
    colorPresetByFixture: [...current.colorPresetByFixture],
    sensitivityByFixture: [...current.sensitivityByFixture]
  };
  const activeIds = activeFixtureIds(patch);

  activeIds.forEach((fixtureId, index) => {
    const slot = fixtureId - 1;
    next.activeFixtureMask += maskForSlot(slot);
    if (selected === "SPREAD") {
      next.bandByFixture[slot] = clamp(Math.floor(((2 * index + 1) * SPECTRUM_BAND_COUNT) / (2 * activeIds.length)), 0, SPECTRUM_BAND_COUNT - 1);
      next.colorPresetByFixture[slot] = index % FREQUENCY_MAP_COLOR_PRESET_COUNT;
    } else {
      const patternIndex = index % 4;
      next.bandByFixture[slot] = definition.bands[patternIndex];
      next.colorPresetByFixture[slot] = definition.colors[patternIndex];
    }
    next.bandMaskByFixture[slot] = bandMaskForBand(next.bandByFixture[slot]);
  });

  if (frequencyMapsEqual(current, next)) {
    return current;
  }
  return { ...next, revision: current.revision + 1 };
}

export function nextFrequencyMapPreset(preset: FrequencyMapPreset): Exclude<FrequencyMapPreset, "CUSTOM"> {
  const current = FREQUENCY_MAP_PRESETS.indexOf(preset as Exclude<FrequencyMapPreset, "CUSTOM">);
  return FREQUENCY_MAP_PRESETS[(current + 1) % FREQUENCY_MAP_PRESETS.length] ?? "SPREAD";
}

export function frequencyMapBandForFixture(map: SimFrequencyMap, fixtureId: number): number {
  if (fixtureId < 1 || fixtureId > MAX_FIXTURES) {
    return 0;
  }
  const slot = fixtureId - 1;
  const primaryBand = clamp(map.bandByFixture[slot] ?? 0, 0, SPECTRUM_BAND_COUNT - 1);
  const bandMask = sanitizeBandMask(map.bandMaskByFixture?.[slot], primaryBand);
  return (bandMask & bandMaskForBand(primaryBand)) !== 0 ? primaryBand : firstBandInMask(bandMask);
}

export function frequencyMapBandMaskForFixture(map: SimFrequencyMap, fixtureId: number): number {
  if (fixtureId < 1 || fixtureId > MAX_FIXTURES) {
    return 1;
  }
  const slot = fixtureId - 1;
  return sanitizeBandMask(map.bandMaskByFixture?.[slot], map.bandByFixture[slot] ?? 0);
}

export function frequencyMapColorForFixture(map: SimFrequencyMap, fixtureId: number): number {
  if (fixtureId < 1 || fixtureId > MAX_FIXTURES) {
    return 0;
  }
  return clamp(map.colorPresetByFixture[fixtureId - 1] ?? 0, 0, FREQUENCY_MAP_COLOR_PRESET_COUNT - 1);
}

export function frequencyMapSensitivityForFixture(map: SimFrequencyMap, fixtureId: number): number {
  if (fixtureId < 1 || fixtureId > MAX_FIXTURES) {
    return FREQUENCY_MAP_DEFAULT_SENSITIVITY;
  }
  return clamp(map.sensitivityByFixture[fixtureId - 1] ?? FREQUENCY_MAP_DEFAULT_SENSITIVITY, 0, FREQUENCY_MAP_MAX_SENSITIVITY);
}

export function applyFrequencyMapSensitivity(energy: number, sensitivityPercent: number): number {
  return clamp(Math.round((clamp(energy, 0, 100) * clamp(sensitivityPercent, 0, FREQUENCY_MAP_MAX_SENSITIVITY)) / 100), 0, 100);
}

export function applyFixtureSensitivity(map: SimFrequencyMap, fixtureId: number, energy: number): number {
  return applyFrequencyMapSensitivity(energy, frequencyMapSensitivityForFixture(map, fixtureId));
}

export function frequencyMapRawEnergyForFixture(map: SimFrequencyMap, fixtureId: number, spectrum: number[]): number {
  const bandMask = frequencyMapBandMaskForFixture(map, fixtureId);
  let total = 0;
  let samples = 0;
  for (let index = 0; index < SPECTRUM_BAND_COUNT; index += 1) {
    if ((bandMask & bandMaskForBand(index)) === 0) {
      continue;
    }
    total += clamp(spectrum[index] ?? 0, 0, 100);
    samples += 1;
  }
  return samples === 0 ? 0 : clamp(Math.round(total / samples), 0, 100);
}

export function isFrequencyMapFixtureActive(map: SimFrequencyMap, fixtureId: number): boolean {
  if (fixtureId < 1 || fixtureId > MAX_FIXTURES) {
    return false;
  }
  return (Math.floor(map.activeFixtureMask / maskForSlot(fixtureId - 1)) % 2) === 1;
}

export function applyPeerFrequencyMap(current: SimFrequencyMap, incoming: SimFrequencyMap): SimFrequencyMap {
  return incoming.revision > current.revision ? sanitizeFrequencyMap(incoming) : current;
}

export function toFrequencyMapStorageRecord(map: SimFrequencyMap): SimFrequencyMapStorageRecord {
  const current = sanitizeFrequencyMap(map);
  return {
    version: 2,
    revision: current.revision,
    enabled: current.enabled,
    reactionStyle: current.reactionStyle,
    preset: current.preset,
    activeFixtureMask: current.activeFixtureMask,
    bandByFixture: [...current.bandByFixture],
    bandMaskByFixture: [...current.bandMaskByFixture],
    colorPresetByFixture: [...current.colorPresetByFixture],
    sensitivityByFixture: [...current.sensitivityByFixture]
  };
}

export function fromFrequencyMapStorageRecord(record: SimFrequencyMapStorageRecord): SimFrequencyMap {
  return sanitizeFrequencyMap({
    revision: record.revision,
    enabled: record.enabled,
    reactionStyle: record.reactionStyle,
    preset: record.preset ?? "CUSTOM",
    activeFixtureMask: record.activeFixtureMask,
    bandByFixture: [...record.bandByFixture],
    bandMaskByFixture: [...(record.bandMaskByFixture ?? [])],
    colorPresetByFixture: [...record.colorPresetByFixture],
    sensitivityByFixture: [...(record.sensitivityByFixture ?? [])]
  });
}

function frequencyMapsEqual(left: SimFrequencyMap, right: SimFrequencyMap): boolean {
  return left.revision === right.revision &&
    left.enabled === right.enabled &&
    left.reactionStyle === right.reactionStyle &&
    left.preset === right.preset &&
    left.activeFixtureMask === right.activeFixtureMask &&
    left.bandByFixture.every((value, index) => value === right.bandByFixture[index]) &&
    left.bandMaskByFixture.every((value, index) => value === right.bandMaskByFixture[index]) &&
    left.colorPresetByFixture.every((value, index) => value === right.colorPresetByFixture[index]) &&
    left.sensitivityByFixture.every((value, index) => value === right.sensitivityByFixture[index]);
}

function maskForSlot(slot: number): number {
  return 2 ** slot;
}

export function bandMaskForBand(index: number): number {
  return index >= 0 && index < SPECTRUM_BAND_COUNT ? 2 ** index : 1;
}

function sanitizeBandMask(mask: unknown, fallbackBand: number): number {
  const numeric = Number.isFinite(Number(mask)) ? Math.trunc(Number(mask)) : 0;
  const sanitized = numeric & FREQUENCY_MAP_ALL_BAND_MASK;
  if (sanitized !== 0) {
    return sanitized;
  }
  return bandMaskForBand(clamp(fallbackBand, 0, SPECTRUM_BAND_COUNT - 1));
}

function firstBandInMask(bandMask: number): number {
  const sanitized = sanitizeBandMask(bandMask, 0);
  for (let index = 0; index < SPECTRUM_BAND_COUNT; index += 1) {
    if ((sanitized & bandMaskForBand(index)) !== 0) {
      return index;
    }
  }
  return 0;
}

function activeFixtureIds(patch: SimFixturePatch): number[] {
  return patch.fixtures
    .filter((fixture) => fixture.enabled && fixture.id >= 1 && fixture.id <= MAX_FIXTURES)
    .map((fixture) => fixture.id)
    .sort((left, right) => left - right);
}

function isFrequencyMapStyle(style: string): style is FrequencyMapReactionStyle {
  return style === "BRIGHTNESS" || style === "FLASH" || style === "MORPH";
}

function isFrequencyMapPreset(preset: unknown): preset is FrequencyMapPreset {
  return preset === "SPREAD" ||
    preset === "RHYTHM" ||
    preset === "MIRROR" ||
    preset === "VOCAL" ||
    preset === "SPARKLE" ||
    preset === "CUSTOM";
}
