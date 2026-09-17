import {
  DEFAULT_UNIVERSE_ID,
  DMX_UNIVERSE_SLOTS,
  MAX_FIXTURES,
  clamp,
  emptyFixtureRenderState
} from "./constants";
import type {
  FixtureProfileId,
  SimFixtureDefinition,
  SimFixtureGroupDefinition,
  SimFixturePatch,
  SimFixturePatchSummary,
  SimFixtureProfileDefinition,
  SimFixtureRenderState
} from "./types";

export const FIXTURE_PROFILES: SimFixtureProfileDefinition[] = [
  {
    id: "rgb7",
    key: "rgb7",
    name: "RGB 7 Channel",
    channelCount: 7,
    defaultValues: [0, 0, 0, 0, 0, 0, 127, 0]
  },
  {
    id: "rgbw8",
    key: "rgbw8",
    name: "RGBW 8 Channel",
    channelCount: 8,
    defaultValues: [0, 0, 0, 0, 0, 0, 0, 127]
  }
];

export function findFixtureProfile(id: FixtureProfileId): SimFixtureProfileDefinition | undefined {
  return FIXTURE_PROFILES.find((profile) => profile.id === id);
}

export function fixtureProfileName(id: FixtureProfileId): string {
  return findFixtureProfile(id)?.name ?? "Unknown Fixture";
}

export function fixtureProfileChannelCount(id: FixtureProfileId): number {
  return findFixtureProfile(id)?.channelCount ?? 0;
}

export function fixtureEndAddress(startAddress: number, channelCount: number): number {
  if (startAddress === 0 || channelCount === 0) {
    return 0;
  }
  return startAddress + channelCount - 1;
}

export function fixtureFitsUniverse(startAddress: number, channelCount: number): boolean {
  const endAddress = fixtureEndAddress(startAddress, channelCount);
  return startAddress >= 1 && endAddress <= DMX_UNIVERSE_SLOTS;
}

export function buildUniformFixturePatch(
  profileId: FixtureProfileId,
  requestedFixtureCount: number,
  universeId = DEFAULT_UNIVERSE_ID
): SimFixturePatch {
  const profile = findFixtureProfile(profileId);
  if (!profile || universeId === 0) {
    throw new Error(`Unsupported fixture patch profile=${profileId} universe=${universeId}`);
  }

  const boundedCount = boundedFixtureCount(requestedFixtureCount, profile.channelCount);
  if (boundedCount === 0) {
    throw new Error("Fixture count must fit in one DMX universe");
  }

  const frontCount = Math.ceil(boundedCount / 2);
  const backCount = boundedCount - frontCount;
  const groups: SimFixtureGroupDefinition[] = [
    makeGroup(1, "All Fixtures", maskForRange(1, boundedCount))
  ];

  if (boundedCount > 1) {
    groups.push(makeGroup(2, "Front Wash", maskForRange(1, frontCount)));
  }
  if (backCount > 0) {
    groups.push(makeGroup(3, "Back Wash", maskForRange(frontCount + 1, backCount)));
  }

  const fixtures: SimFixtureDefinition[] = [];
  for (let i = 0; i < boundedCount; i += 1) {
    fixtures.push({
      id: i + 1,
      profileId,
      universeId,
      startAddress: 1 + i * profile.channelCount,
      groupId: boundedCount === 1 ? 1 : i < frontCount ? 2 : 3,
      enabled: true,
      name: `Fixture ${String(i + 1).padStart(2, "0")}`
    });
  }

  return {
    version: 1,
    universeId,
    fixtureCount: boundedCount,
    groupCount: groups.length,
    fixtures,
    groups
  };
}

export function buildFixturePatchFromDefinitions(fixtures: SimFixtureDefinition[], universeId = DEFAULT_UNIVERSE_ID): SimFixturePatch {
  const normalized = fixtures
    .slice(0, MAX_FIXTURES)
    .map((fixture, index) => normalizeFixture(fixture, index + 1, universeId));
  const enabledFixtures = normalized.filter((fixture) => fixture.enabled);
  const groups = [
    makeGroup(1, "All Fixtures", maskFromFixtures(enabledFixtures)),
    makeGroup(2, "Front Wash", maskFromFixtures(enabledFixtures.filter((fixture) => fixture.groupId === 2))),
    makeGroup(3, "Back Wash", maskFromFixtures(enabledFixtures.filter((fixture) => fixture.groupId === 3)))
  ].filter((group) => group.enabled);

  return {
    version: 1,
    universeId,
    fixtureCount: normalized.length,
    groupCount: groups.length,
    fixtures: normalized,
    groups
  };
}

export function summarizeFixturePatch(patch: SimFixturePatch): SimFixturePatchSummary {
  let activeSlots = 0;
  for (const fixture of patch.fixtures) {
    if (!fixture.enabled || fixture.universeId !== patch.universeId) {
      continue;
    }
    const channelCount = fixtureProfileChannelCount(fixture.profileId);
    if (!fixtureFitsUniverse(fixture.startAddress, channelCount)) {
      continue;
    }
    activeSlots = Math.max(activeSlots, fixtureEndAddress(fixture.startAddress, channelCount));
  }

  return {
    universeId: patch.universeId,
    defaultProfileId: patch.fixtures[0]?.profileId ?? "unknown",
    fixtureCount: patch.fixtureCount,
    groupCount: patch.groupCount,
    activeSlots
  };
}

