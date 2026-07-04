import type {
  MechanismConfig,
  MechanismType,
  PhysicalKitSettings,
  Point,
} from "../../../types";
import { gearPathD } from "../../../utils/exporter";
import {
  FABRICATION_HOLE_RADIUS_MM,
  FABRICATION_LINKAGE_WIDTH_MM,
  fabricationGearProfileForPitchRadius,
  fabricationLinkageSpecForSceneLength,
  fabricationRingGearPathD,
  fabricationRingGearProfileForPitchRadius,
  planetaryRingPitchRadius,
} from "../../../utils/fabrication";
import { degToRad } from "../../../utils/foundryCamera";
import {
  gearTrainPitchRadii,
  sampledCamProfileScale,
} from "../../../utils/kinematics";
import { referenceRecipeForType } from "../../../utils/mechanismReference";
import { fitMechanismSimulation } from "../../../utils/mechanismPreview";
import { SCENE_PX_PER_MM } from "../../../utils/coordinates";
import { fittedGearTrainCenters } from "./foundryPreviewGeometry";

const mechanismReferenceTopologySummary = (type: MechanismType) => {
  if (type === "4bar")
    return "A-B input; B-C coupler; C-D output; D-A board-ground";
  if (type === "gear")
    return "fixed gear centers only; no rods; external mesh sequence";
  if (type === "gear_linkage")
    return "fixed gear centers; drive/output gear handle pins; two L4 links meet at shared R fastener";
  if (type === "cam")
    return "rotating cam profile; guided follower block; no linkage rods";
  if (type === "planetary_gear")
    return "fixed ring; sun input; planet on carrier; carrier output";
  if (type === "5bar")
    return "A-B-C-D-E closed chain; A-E board-ground; simulation-only";
  if (type === "6bar")
    return "A-B-C-D four-bar plus C-E-D dyad; simulation-only";
  if (type === "piston")
    return "crank-slider guide; slider-crank fabrication recipe";
  return `${type} simulation topology`;
};

