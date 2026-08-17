import type { MechanismConfig } from '../types';
import { isBoardFixedCoordRole } from './mechanismReference';
import { prefabAssemblySteps } from './fabricationRecipes';

export type BoardFixedAssemblyCoordinate = {
    stepIndex: number;
    coordinate: string;
    role: string;
    boardCoordinate: string;
};

const parseBoardCoordinate = (coordinate: string) => {
    const match = /^([A-O])([1-9]|1[0-5])$/.exec(coordinate);
    if (!match) return null;
    return { col: match[1].charCodeAt(0) - 65, row: Number(match[2]) - 1 };
};

export const isBoardCoordinateWithin = (coordinate: string | undefined, boardCells = 15) => {
    const point = coordinate ? parseBoardCoordinate(coordinate) : null;
    return Boolean(
        point &&
        point.col >= 0 &&
        point.row >= 0 &&
        point.col < boardCells &&
        point.row < boardCells,
    );
};

/**
 * Returns only holes that are fixed to the base board. Moving link, carrier,
 * slider, and gear-handle holes stay in the part-local/moving coordinate set.
 */
export const boardFixedAssemblyCoordinatesForMechanism = (
    mechanism: MechanismConfig,
    boardCoordinate: string,
    boardCells = 15,
): BoardFixedAssemblyCoordinate[] => prefabAssemblySteps(mechanism, boardCoordinate, boardCells).flatMap(step => {
    const coords = step.coords?.length ? step.coords : [step.boardCoordinate];
    const roles = step.coordRoles?.length ? step.coordRoles : [step.role];
    return coords.flatMap((coordinate, index) => {
        const role = roles[index] ?? step.role;
        return isBoardFixedCoordRole(role)
            ? [{ stepIndex: step.index, coordinate, role, boardCoordinate: step.boardCoordinate }]
            : [];
    });
});

export const offBoardFixedAssemblyCoordinatesForMechanism = (
    mechanism: MechanismConfig,
    boardCoordinate: string,
    boardCells = 15,
) => boardFixedAssemblyCoordinatesForMechanism(mechanism, boardCoordinate, boardCells)
    .filter(item => !isBoardCoordinateWithin(item.coordinate, boardCells));
