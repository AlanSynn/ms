import type { MechanismConfig, ProjectState } from '../types';
import {
    buildAutomataSceneModel,
    type AutomataSceneModel,
} from './automataSceneModel';

export type DesignAutomataProjection = AutomataSceneModel;

export const buildDesignAutomataProjection = (
    project: ProjectState,
    mechanism: MechanismConfig | undefined,
    angle: number
): DesignAutomataProjection => buildAutomataSceneModel(project, mechanism, angle, 'design-live');
