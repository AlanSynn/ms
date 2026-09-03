import type { BuildPlanMechanismV1, BuildPlanV1 } from '../../../utils/buildPlan';

const pointList = (points: Array<{ x: number; y: number }>) =>
  points.map(point => `${point.x},${-point.y}`).join(' ');

export const BlueprintBuildPreview = ({
  buildPlan,
  selectedMechanism,
  onSelectMechanism,
}: {
  buildPlan: BuildPlanV1;
  selectedMechanism?: BuildPlanMechanismV1;
  onSelectMechanism: (mechanismId: string) => void;
}) => {
  const mechanism = selectedMechanism ?? buildPlan.mechanisms[0];
  if (!mechanism) return <div className="blueprint-empty-state">Add a mechanism.</div>;
  const boardSize = buildPlan.profile.boardCells * buildPlan.profile.gridPitchMm;
  const half = boardSize / 2;
  const pad = 18;
  const motions = buildPlan.motions.filter(motion => motion.mechanismRefs.includes(mechanism.ref));
  const targetPartIds = new Set(motions.filter(motion => motion.targetKind === 'part').map(motion => motion.targetId));
  const targetParts = buildPlan.character.parts.filter(part => targetPartIds.has(part.sourcePartId));
  const targetOutline = (outline: Array<{ x: number; y: number }>) =>
    outline.map(point => ({ x: point.x / 2, y: point.y / 2 }));
  return (
    <div
      className="blueprint-build-preview"
      data-testid="blueprint-build-preview"
      data-build-plan-digest={buildPlan.sourceDigest}
      data-build-geometry-signature={mechanism.geometry.signature}
    >
      <div className="blueprint-sheet-bar">
        <span>{mechanism.label}</span>
        <span>12 x 12 in / 100% physical model</span>
      </div>
      <svg
        viewBox={`${-half - pad} ${-half - pad} ${boardSize + pad * 2} ${boardSize + pad * 2}`}
        role="img"
        aria-label={`${mechanism.label} build drawing`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="blueprint-minor-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="currentColor" strokeWidth="0.18" />
          </pattern>
        </defs>
        <rect x={-half} y={-half} width={boardSize} height={boardSize} className="blueprint-board-fill" />
        <rect x={-half} y={-half} width={boardSize} height={boardSize} className="blueprint-grid-fill" />
        {Array.from({ length: buildPlan.profile.boardCells }, (_, column) =>
          Array.from({ length: buildPlan.profile.boardCells }, (_, row) => {
            const x = (column - (buildPlan.profile.boardCells - 1) / 2) * buildPlan.profile.gridPitchMm;
            const y = -((buildPlan.profile.boardCells - 1) / 2 - row) * buildPlan.profile.gridPitchMm;
            return <circle key={`${column}-${row}`} cx={x} cy={y} r={buildPlan.profile.holeDiameterMm / 2} className="blueprint-board-hole" />;
          }),
        )}
        {targetParts.map(part => <polygon key={part.ref} points={pointList(targetOutline(part.outline))} className="blueprint-character-outline" />)}
        {motions.map(motion => <polyline key={motion.ref} points={pointList(motion.pointsMm)} className="blueprint-motion-line" />)}
        {mechanism.geometry.outlines.map(outline => (
          <polygon key={outline.id} points={pointList(outline.pointsMm)} className={`blueprint-physical-outline blueprint-${outline.kind}`} />
        ))}
        {mechanism.geometry.points.map(point => (
          <g key={point.id} transform={`translate(${point.xMm} ${-point.yMm})`}>
            <circle r={buildPlan.profile.holeDiameterMm / 2} className="blueprint-pivot-hole" />
            <text x="4" y="-4" className="blueprint-point-label">{point.label}</text>
          </g>
        ))}
      </svg>
      {buildPlan.mechanisms.length > 1 && (
        <div className="blueprint-preview-tabs" aria-label="Mechanism drawings">
          {buildPlan.mechanisms.map(item => (
            <button key={item.ref} type="button" aria-pressed={item.ref === mechanism.ref} onClick={() => onSelectMechanism(item.sourceMechanismId)}>
              {item.recipe.targetPartName ?? item.recipe.targetSceneObjectName ?? item.sourceMechanismId}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
