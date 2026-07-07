import type { CharacterAssemblyPlan } from '../../../utils/assemblyPlayback';
import { parseBoardCoordinateLabel } from '../../../utils/coordinates';

export type AssemblyPoint = { x: number; y: number };

export const ASSEMBLY_REFERENCE_OPACITY = 0.86;
export const ASSEMBLY_QUIET_OPACITY = 0.72;

export const assemblyCoordToSvg = (coord: string, boardCells = 15): AssemblyPoint | null => {
    const parsed = parseBoardCoordinateLabel(coord);
    if (!parsed || parsed.col >= boardCells || parsed.row >= boardCells) return null;
    return { x: 494 + parsed.col * 18, y: 142 + parsed.row * 18 };
};

export const smoothAssemblyProgress = (value: number) => {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
};

export const pointBounds = (points: AssemblyPoint[]) => {
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    return {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys)
    };
};

export const characterCanvasProjector = (plan: CharacterAssemblyPlan) => {
    const allPoints = plan.parts.flatMap(part => [...part.outline, part.pivot]);
    const bounds = allPoints.length ? pointBounds(allPoints) : { minX: -120, maxX: 120, minY: -160, maxY: 160, width: 240, height: 320 };
    const scale = Math.min(300 / Math.max(1, bounds.width), 360 / Math.max(1, bounds.height));
    const offsetX = 246 - (bounds.minX + bounds.width / 2) * scale;
    const offsetY = 286 - (bounds.minY + bounds.height / 2) * scale;
    return (point: AssemblyPoint) => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY });
};

const distance = (a: AssemblyPoint, b: AssemblyPoint) => Math.hypot(a.x - b.x, a.y - b.y);

export const characterBoardProjector = (plan: CharacterAssemblyPlan) => {
    const allPoints = plan.parts.flatMap(part => [...part.outline, part.pivot]);
    const bounds = allPoints.length ? pointBounds(allPoints) : { minX: -120, maxX: 120, minY: -160, maxY: 160, width: 240, height: 320 };
    const fitScale = Math.min(220 / Math.max(1, bounds.width), 248 / Math.max(1, bounds.height));
    const anchoredPins = plan.fixedPins
        .map(pin => ({ pin, board: pin.boardCoordinate ? assemblyCoordToSvg(pin.boardCoordinate, plan.boardCells) : null }))
        .filter((entry): entry is { pin: CharacterAssemblyPlan['fixedPins'][number]; board: AssemblyPoint } => Boolean(entry.board));
    const pair = anchoredPins.flatMap((first, firstIndex) =>
        anchoredPins.slice(firstIndex + 1).map(second => ({ first, second }))
    ).find(({ first, second }) => distance(first.pin.scene, second.pin.scene) > 1 && distance(first.board, second.board) > 1);
    if (pair) {
        const sceneAngle = Math.atan2(pair.second.pin.scene.y - pair.first.pin.scene.y, pair.second.pin.scene.x - pair.first.pin.scene.x);
        const boardAngle = Math.atan2(pair.second.board.y - pair.first.board.y, pair.second.board.x - pair.first.board.x);
        const scale = distance(pair.first.board, pair.second.board) / distance(pair.first.pin.scene, pair.second.pin.scene);
        const rotation = boardAngle - sceneAngle;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        return {
            anchorPinId: pair.first.pin.id,
            anchorBoardCoordinate: pair.first.pin.boardCoordinate,
            project: (point: AssemblyPoint) => {
                const x = (point.x - pair.first.pin.scene.x) * scale;
                const y = (point.y - pair.first.pin.scene.y) * scale;
                return {
                    x: pair.first.board.x + x * cos - y * sin,
                    y: pair.first.board.y + x * sin + y * cos
                };
            }
        };
    }
    const anchor = anchoredPins[0];
    if (anchor) {
        return {
            anchorPinId: anchor.pin.id,
            anchorBoardCoordinate: anchor.pin.boardCoordinate,
            project: (point: AssemblyPoint) => ({
                x: anchor.board.x + (point.x - anchor.pin.scene.x) * fitScale,
                y: anchor.board.y + (point.y - anchor.pin.scene.y) * fitScale
            })
        };
    }
    const offsetX = 618 - (bounds.minX + bounds.width / 2) * fitScale;
    const offsetY = 266 - (bounds.minY + bounds.height / 2) * fitScale;
    return {
        anchorPinId: undefined,
        anchorBoardCoordinate: undefined,
        project: (point: AssemblyPoint) => ({ x: point.x * fitScale + offsetX, y: point.y * fitScale + offsetY })
    };
};

export const svgPathFromPoints = (points: AssemblyPoint[], project: (point: AssemblyPoint) => AssemblyPoint) => {
    if (!points.length) return '';
    const projected = points.map(project);
    return `M ${projected[0].x.toFixed(1)} ${projected[0].y.toFixed(1)} ${projected.slice(1).map(point => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')} Z`;
};
