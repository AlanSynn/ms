import type {
  MechanismConfig,
  PhysicalKitSettings,
  Point,
} from '../../../types';
import { boardToScene, sceneToBoard } from '../../../utils/coordinates';
import type { MechanismPreviewSimulation } from '../../../utils/mechanismPreview';
import { clampMechanismParam } from '../mechanism/mechanismParamPolicy';

export type FoundryGestureHandleId = 'M' | 'A' | 'B' | 'C' | 'D';

type FoundryHandleGestureInput = {
  mechanism: MechanismConfig;
  handle: FoundryGestureHandleId;
  point: Point;
  simulation: Pick<MechanismPreviewSimulation, 'state' | 'scale'>;
  landing: Point;
  kit: PhysicalKitSettings;
};

export const foundryMechanismForHandleGesture = ({
  mechanism,
  handle,
  point,
  simulation,
  landing,
  kit,
}: FoundryHandleGestureInput): MechanismConfig => {
  const state = simulation.state;
  const scale = Math.max(0.001, simulation.scale);
  const sceneDistance = (a: Point, b: Point) =>
    Math.hypot(a.x - b.x, a.y - b.y) / scale;

  if (handle === 'M') {
    const unsnapped = {
      x: landing.x + (point.x - state.p1.x) / scale,
      y: landing.y - (point.y - state.p1.y) / scale,
    };
    const board = sceneToBoard(unsnapped, kit);
    const snapped = boardToScene(board.col, board.row, kit);
    return {
      ...mechanism,
      anchorX: snapped.x,
      anchorY: snapped.y,
      sceneAnchor: snapped,
      transform: {
        ...(mechanism.transform ?? {
          x: snapped.x,
          y: snapped.y,
          rotation: mechanism.groundAngle ?? 0,
          scale: 1,
        }),
        x: snapped.x,
        y: snapped.y,
      },
    };
  }
  if (handle === 'B') {
    return {
      ...mechanism,
      crankLength: clampMechanismParam(
        'crankLength',
        sceneDistance(state.p1, point),
      ),
    };
  }
  if (handle === 'D') {
    return {
      ...mechanism,
      groundLength: clampMechanismParam(
        'groundLength',
        sceneDistance(state.p1, point),
      ),
      groundAngle:
        (Math.atan2(point.y - state.p1.y, point.x - state.p1.x) * 180) /
        Math.PI,
    };
  }
  return {
    ...mechanism,
    couplerLength: clampMechanismParam(
      'couplerLength',
      sceneDistance(state.j1, point),
    ),
    rockerLength: clampMechanismParam(
      'rockerLength',
      sceneDistance(state.p2, point),
    ),
  };
};
