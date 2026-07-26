import { BodyPartLayer, ProjectState } from "../../../types";
import { sceneToSvg } from "../../../utils/coordinates";
import {
  fabricablePartOutlinePoints,
  partLandmarkLocalPoints,
  partOutlinePathD,
  pointInsideOutline,
} from "../../../utils/partGeometry";

export const PartShape = ({
  part,
  skeleton,
  sourceTextureUrl,
  selected,
  drawMode,
  onSelect,
}: {
  part: BodyPartLayer;
  skeleton?: ProjectState["skeleton"];
  sourceTextureUrl?: string;
  selected: boolean;
  drawMode?: boolean;
  onSelect: () => void;
}) => {
  if (!part.visible) return null;
  const p = sceneToSvg(part.transform);
  const w = part.bounds.width * part.transform.scale;
  const h = part.bounds.height * part.transform.scale;
  const artX = part.bounds.x * part.transform.scale;
  const artY = -(part.bounds.y + part.bounds.height) * part.transform.scale;
  const sourceFrame = sourceTextureUrl ? part.sourceImageFrame : undefined;
  const textureUrl = sourceFrame ? sourceTextureUrl : part.textureUrl;
  const landmarks = partLandmarkLocalPoints(part, skeleton);
  const outline = fabricablePartOutlinePoints(part, landmarks);
  const outlineD = partOutlinePathD(part, landmarks, {
    scale: part.transform.scale,
    flipY: true,
  });
  const localHoles = landmarks.filter((local) =>
    pointInsideOutline(local, outline, 0.5),
  );
  const holeRadius = Math.max(5, 7.2 * part.transform.scale);
  const maskId = `path-part-surface-mask-${part.id.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const stroke = selected ? "#5a6cff" : "#94a3b8";
  return (
    <g
      data-canvas-interactive="true"
      data-testid={`path-part-${part.id}`}
      data-assembly-underlay="plate-art-layer"
      transform={`translate(${p.x} ${p.y}) rotate(${-part.transform.rotation})`}
      onClick={(e) => {
        if (!drawMode) {
          e.stopPropagation();
          onSelect();
        }
      }}
      className={`${drawMode ? "cursor-crosshair" : "cursor-pointer"} transition-opacity`}
      opacity={part.opacity}
      filter="url(#soft)"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="-1000" y="-1000" width="2000" height="2000" fill="black" />
          <path d={outlineD} fill="white" />
          {localHoles.map((local, index) => (
            <circle
              key={index}
              cx={local.x * part.transform.scale}
              cy={-local.y * part.transform.scale}
              r={holeRadius}
              fill="black"
            />
          ))}
        </mask>
      </defs>
      <rect
        x={artX}
        y={artY}
        width={w}
        height={h}
        fill="#eef2f7"
        opacity=".72"
        mask={`url(#${maskId})`}
      />
      {textureUrl ? (
        <image
          data-testid={`path-part-art-${part.id}`}
          href={textureUrl}
          x={sourceFrame ? sourceFrame.x * part.transform.scale : artX}
          y={sourceFrame ? -(sourceFrame.y + sourceFrame.height) * part.transform.scale : artY}
          width={sourceFrame ? sourceFrame.width * part.transform.scale : w}
          height={sourceFrame ? sourceFrame.height * part.transform.scale : h}
          preserveAspectRatio="xMidYMid meet"
          opacity=".52"
          mask={`url(#${maskId})`}
          style={{ filter: "saturate(0.82) contrast(0.96)" }}
        />
      ) : (
        <rect
          data-testid={`path-part-art-${part.id}`}
          x={artX}
          y={artY}
          width={w}
          height={h}
          rx="22"
          fill={part.fillColor}
          opacity=".52"
          mask={`url(#${maskId})`}
        />
      )}
      <path
        data-testid={`path-part-plate-${part.id}`}
        data-art-offset-x={artX}
        d={outlineD}
        fill="none"
        stroke={stroke}
        strokeWidth={selected ? 3 : 1.2}
        strokeDasharray={selected ? "0" : "5 5"}
        opacity={selected ? 0.72 : 0.28}
      />
      {part.localPivotOffset && (
        <circle
          cx={part.localPivotOffset.x * part.transform.scale}
          cy={-part.localPivotOffset.y * part.transform.scale}
          r={5}
          fill="#64748b"
          stroke="white"
          strokeWidth="2"
        >
          <title>local pivot</title>
        </circle>
      )}
    </g>
  );
};
