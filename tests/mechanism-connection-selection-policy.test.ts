import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { MechanismType } from '../types';
import {
  connectionSelectionIdentity,
  connectionSelectionPartKey,
  connectionSelectionRolesForMechanism,
  connectionSelectionSignature,
  connectionSelectionSourceNodeId,
  normalizeMechanismConnectionSelections,
} from '../utils/mechanismConnectionSelections';
import { createDefaultMechanism } from '../utils/project';

const families = [
  '4bar',
  'gear_linkage',
  'gear',
  'planetary_gear',
  'cam',
  'piston',
] as const satisfies readonly MechanismType[];

const fixture = families.map((type) => {
  const mechanism = createDefaultMechanism(type, `policy-${type}`);
  const normalized = normalizeMechanismConnectionSelections(mechanism, undefined);
  const roles = connectionSelectionRolesForMechanism(type);
  return {
    type,
    roles,
    selections: normalized.connectionSelections,
    validation: normalized.connectionSelectionValidation,
    connections: roles.flatMap((role) => {
      const selection = normalized.connectionSelections?.[role];
      return selection
        ? [{
            role,
            selection,
            identity: connectionSelectionIdentity(role, selection),
            sourceNodeId: connectionSelectionSourceNodeId(role, selection),
            partKey: connectionSelectionPartKey(role, selection),
          }]
        : [];
    }),
    signature: connectionSelectionSignature(normalized.connectionSelections),
  };
});

const serialized = JSON.stringify(fixture);
assert.deepEqual(JSON.parse(serialized), fixture, 'selection policy fixture stays portable JSON');
assert.equal(
  createHash('sha256').update(serialized).digest('hex'),
  '2083f9f1d034a2a91d2ede435ee53aa2df51360d182010ad3d6d012bd964fdc9',
  'family roles, defaults, normalization, identities, source nodes, and printable parts stay stable',
);

console.log('mechanism connection-selection policy contracts passed');
