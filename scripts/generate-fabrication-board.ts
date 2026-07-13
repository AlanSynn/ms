#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FABRICATION_BOARD_DEFAULT_CELL_COUNT,
  FABRICATION_BOARD_DEFAULT_HOLE_DIAMETER_MM,
  FABRICATION_BOARD_DEFAULT_PITCH_MM,
  makeFabricationBoardTemplateSpec,
  makeFabricationBoardTemplateSvg,
} from '../utils/fabricationBoardTemplate';

const isDefined = <T>(value: T | undefined): value is T => value !== undefined;

type Options = {
  outputPath: string;
  boardName: string;
  rows: number;
  columns: number;
  pitchMm: number;
  holeDiameterMm: number;
  profileKey: string;
};

const SCRIPT_PATH = 'scripts/generate-fabrication-board.ts';
const LEGACY_BOARD_FILES = ['board.svg', 'assembly/board.svg'];

const parseArgs = (): Options => {
  const args = process.argv.slice(2);
  const opts: Options = {
    outputPath: join(process.cwd(), 'fabrication'),
    boardName: 'board-final.svg',
    rows: FABRICATION_BOARD_DEFAULT_CELL_COUNT,
    columns: FABRICATION_BOARD_DEFAULT_CELL_COUNT,
    pitchMm: FABRICATION_BOARD_DEFAULT_PITCH_MM,
    holeDiameterMm: FABRICATION_BOARD_DEFAULT_HOLE_DIAMETER_MM,
    profileKey: 'motionsmith-ms4n',
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case '--output': {
        const next = args[index + 1];
        if (!isDefined(next)) throw new Error(`Missing value for ${arg}`);
        opts.outputPath = resolvePath(next, process.cwd());
        index += 1;
        break;
      }
      case '--name':
      case '--board-name': {
        const next = args[index + 1];
        if (!isDefined(next)) throw new Error(`Missing value for ${arg}`);
        opts.boardName = next;
        index += 1;
        break;
      }
      case '--rows':
        opts.rows = Number.parseInt(args[index + 1] ?? `${FABRICATION_BOARD_DEFAULT_CELL_COUNT}`, 10);
        index += 1;
        break;
      case '--cols':
      case '--columns':
        opts.columns = Number.parseInt(args[index + 1] ?? `${FABRICATION_BOARD_DEFAULT_CELL_COUNT}`, 10);
        index += 1;
        break;
      case '--pitch-mm':
        opts.pitchMm = Number.parseFloat(args[index + 1] ?? `${FABRICATION_BOARD_DEFAULT_PITCH_MM}`);
        index += 1;
        break;
      case '--hole-diameter-mm':
        opts.holeDiameterMm = Number.parseFloat(args[index + 1] ?? `${FABRICATION_BOARD_DEFAULT_HOLE_DIAMETER_MM}`);
        index += 1;
        break;
      case '--profile-key':
        if (!isDefined(args[index + 1])) throw new Error(`Missing value for ${arg}`);
        opts.profileKey = args[index + 1] ?? opts.profileKey;
        index += 1;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
      default:
        if (arg.startsWith('--')) {
          throw new Error(`Unknown flag ${arg}`);
        }
        printUsage();
        throw new Error(`Unknown positional argument ${arg}`);
    }
  }

  return {
    outputPath: opts.outputPath,
    boardName: opts.boardName,
    rows: Number.isFinite(opts.rows) && opts.rows > 0 ? Math.floor(opts.rows) : FABRICATION_BOARD_DEFAULT_CELL_COUNT,
    columns: Number.isFinite(opts.columns) && opts.columns > 0 ? Math.floor(opts.columns) : FABRICATION_BOARD_DEFAULT_CELL_COUNT,
    pitchMm: Number.isFinite(opts.pitchMm) && opts.pitchMm > 0 ? opts.pitchMm : FABRICATION_BOARD_DEFAULT_PITCH_MM,
    holeDiameterMm: Number.isFinite(opts.holeDiameterMm) && opts.holeDiameterMm > 0 ? opts.holeDiameterMm : FABRICATION_BOARD_DEFAULT_HOLE_DIAMETER_MM,
    profileKey: opts.profileKey ?? 'motionsmith-ms4n',
  };
};

const printUsage = () => {
  console.log('Usage: bun scripts/generate-fabrication-board.ts [--output <dir>] [--name <file>] [--rows <n>] [--columns <n>] [--pitch-mm <mm>] [--hole-diameter-mm <mm>] [--profile-key <key>]');
};

const resolvePath = (value: string, cwd: string) => {
  if (value.startsWith('/')) return value;
  if (value.startsWith('~')) return value.replace('~', process.env.HOME ?? '');
  return join(cwd, value);
};

const uniqSorted = (values: string[]) => [...new Set(values)];

const updateManifest = (manifestPath: string, boardPath: string) => {
  const payload = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
  const before = JSON.stringify(payload);

  const assembly = payload.assembly && typeof payload.assembly === 'object' ? payload.assembly as Record<string, unknown> : null;
  if (assembly) {
    assembly.board_map = boardPath;
    if (Array.isArray(assembly.files)) {
      const files = assembly.files as string[];
      for (let idx = files.length - 1; idx >= 0; idx -= 1) {
        if (LEGACY_BOARD_FILES.includes(files[idx])) {
          files[idx] = boardPath;
        }
      }
    }
  }

  if (Array.isArray(payload.managed_files)) {
    const managed = payload.managed_files as string[];
    for (let idx = managed.length - 1; idx >= 0; idx -= 1) {
      if (LEGACY_BOARD_FILES.includes(managed[idx])) {
        managed[idx] = boardPath;
      }
    }
    if (!managed.includes(boardPath)) managed.push(boardPath);
    payload.managed_files = uniqSorted(managed);
  }

  const after = JSON.stringify(payload);
  if (before === after) return;
  writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`);
};

const main = () => {
  const opts = parseArgs();
  const boardSpec = makeFabricationBoardTemplateSpec({
    rows: opts.rows,
    columns: opts.columns,
    pitchMm: opts.pitchMm,
    holeDiameterMm: opts.holeDiameterMm,
    profileKey: opts.profileKey,
    role: 'main-board',
    title: `MotionSmith ${opts.rows}x${opts.columns} main board`,
    description: 'Main fabrication board with 4 mm holes and engraved A-O / 1-15 coordinates.',
  });

  const svg = makeFabricationBoardTemplateSvg({
    ...boardSpec,
    title: `MotionSmith ${opts.rows}x${opts.columns} main board`,
    description: 'Main fabrication board with 4 mm holes and engraved A-O / 1-15 coordinates.',
  });
  const output = opts.outputPath;
  if (!existsSync(output)) mkdirSync(output, { recursive: true });
  const boardOutputPath = join(output, opts.boardName);
  writeFileSync(boardOutputPath, `${svg}\n`);

  const manifestPath = join(output, 'manifest.json');
  const boardRelPath = opts.boardName.includes('/') ? opts.boardName : `${opts.boardName}`;
  if (existsSync(manifestPath)) {
    updateManifest(manifestPath, boardRelPath);
  }

  const rows = boardSpec.rows;
  const columns = boardSpec.columns;
  process.stdout.write(JSON.stringify({
    generated: boardOutputPath,
    board_rel_path: boardRelPath,
    rows,
    columns,
    pitch_mm: boardSpec.pitchMm,
    hole_diameter_mm: boardSpec.holeDiameterMm,
    source: SCRIPT_PATH,
  }) + '\n');
};

main();
