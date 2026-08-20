import type { MechanismConfig, Point } from "../../../types";
import type { MechanismPreviewSimulation } from "../../../utils/mechanismPreview";

type Segment = readonly [Point | undefined, Point | undefined];

const sketchSegments = (
  mechanism: MechanismConfig,
  simulation: MechanismPreviewSimulation,
): Segment[] => {
  const { p1, p2, j1, j2, aux, effector } = simulation.state;
  switch (mechanism.type) {
    case "gear":
      return [];
    case "gear_linkage":
      return [[j1, effector], [j2, effector]];
    case "crank":
      return [[p1, j1], [j1, effector]];
    case "5bar":
      return [[p1, p2], [p1, j1], [p2, aux], [j1, j2], [aux, j2], [j2, effector]];
    case "6bar":
      return [[p1, p2], [p1, j1], [j1, j2], [p2, j2], [j2, aux], [p2, aux]];
    case "planetary_gear":
      return [[p1, p2], [p2, effector]];
    default:
      return [[p1, p2], [p1, j1], [j1, j2], [p2, j2], [j2, effector]];
  }
};

const radius = (length: number, scale: number) =>
  Math.max(8, Math.min(28, Math.max(1, length) * scale));

export const RecommendationMechanismSketch = ({
  mechanism,
  simulation,
  testId,
}: {
  mechanism: MechanismConfig;
  simulation: MechanismPreviewSimulation;
  testId: string;
}) => {
  const state = simulation.state;
  const segments = sketchSegments(mechanism, simulation).filter(
    (segment): segment is readonly [Point, Point] => Boolean(segment[0] && segment[1]),
  );
  const pins = [state.p1, state.p2, state.j1, state.j2, state.aux].filter(
    (point): point is Point => Boolean(point),
  );
  const showGears = mechanism.type === "gear" || mechanism.type === "gear_linkage";

  return (
    <g
      data-testid={testId}
      data-mechanism-type={mechanism.type}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {showGears && (
        <g fill="rgba(245, 158, 11, 0.18)" stroke="#b45309" strokeWidth="2.5">
          <circle
            cx={state.p1.x}
            cy={state.p1.y}
            r={radius(mechanism.crankLength, simulation.scale)}
          />
          <circle
            cx={state.p2.x}
            cy={state.p2.y}
            r={radius(mechanism.rockerLength, simulation.scale)}
          />
        </g>
      )}
      <g stroke={mechanism.color} strokeWidth="7" fill="none" opacity="0.9">
        {segments.map(([a, b], index) => (
          <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        ))}
      </g>
      <g fill="#f8fafc" stroke="#334155" strokeWidth="2">
        {pins.map((point, index) => (
          <circle key={index} cx={point.x} cy={point.y} r="3" />
        ))}
      </g>
      <circle
        cx={state.effector.x}
        cy={state.effector.y}
        r="5"
        fill="#2563eb"
        stroke="#ffffff"
        strokeWidth="1.5"
      />
    </g>
  );
};
