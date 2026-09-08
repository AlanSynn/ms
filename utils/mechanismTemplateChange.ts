import type { MechanismConfig, MechanismType, ProjectState } from '../types';
import { motionPathReadiness } from './motion';
import {
  mechanismBindingForPath,
  mechanismBindingsConflict,
  mechanismOutputBindings,
  mechanismWithOutputBindings,
  resolvedMechanismOutputBindings,
} from './mechanismBindings';
import { createDefaultMechanism } from './project';

type TemplateChange =
  | { ok: true; mechanism: MechanismConfig; pathId: string }
  | { ok: false; reason: string };

/** A template choice changes the owner of the selected motion, atomically. */
export const prepareMechanismTemplateChange = (
  project: ProjectState,
  type: MechanismType,
  newMechanismId: string,
): TemplateChange => {
  const path = project.selectedPathId ? project.paths[project.selectedPathId] : undefined;
  if (!path) return { ok: false, reason: 'Choose a motion path first.' };
  const readiness = motionPathReadiness(project, path);
  if (!readiness.playable) return { ok: false, reason: readiness.reason ?? 'Fix the motion path first.' };

  const base = createDefaultMechanism(type, newMechanismId);
  const requested = mechanismBindingForPath(project, base, path.id);
  if (!requested) return { ok: false, reason: 'Choose another template.' };
  const owners = project.mechanisms.filter(mechanism =>
    resolvedMechanismOutputBindings(project, mechanism).some(binding => binding.pathId === path.id));
  if (owners.length > 1) return { ok: false, reason: 'Connect this path to one mechanism first.' };
  const selected = project.mechanisms.find(mechanism => mechanism.id === project.selectedMechanismId);
  const owner = owners[0] ?? (selected && !mechanismOutputBindings(selected).length ? selected : undefined);
  if (owner && mechanismOutputBindings(owner).length > 1) {
    return { ok: false, reason: 'Keep this template while it drives multiple paths.' };
  }
  const conflict = project.mechanisms.some(mechanism => mechanism.id !== owner?.id &&
    resolvedMechanismOutputBindings(project, mechanism).some(binding =>
      binding.enabled !== false && mechanismBindingsConflict(project, binding, requested)));
  if (conflict) return { ok: false, reason: 'This part already follows another path.' };

  const mechanism = {
    ...base,
    id: owner?.id ?? base.id,
    visible: owner?.visible ?? base.visible,
    enabled: owner && mechanismOutputBindings(owner).length ? owner.enabled : base.enabled,
  };
  const previousBinding = owner ? mechanismOutputBindings(owner)[0] : undefined;
  const binding = mechanismBindingForPath(project, mechanism, path.id, { id: previousBinding?.id });
  if (!binding) return { ok: false, reason: 'Choose another template.' };
  return { ok: true, mechanism: mechanismWithOutputBindings(mechanism, [binding]), pathId: path.id };
};