export const MechanismLinkagePreview = ({
  mechanism,
  simulation,
  kit,
  testId,
  compact = false,
}: {
  mechanism: MechanismConfig;
  simulation: ReturnType<typeof fitMechanismSimulation>;
  kit: PhysicalKitSettings;
  testId: string;
  compact?: boolean;
}) => {
  const s = simulation.state;
  const r = compact ? 2.5 : 4;
  const depth = compact ? 2.2 : 5.5;
  const thicknessTestId = compact ? undefined : "foundry-material-thickness";
  const scaled = (length: number, min: number, max: number) =>
    Math.max(min, Math.min(max, length * simulation.scale));
  const test = (name: string) =>
    compact ? undefined : `foundry-mechanism-${name}`;
  const templateTest = compact
    ? undefined
    : `foundry-template-${mechanism.type}`;
  const fabricationTest = (name: string) =>
    compact ? undefined : `foundry-fabrication-${name}`;
  const radius = (
    length: number,
    min = compact ? 8 : 16,
    max = compact ? 28 : 58,
  ) => scaled(Math.max(1, length), min, max);
  const holeR = Math.max(
    compact ? 1.8 : 2.6,
    Math.min(
      compact ? 3.4 : 5.6,
      FABRICATION_HOLE_RADIUS_MM * SCENE_PX_PER_MM * simulation.scale,
    ),
  );
  const pitch = Math.max(
    holeR * 3.5,
    kit.gridPitchMm * SCENE_PX_PER_MM * simulation.scale,
  );
  const barWidth = Math.max(
    FABRICATION_LINKAGE_WIDTH_MM * SCENE_PX_PER_MM * simulation.scale,
    holeR * 3.5,
    compact ? 8 : 14,
  );
  const axisForAngle = (deg: number) => ({
    x: Math.cos(degToRad(deg)),
    y: -Math.sin(degToRad(deg)),
  });
  const trackAxis = axisForAngle(mechanism.groundAngle ?? 0);
  const normalAxis = { x: -trackAxis.y, y: trackAxis.x };
  const inputReferencePoint = mechanism.type === "cam" && s.aux ? s.aux : s.j1;
  const inputAngleDeg =
    (Math.atan2(
      inputReferencePoint.y - s.p1.y,
      inputReferencePoint.x - s.p1.x,
    ) *
      180) /
    Math.PI;
  const outputAngleDeg =
    (Math.atan2(s.j2.y - s.p2.y, s.j2.x - s.p2.x) * 180) / Math.PI;
  const isGearTrainPreview =
    mechanism.type === "gear" || mechanism.type === "gear_linkage";
  const previewGearRadii = isGearTrainPreview
    ? gearTrainPitchRadii(mechanism)
    : [];
  const previewGearCenters = isGearTrainPreview
    ? fittedGearTrainCenters(previewGearRadii, s.p1, s.p2)
    : [];
  const vectorAxis = (
    a: Point | undefined,
    b: Point | undefined,
    fallback = trackAxis,
  ) => {
    if (!a || !b) return fallback;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    return len > 0.5 ? { x: dx / len, y: dy / len } : fallback;
  };
  const link = (
    a: Point | undefined,
    b: Point | undefined,
    key: string,
    className = "mechanism-link",
    testIdName?: string,
  ) => {
    if (!a || !b) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 0.5) return null;
    const sceneLength = len / Math.max(0.0001, simulation.scale);
    const minHoleCount =
      key === "coupler"
        ? 4
        : key.includes("carrier") ||
            key === "frame" ||
            key === "driver" ||
            key === "output"
          ? 3
          : 2;
    const linkageSpec = fabricationLinkageSpecForSceneLength(
      sceneLength,
      kit.gridPitchMm,
      minHoleCount,
    );
    const templateLen =
      linkageSpec.lengthMm * SCENE_PX_PER_MM * simulation.scale;
    const outlineLen = templateLen + barWidth;
    const firstHoleX = linkageSpec.holeCentersMm[0]?.x ?? 0;
    const holeXs = linkageSpec.holeCentersMm.map(
      (point) =>
        (point.x - firstHoleX - linkageSpec.lengthMm / 2) *
        SCENE_PX_PER_MM *
        simulation.scale,
    );
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return (
      <g
        key={key}
        data-testid={testIdName ? test(testIdName) : undefined}
        className={`mechanism-part ${className}`}
        transform={`translate(${mid.x} ${mid.y}) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI})`}
      >
        <rect
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          x={-outlineLen / 2 + depth}
          y={-barWidth / 2 + depth}
          width={outlineLen}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          data-testid={fabricationTest("part")}
          className="mechanism-face"
          x={-outlineLen / 2}
          y={-barWidth / 2}
          width={outlineLen}
          height={barWidth}
          rx={barWidth / 2}
        />
        {holeXs.map((x, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={x}
            cy="0"
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const guideAxis = (
    center: Point,
    axis: Point,
    key: string,
    reach = compact ? 42 : 95,
    endStops = false,
  ) => {
    const len = Math.hypot(axis.x, axis.y) || 1;
    const ux = axis.x / len;
    const uy = axis.y / len;
    const start = { x: center.x - ux * reach, y: center.y - uy * reach };
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    return (
      <g
        key={key}
        data-testid={test("guide")}
        className="mechanism-part mechanism-frame"
        transform={`translate(${start.x} ${start.y}) rotate(${angle})`}
      >
        <rect
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          x={depth}
          y={-barWidth / 2 + depth}
          width={reach * 2}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          data-testid={fabricationTest("slot")}
          className="mechanism-face"
          x="0"
          y={-barWidth / 2}
          width={reach * 2}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          className="mechanism-slot"
          x={barWidth * 0.8}
          y={-holeR}
          width={Math.max(holeR * 2, reach * 2 - barWidth * 1.6)}
          height={holeR * 2}
          rx={holeR}
        />
        {endStops &&
          [0, reach * 2].map((x, index) => (
            <rect
              key={`stop-${index}`}
              data-testid={fabricationTest("end-stop")}
              className="mechanism-end-stop"
              x={x - holeR}
              y={-barWidth * 0.85}
              width={holeR * 2}
              height={barWidth * 1.7}
              rx={holeR * 0.45}
            />
          ))}
        {[0, reach * 2].map((x, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={x}
            cy="0"
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const guide = (center: Point, a: Point, b: Point, key: string) =>
    guideAxis(center, vectorAxis(a, b), key);
  const slotPlate = (
    center: Point,
    axis: Point,
    length: number,
    key: string,
    className = "mechanism-link",
    testIdName?: string,
  ) => {
    const len = Math.max(length, barWidth * 3);
    const angle = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
    return (
      <g
        key={key}
        data-testid={testIdName ? test(testIdName) : undefined}
        className={`mechanism-part ${className}`}
        transform={`translate(${center.x} ${center.y}) rotate(${angle})`}
      >
        <rect
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          x={-len / 2 + depth}
          y={-barWidth / 2 + depth}
          width={len}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          data-testid={fabricationTest("part")}
          className="mechanism-face"
          x={-len / 2}
          y={-barWidth / 2}
          width={len}
          height={barWidth}
          rx={barWidth / 2}
        />
        <rect
          data-testid={fabricationTest("slot")}
          className="mechanism-slot"
          x={-len / 2 + barWidth * 0.75}
          y={-holeR}
          width={len - barWidth * 1.5}
          height={holeR * 2}
          rx={holeR}
        />
        {[-len / 2, len / 2].map((x, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={x}
            cy="0"
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const pins = (
    mechanism.type === "cam" ? [s.p1, s.j2] : [s.p1, s.p2, s.j1, s.j2, s.aux]
  ).filter((point): point is Point => Boolean(point));
  const gear = (
    center: Point,
    length: number,
    className: string,
    key: string,
    min = compact ? 8 : 16,
    max = compact ? 34 : 62,
    rotation = 0,
  ) => {
    const pitchRadius = radius(length, min, max);
    const gearProfile = fabricationGearProfileForPitchRadius(
      pitchRadius,
      pitchRadius / SCENE_PX_PER_MM,
    );
    return (
      <g
        key={key}
        data-mechanism-gear-key={key}
        data-rotation-deg={rotation.toFixed(2)}
        className={`mechanism-gear-part ${className}`}
        transform={`translate(${center.x} ${center.y}) rotate(${rotation})`}
      >
        <path
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          transform={`translate(${depth} ${depth})`}
          d={gearPathD(pitchRadius)}
        />
        <path
          data-testid={fabricationTest("gear")}
          className="mechanism-gear-teeth mechanism-face"
          d={gearPathD(pitchRadius)}
        />
        <circle
          data-testid={fabricationTest("hole")}
          className="mechanism-hole axle-hole"
          cx="0"
          cy="0"
          r={holeR}
        />
        {gearProfile.attachmentHoleCenters.map((point, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={point.x}
            cy={point.y}
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const ringGear = (
    center: Point,
    length: number,
    className: string,
    key: string,
  ) => {
    const pitchRadius = radius(length, compact ? 18 : 34, compact ? 62 : 120);
    const ringProfile = fabricationRingGearProfileForPitchRadius(pitchRadius);
    return (
      <g
        key={key}
        data-mechanism-gear-key={key}
        className={`mechanism-gear-part ${className}`}
        transform={`translate(${center.x} ${center.y})`}
      >
        <path
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          transform={`translate(${depth} ${depth})`}
          d={fabricationRingGearPathD(pitchRadius)}
          fillRule="evenodd"
        />
        <path
          data-testid={fabricationTest("gear")}
          className="mechanism-gear-teeth mechanism-face"
          d={fabricationRingGearPathD(pitchRadius)}
          fillRule="evenodd"
        />
        {ringProfile.mountHoleCenters.map((point, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={point.x}
            cy={point.y}
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const rackPlate = (
    center: Point,
    axis: Point,
    length: number,
    key: string,
  ) => {
    const len = Math.max(length, barWidth * 6);
    const angle = (Math.atan2(axis.y, axis.x) * 180) / Math.PI;
    const toothCount = Math.max(
      8,
      Math.min(24, Math.round(len / Math.max(holeR * 2.4, 4))),
    );
    const step = len / toothCount;
    const teeth = Array.from({ length: toothCount }, (_, index) => {
      const x = -len / 2 + index * step;
      return `M ${x} ${-barWidth / 2} L ${x + step / 2} ${-barWidth / 2 - holeR * 1.2} L ${x + step} ${-barWidth / 2}`;
    }).join(" ");
    return (
      <g
        key={key}
        data-testid={test("rack")}
        className="mechanism-part mechanism-output"
        transform={`translate(${center.x} ${center.y}) rotate(${angle})`}
      >
        <rect
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          x={-len / 2 + depth}
          y={-barWidth / 2 + depth}
          width={len}
          height={barWidth}
          rx={barWidth / 5}
        />
        <rect
          data-testid={fabricationTest("rack")}
          className="mechanism-face"
          x={-len / 2}
          y={-barWidth / 2}
          width={len}
          height={barWidth}
          rx={barWidth / 5}
        />
        <path className="mechanism-rack-teeth" d={teeth} />
        <rect
          data-testid={fabricationTest("slot")}
          className="mechanism-slot"
          x={-len / 2 + barWidth * 0.8}
          y={-holeR}
          width={len - barWidth * 1.6}
          height={holeR * 2}
          rx={holeR}
        />
        {[-len / 2, 0, len / 2].map((x, index) => (
          <circle
            key={index}
            data-testid={fabricationTest("hole")}
            className="mechanism-hole"
            cx={x}
            cy="0"
            r={holeR}
          />
        ))}
      </g>
    );
  };
  const camProfile = (center: Point, length: number) => {
    const base = radius(length, compact ? 10 : 20, compact ? 34 : 66);
    const points = Array.from({ length: 42 }, (_, index) => {
      const angle = (index / 42) * Math.PI * 2;
      const lift = sampledCamProfileScale(angle, mechanism.camProfileSamples);
      return `${Math.cos(angle) * base * lift} ${Math.sin(angle) * base * lift}`;
    });
    return (
      <g
        key="cam-body"
        data-testid={fabricationTest("cam")}
        className="mechanism-part mechanism-cam"
        transform={`translate(${center.x} ${center.y}) rotate(${inputAngleDeg})`}
      >
        <path
          data-testid={thicknessTestId}
          className="mechanism-thickness"
          transform={`translate(${depth} ${depth})`}
          d={`M ${points.join(" L ")} Z`}
        />
        <path
          className="mechanism-cam-profile mechanism-face"
          d={`M ${points.join(" L ")} Z`}
        />
        <circle
          data-testid={fabricationTest("hole")}
          className="mechanism-hole axle-hole"
          cx="0"
          cy="0"
          r={holeR}
        />
        <circle className="mechanism-hole" cx={base * 0.45} cy="0" r={holeR} />
      </g>
    );
  };
  const followerBlock = (center: Point) => (
    <g
      key="follower"
      data-testid={fabricationTest("follower")}
      className="mechanism-part mechanism-output"
      transform={`translate(${center.x} ${center.y}) rotate(${(Math.atan2(normalAxis.y, normalAxis.x) * 180) / Math.PI})`}
    >
      <rect
        data-testid={thicknessTestId}
        className="mechanism-thickness"
        x={-barWidth * 1.35 + depth}
        y={-barWidth / 2 + depth}
        width={barWidth * 2.7}
        height={barWidth}
        rx={barWidth / 3}
      />
      <rect
        data-testid={fabricationTest("part")}
        className="mechanism-face"
        x={-barWidth * 1.35}
        y={-barWidth / 2}
        width={barWidth * 2.7}
        height={barWidth}
        rx={barWidth / 3}
      />
      <circle
        data-testid={fabricationTest("hole")}
        className="mechanism-hole"
        cx="0"
        cy="0"
        r={holeR}
      />
    </g>
  );
  const gearPreview = (mechanism.type === "gear" ||
    mechanism.type === "gear_linkage" ||
    mechanism.type === "planetary_gear" ||
    mechanism.type === "rack-pinion") && (
    <g data-testid={test("gear")}>
      {mechanism.type === "rack-pinion" && (
        <>
          {gear(
            s.p1,
            mechanism.crankLength,
            "mechanism-driver",
            "rack-pinion-gear",
            compact ? 8 : 16,
            compact ? 34 : 62,
            inputAngleDeg,
          )}
        </>
      )}
      {isGearTrainPreview && (
        <>
          {previewGearRadii.map((radiusValue, index) => {
            const isCoupledGear = previewGearRadii.length > 2 || index === 0;
            const ratio = isCoupledGear
              ? index === 0
                ? 1
                : ((index % 2 === 1 ? -1 : 1) * previewGearRadii[0]) /
                  radiusValue
              : 0;
            return gear(
              previewGearCenters[index] ?? (index === 0 ? s.p1 : s.p2),
              radiusValue,
              index === 0
                ? "mechanism-driver"
                : index === previewGearRadii.length - 1
                  ? "mechanism-link secondary"
                  : "mechanism-link",
              `gear-${index}`,
              compact ? 8 : 16,
              compact ? 34 : 62,
              inputAngleDeg * ratio +
                (index === previewGearRadii.length - 1
                  ? ((mechanism.phase ?? 0) * 180) / Math.PI
                  : 0),
            );
          })}
        </>
      )}
      {mechanism.type === "planetary_gear" && (
        <>
          {ringGear(
            s.p1,
            planetaryRingPitchRadius(mechanism),
            "mechanism-frame carrier",
            "ring",
          )}
          {gear(
            s.p1,
            mechanism.crankLength,
            "mechanism-driver",
            "sun",
            compact ? 7 : 12,
            compact ? 22 : 42,
            inputAngleDeg,
          )}
          {(() => {
            const planetCenters = [s.p2];
            const planetCount = Math.max(1, planetCenters.length);
            return planetCenters.map((center, index) =>
              gear(
                center,
                mechanism.rockerLength,
                "mechanism-link secondary",
                `planet-${index + 1}`,
                compact ? 7 : 12,
                compact ? 22 : 42,
                outputAngleDeg + index * (360 / planetCount),
              ),
            );
          })()}
        </>
      )}
    </g>
  );
  const links = (() => {
    if (mechanism.type === "crank")
      return [
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j1, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "4bar")
      return [
        link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j1, s.j2, "coupler", "mechanism-link", "link"),
        link(s.p2, s.j2, "rocker", "mechanism-link"),
      ];
    if (mechanism.type === "5bar")
      return [
        link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
        link(s.p1, s.j1, "driver-a", "mechanism-driver", "driver"),
        link(s.p2, s.aux, "driver-b", "mechanism-driver"),
        link(s.j1, s.j2, "rod-a", "mechanism-link", "link"),
        link(s.aux, s.j2, "rod-b", "mechanism-link"),
        link(s.j2, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "6bar")
      return [
        link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j1, s.j2, "coupler", "mechanism-link", "link"),
        link(s.p2, s.j2, "rocker", "mechanism-link"),
        link(s.j2, s.aux, "dyad", "mechanism-link"),
        link(s.p2, s.aux, "follower", "mechanism-output", "output"),
      ];
    if (mechanism.type === "piston")
      return [
        guideAxis(s.j2, trackAxis, "guide"),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j1, s.j2, "slider-link", "mechanism-link", "link"),
        link(s.j2, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "yoke")
      return [
        guideAxis(s.j2, trackAxis, "guide"),
        slotPlate(
          s.j2,
          normalAxis,
          radius(mechanism.crankLength, compact ? 28 : 54, compact ? 72 : 130),
          "yoke-slot",
          "mechanism-link",
          "link",
        ),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        link(s.j2, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "cam")
      return [
        guideAxis(s.j2, trackAxis, "guide"),
        camProfile(s.p1, mechanism.crankLength),
        followerBlock(s.j2),
      ];
    if (mechanism.type === "rack-pinion") {
      const rackAxis = vectorAxis(s.j2, s.effector, trackAxis);
      const rawInputAngle =
        ((-Math.atan2(s.j1.y - s.p1.y, s.j1.x - s.p1.x) % (Math.PI * 2)) +
          Math.PI * 2) %
        (Math.PI * 2);
      const travel =
        Math.max(1, mechanism.crankLength) *
        (rawInputAngle - Math.PI) *
        simulation.scale;
      const fixedGuideCenter = {
        x: s.j2.x - rackAxis.x * travel,
        y: s.j2.y - rackAxis.y * travel,
      };
      const rackVisualLength = radius(
        mechanism.rockerLength,
        compact ? 56 : 120,
        compact ? 160 : 340,
      );
      return [
        guideAxis(
          fixedGuideCenter,
          rackAxis,
          "guide",
          rackVisualLength / 2 +
            radius(mechanism.crankLength, compact ? 8 : 16, compact ? 34 : 62),
          true,
        ),
        rackPlate(s.j2, rackAxis, rackVisualLength, "rack"),
        link(s.p1, s.j1, "pinion-radius", "mechanism-driver", "driver"),
        link(s.j2, s.effector, "rack-output", "mechanism-output", "output"),
      ];
    }
    if (mechanism.type === "quick-return")
      return [
        link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
        link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
        slotPlate(
          { x: (s.p2.x + s.j2.x) / 2, y: (s.p2.y + s.j2.y) / 2 },
          vectorAxis(s.p2, s.j2),
          Math.hypot(s.j2.x - s.p2.x, s.j2.y - s.p2.y),
          "slotted-rocker",
          "mechanism-link",
          "link",
        ),
        link(s.j2, s.effector, "output", "mechanism-output", "output"),
      ];
    if (mechanism.type === "gear") return [];
    if (mechanism.type === "gear_linkage")
      return [
        link(
          s.j1,
          s.effector,
          "drive-l4-linkage",
          "mechanism-driver",
          "driver",
        ),
        link(
          s.j2,
          s.effector,
          "output-l4-linkage",
          "mechanism-output",
          "output",
        ),
        slotPlate(
          s.effector,
          vectorAxis(s.j2, s.effector),
          barWidth * 3.2,
          "output-bracket",
          "mechanism-output",
          "output",
        ),
      ];
    if (mechanism.type === "planetary_gear") {
      const planetCenters = [s.p2];
      return [
        ...planetCenters.map((center, index) =>
          link(
            s.p1,
            center,
            `carrier-${index + 1}`,
            "mechanism-driver",
            index === 0 ? "driver" : undefined,
          ),
        ),
        link(s.p2, s.effector, "carrier-output", "mechanism-output", "output"),
      ];
    }
    return [
      link(s.p1, s.p2, "frame", "mechanism-frame", "frame"),
      link(s.p1, s.j1, "driver", "mechanism-driver", "driver"),
      link(s.j1, s.j2, "coupler", "mechanism-link", "link"),
      link(s.j2, s.p2, "rocker", "mechanism-link"),
      link(s.j1, s.effector, "output", "mechanism-output", "output"),
    ];
  })();
  const referenceRecipe = referenceRecipeForType(mechanism.type);
  const referenceCoordRoles = referenceRecipe.assemblySteps
    .flatMap((step) =>
      step.coords.map(
        (coord, index) =>
          `${coord}:${step.coordRoles[index] ?? "moving_reference"}`,
      ),
    )
    .join("|");
  return (
    <g
      data-testid={testId}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      data-mechanism-type={mechanism.type}
      data-reference-canonical-key={referenceRecipe.canonicalKey}
      data-reference-topology={mechanismReferenceTopologySummary(
        mechanism.type,
      )}
      data-reference-stack-labels={referenceRecipe.stackLabels.join(" → ")}
      data-reference-coord-roles={referenceCoordRoles}
      data-reference-export-ready={
        referenceRecipe.exportReady ? "true" : "false"
      }
    >
      <g data-testid={templateTest}>
        {gearPreview}
        {links}
        {pins.map((point, i) => (
          <circle
            key={i}
            className="mechanism-pin"
            cx={point.x}
            cy={point.y}
            r={r}
          />
        ))}
        <circle
          data-testid={test("output-point")}
          className="mechanism-effector"
          cx={s.effector.x}
          cy={s.effector.y}
          r={r + 2}
        />
      </g>
    </g>
  );
};
