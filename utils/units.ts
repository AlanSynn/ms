import type { PhysicalKitSettings, ProjectState } from '../types';
import { SCENE_PX_PER_MM } from './coordinates';

export type GridUnit = ProjectState['settings']['gridUnit'];

const trimFixed = (value: number, digits: number) => value.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');

export const formatGridPitch = (gridPitchMm: number, unit: GridUnit) => {
  if (unit === 'inch') return `${(gridPitchMm / 25.4).toFixed(2)} in`;
  if (unit === 'px') return `${trimFixed(gridPitchMm * SCENE_PX_PER_MM, 0)} scene px`;
  return `${trimFixed(gridPitchMm / 10, 1)}cm`;
};

export const formatGridLabel = (kit: Pick<PhysicalKitSettings, 'gridPitchMm'>, unit: GridUnit) =>
  `Letter sheet · ${formatGridPitch(kit.gridPitchMm, unit)} grid`;

export const formatGridReadout = (kit: Pick<PhysicalKitSettings, 'gridPitchMm'>, unit: GridUnit) =>
  `${formatGridPitch(kit.gridPitchMm, unit)} between board holes`;
