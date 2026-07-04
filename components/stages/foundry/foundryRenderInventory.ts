import type { MechanismType } from "../../../types";
import { mechanismRequiredParts } from "../../../utils/project";
import { referenceRequiredPartsHoleCount } from "../../../utils/mechanismReference";

type FoundryRenderedInventory = {
  parts: number;
  holes: number;
  slots: number;
  gears: number;
  racks: number;
  cams: number;
  followers: number;
  endStops: number;
};

const FOUNDRY_RENDERED_INVENTORY_FALLBACK: Record<
  MechanismType,
  FoundryRenderedInventory
> = {
  "4bar": {
    parts: 5,
    holes: 15,
    slots: 0,
    gears: 0,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  piston: {
    parts: 6,
    holes: 15,
    slots: 1,
    gears: 0,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  yoke: {
    parts: 7,
    holes: 15,
    slots: 2,
    gears: 0,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  "quick-return": {
    parts: 6,
    holes: 15,
    slots: 1,
    gears: 0,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  "5bar": {
    parts: 7,
    holes: 25,
    slots: 0,
    gears: 0,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  "6bar": {
    parts: 7,
    holes: 25,
    slots: 0,
    gears: 0,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  cam: {
    parts: 8,
    holes: 16,
    slots: 1,
    gears: 0,
    racks: 0,
    cams: 1,
    followers: 1,
    endStops: 0,
  },
  "rack-pinion": {
    parts: 10,
    holes: 20,
    slots: 1,
    gears: 1,
    racks: 1,
    cams: 0,
    followers: 0,
    endStops: 2,
  },
  gear: {
    parts: 8,
    holes: 29,
    slots: 0,
    gears: 2,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  gear_linkage: {
    parts: 9,
    holes: 31,
    slots: 0,
    gears: 2,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  planetary_gear: {
    parts: 7,
    holes: 18,
    slots: 0,
    gears: 3,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
  crank: {
    parts: 5,
    holes: 15,
    slots: 0,
    gears: 0,
    racks: 0,
    cams: 0,
    followers: 0,
    endStops: 0,
  },
};

export const foundryRenderedInventory = (
  type: MechanismType,
): FoundryRenderedInventory => {
  const fallback = FOUNDRY_RENDERED_INVENTORY_FALLBACK[type];
  const referenceHoleCount = referenceRequiredPartsHoleCount(
    mechanismRequiredParts({ type }),
  );
  return referenceHoleCount
    ? { ...fallback, holes: referenceHoleCount }
    : fallback;
};
