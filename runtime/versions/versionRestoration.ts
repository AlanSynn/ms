import type { ProjectState } from '../../types';
import { invalidateMechanismPathFit } from '../../utils/project';
import { mechanismPathFitIsUsable } from '../../utils/motion';
import { restoreAuthoredSettings } from './versionPolicy';

export const restoredProjectState = (current: ProjectState, selected: ProjectState, now: number): ProjectState => {
  const restored: ProjectState = {
    ...selected,
    revision: Math.max(current.revision ?? 0, selected.revision ?? 0) + 1,
    metadata: { ...selected.metadata, id: current.metadata.id, updatedAt: new Date(now).toISOString() },
    settings: restoreAuthoredSettings(current.settings, selected.settings),
    selectedPartId: current.selectedPartId && selected.parts[current.selectedPartId] ? current.selectedPartId : undefined,
    selectedPathId: current.selectedPathId && selected.paths[current.selectedPathId] ? current.selectedPathId : undefined,
    selectedSceneObjectId: current.selectedSceneObjectId && selected.sceneObjects[current.selectedSceneObjectId] ? current.selectedSceneObjectId : undefined,
    selectedMechanismId: selected.mechanisms.some(item => item.id === current.selectedMechanismId) ? current.selectedMechanismId : undefined,
    processing: { stage: 'ready', progress: 100, message: 'Version restored' },
    lastExport: undefined,
    lastFoundryExport: undefined,
  };
  restored.mechanisms = restored.mechanisms.map(mechanism => mechanismPathFitIsUsable(restored, mechanism) ? mechanism : invalidateMechanismPathFit(mechanism));
  return restored;
};