export function renderFixtureProfile(
  profileId: FixtureProfileId,
  renderState: SimFixtureRenderState,
  slots: Uint8Array,
  slotOffset: number,
  slotCount: number
): boolean {
  if (slotOffset < 0 || slotOffset >= slots.length || slotCount <= 0) {
    return false;
  }

  if (profileId === "rgb7") {
    renderRGB7Profile(renderState, slots, slotOffset, slotCount);
    return true;
  }

  if (profileId === "rgbw8") {
    renderRGBW8Profile(renderState, slots, slotOffset, slotCount);
    return true;
  }

  return false;
}

export function renderRGB7Profile(
  state: SimFixtureRenderState,
  slots: Uint8Array,
  offset = 0,
  slotCount = 7
): void {
  const values = profileValues(state, false);
  setSlot(slots, offset, slotCount, 0, values.dimmer);
  setSlot(slots, offset, slotCount, 1, values.red);
  setSlot(slots, offset, slotCount, 2, values.green);
  setSlot(slots, offset, slotCount, 3, values.blue);
  setSlot(slots, offset, slotCount, 4, values.strobe);
  setSlot(slots, offset, slotCount, 5, values.macro);
  setSlot(slots, offset, slotCount, 6, values.speed);
}

export function renderRGBW8Profile(
  state: SimFixtureRenderState,
  slots: Uint8Array,
  offset = 0,
  slotCount = 8
): void {
  const values = profileValues(state, true);
  setSlot(slots, offset, slotCount, 0, values.dimmer);
  setSlot(slots, offset, slotCount, 1, values.red);
  setSlot(slots, offset, slotCount, 2, values.green);
  setSlot(slots, offset, slotCount, 3, values.blue);
  setSlot(slots, offset, slotCount, 4, values.white);
  setSlot(slots, offset, slotCount, 5, values.strobe);
  setSlot(slots, offset, slotCount, 6, values.macro);
  setSlot(slots, offset, slotCount, 7, values.speed);
}

export function fixtureRenderStateFromPartial(partial: Partial<SimFixtureRenderState>): SimFixtureRenderState {
  return { ...emptyFixtureRenderState(), ...partial };
}

function boundedFixtureCount(requested: number, channelCount: number): number {
  if (requested <= 0 || channelCount <= 0) {
    return 0;
  }
  const maxByUniverse = Math.floor(DMX_UNIVERSE_SLOTS / channelCount);
  return clamp(requested, 1, Math.min(MAX_FIXTURES, maxByUniverse));
}

function maskForRange(firstFixtureId: number, count: number): number {
  let mask = 0;
  for (let i = 0; i < count; i += 1) {
    const fixtureId = firstFixtureId + i;
    if (fixtureId >= 1 && fixtureId <= 32) {
      mask |= 1 << (fixtureId - 1);
    }
  }
  return mask >>> 0;
}

function makeGroup(id: number, name: string, fixtureMask: number): SimFixtureGroupDefinition {
  return {
    id,
    enabled: fixtureMask !== 0,
    fixtureMask,
    name
  };
}

function maskFromFixtures(fixtures: SimFixtureDefinition[]): number {
  let mask = 0;
  for (const fixture of fixtures) {
    if (fixture.id >= 1 && fixture.id <= 32) {
      mask |= 1 << (fixture.id - 1);
    }
  }
  return mask >>> 0;
}

function normalizeFixture(fixture: SimFixtureDefinition, fallbackId: number, universeId: number): SimFixtureDefinition {
  const profileId = findFixtureProfile(fixture.profileId) ? fixture.profileId : "rgb7";
  const channelCount = fixtureProfileChannelCount(profileId);
  const startAddress = clamp(fixture.startAddress, 1, Math.max(1, DMX_UNIVERSE_SLOTS - channelCount + 1));
  const id = clamp(fixture.id || fallbackId, 1, MAX_FIXTURES);
  return {
    id,
    profileId,
    universeId,
    startAddress,
    groupId: clamp(fixture.groupId || 1, 1, 8),
    enabled: fixture.enabled !== false,
    name: (fixture.name ?? "").trim().slice(0, 15) || `Fixture ${String(id).padStart(2, "0")}`
  };
}

function setSlot(slots: Uint8Array, offset: number, slotCount: number, relativeIndex: number, value: number): void {
  if (relativeIndex < slotCount && offset + relativeIndex < slots.length) {
    slots[offset + relativeIndex] = clamp(value, 0, 255);
  }
}

function profileValues(state: SimFixtureRenderState, hasWhite: boolean): SimFixtureRenderState {
  if (!state.identify) {
    return {
      ...state,
      dimmer: clamp(state.dimmer, 0, 255),
      red: clamp(state.red, 0, 255),
      green: clamp(state.green, 0, 255),
      blue: clamp(state.blue, 0, 255),
      white: clamp(state.white, 0, 255),
      strobe: clamp(state.strobe, 0, 255),
      macro: clamp(state.macro, 0, 255),
      speed: clamp(state.speed, 0, 255)
    };
  }

  return {
    dimmer: 255,
    red: 255,
    green: 255,
    blue: 255,
    white: hasWhite ? 255 : 0,
    strobe: 0,
    macro: 0,
    speed: 127,
    identify: true
  };
}
