import type { AppStage } from '../../types';

export const SHARED_PLAYBACK_STAGES: AppStage[] = ['path', 'design'];

export const STAGES: Array<{ id: AppStage; label: string }> = [
  { id: 'project', label: 'Project' },
  { id: 'character', label: 'Character' },
  { id: 'path', label: 'Path Editor' },
  { id: 'foundry', label: 'Mechanism Foundry' },
  { id: 'design', label: 'Mechanism Design' },
  { id: 'blueprint', label: 'Blueprint' },
  { id: 'assembly', label: 'Assembly' },
  { id: 'options', label: 'Options' },
];

export const stageNavLabel = (stage: AppStage) => ({
  project: 'Project',
  character: 'Character',
  path: 'Path',
  foundry: 'Foundry',
  design: 'Design',
  blueprint: 'Blueprint',
  assembly: 'Assembly',
} as Partial<Record<AppStage, string>>)[stage];
