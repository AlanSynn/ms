#!/usr/bin/env bun
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  FABRICATION_RING_GEAR_SPEC,
  FABRICATION_SPACER_SPEC,
  FABRICATION_SOURCE_BOARD_TS,
  FABRICATION_SOURCE_PYTHON_TEMPLATES,
  FABRICATION_SOURCE_SSOT,
} from '../utils/fabricationContract';
import {
  fabricationGearPathD,
  fabricationRingGearPathD,
  fabricationGearProfileForPitchRadius,
  fabricationRingGearProfileForPitchRadius,
} from '../utils/fabricationProfiles';

const cwd = process.cwd();
const reportDate = new Date().toISOString().split('T')[0];

type Json = Record<string, unknown>;

type Manifest = {
  generated_by?: string;
  source_ssot?: string;
  board_rows?: number;
  board_columns?: number;
  grid_pitch_mm?: number;
  hole_diameter_mm?: number;
  managed_files?: string[];
  assembly?: {
    board_map?: string;
    files?: string[];
    guide_files?: string[];
    recipes_source?: string;
    schema_version?: string;
  };
  parts?: Json;
  [key: string]: unknown;
};

type FileDiff = {
  path: string;
  status: 'exact' | 'missing-in-committed' | 'missing-in-generated' | 'content-mismatch';
  reason?: string;
};

type CategoryCoverage = {
  strategy: 'full-svg-generation' | 'metadata-only' | 'not-implemented';
  status: 'covered' | 'partial' | 'not-covered';
  generatedBy?: string;
  notes?: string;
};

type CategoryAudit = {
  category: string;
  python: {
    fileCount: number;
    filePaths: string[];
  };
  ts: CategoryCoverage;
  parity: {
    metadataMatch?: boolean;
    notes?: string;
    boardMatched?: boolean;
    generatedFileCountExact?: boolean;
    boardMapMatch?: boolean;
  };
  recommendation: string;
};

type AuditResult = {
  generatedAt: string;
  paths: {
    pythonOutputDir: string;
    tsBoardOutputDir: string;
    pythonManifestPath: string;
    committedManifestPath: string;
    reportJsonPath: string;
    reportMarkdownPath: string;
  };
  checks: {
    pythonManifestLoaded: boolean;
    committedManifestLoaded: boolean;
    pythonGenerated: boolean;
    managedFileSetExact: boolean;
    manifestMetaMatch: boolean;
    boardCoordinateParity: {
      status: 'ok' | 'blocked';
      details: string;
      pythonHoleCount: number;
      committedHoleCount: number;
    };
    tsBoardGenerated: boolean;
    tsBoardExactMatchCommitted: boolean;
    tsBoardCoordinateParity: {
      status: 'ok' | 'blocked';
      details: string;
      tsHoleCount: number;
      committedHoleCount: number;
    };
  };
  fileDiffs: {
    exact: number;
    mismatched: FileDiff[];
    missingInCommitted: FileDiff[];
    missingInGenerated: FileDiff[];
  };
  mechanismCoverage: CategoryAudit[];
  recommendations: string[];
  hardFailures: string[];
};

const roundPoint = (value: number) => Math.round(value * 1000) / 1000;

const boardHoleRecord = (svg: string) =>
  [...svg.matchAll(/<circle\b[^>]*>/g)]
    .map((match) => {
      const tag = match[0];
      const coord = tag.match(/\bdata-board-coord="([^"]+)"/)?.[1];
      const cx = Number(tag.match(/\bcx="([^"]+)"/)?.[1]);
      const cy = Number(tag.match(/\bcy="([^"]+)"/)?.[1]);
      const r = Number(tag.match(/\br="([^"]+)"/)?.[1]);
      if (!coord || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return null;
      return { coord, cx: roundPoint(cx), cy: roundPoint(cy), r: roundPoint(r) };
    })
    .filter((entry): entry is { coord: string; cx: number; cy: number; r: number } => Boolean(entry))
    .sort((left, right) => left.coord.localeCompare(right.coord));

const holeSignature = (svg: string) => boardHoleRecord(svg).map((entry) => `${entry.coord}:${entry.cx},${entry.cy},${entry.r}`).join('|');

const parseManifest = (path: string): Manifest => {
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
};

const safeReadText = (path: string): string => {
  if (!existsSync(path)) {
    throw new Error(`Missing file ${path}`);
  }
  return readFileSync(path, 'utf8');
};

const normalizeCategory = (path: string) => {
  if (path === 'board-final.svg') return 'board';
  if (path === 'README.md') return 'root-readme';
  if (!path.includes('/')) return 'misc-root';
  const top = path.split('/')[0];
  return top;
};

const categoryListFromManifest = (manifest: Manifest) => {
  const grouped: Record<string, string[]> = {};
  for (const item of manifest.managed_files ?? []) {
    const bucket = normalizeCategory(item);
    if (!grouped[bucket]) grouped[bucket] = [];
    grouped[bucket].push(item);
  }
  return Object.fromEntries(Object.entries(grouped).map(([cat, files]) => [cat, files.sort()]));
};

const compareManagedFiles = (committedManifest: Manifest, generatedManifest: Manifest, committedRoot: string, generatedRoot: string) => {
  const committedSet = new Set(committedManifest.managed_files ?? []);
  const generatedSet = new Set(generatedManifest.managed_files ?? []);
  const mismatched: FileDiff[] = [];
  const missingInCommitted: FileDiff[] = [];
  const missingInGenerated: FileDiff[] = [];
  const exact: FileDiff[] = [];

  for (const filePath of Array.from(generatedSet).sort()) {
    const absCommitted = join(committedRoot, filePath);
    const absGenerated = join(generatedRoot, filePath);
    if (!committedSet.has(filePath)) {
      missingInCommitted.push({ path: filePath, status: 'missing-in-committed', reason: 'Python-generated file not declared in committed manifest managed_files' });
      continue;
    }
    try {
      const left = safeReadText(absCommitted);
      const right = safeReadText(absGenerated);
      if (left === right) exact.push({ path: filePath, status: 'exact' });
      else mismatched.push({ path: filePath, status: 'content-mismatch', reason: 'Python output differs from committed output bytes' });
    } catch (error) {
      missingInGenerated.push({
        path: filePath,
        status: 'missing-in-generated',
        reason: error instanceof Error ? error.message : `${error}`,
      });
    }
  }

  for (const filePath of Array.from(committedSet).sort()) {
    if (!generatedSet.has(filePath)) {
      missingInGenerated.push({ path: filePath, status: 'missing-in-generated', reason: 'Committed manifest file not regenerated by Python' });
    }
  }

  return {
    exact,
    mismatched,
    missingInCommitted,
    missingInGenerated,
    exactCount: exact.length,
  };
};

const normalizePointPairs = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return [NaN, NaN];
    return [Number(entry[0]), Number(entry[1])];
  }).filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => point.map((axis) => roundPoint(axis)));
};

const jsonDeepEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const tsCoverageForCategory = (): Record<string, CategoryCoverage> => ({
  board: {
    strategy: 'full-svg-generation',
    status: 'covered',
    generatedBy: FABRICATION_SOURCE_BOARD_TS,
    notes: 'board-final.svg is produced by TypeScript generator in-repo.',
  },
  gears: {
    strategy: 'metadata-only',
    status: 'partial',
    generatedBy: FABRICATION_SOURCE_SSOT,
    notes: 'Runtime constants mirror Python-authored geometry specs; no dedicated TypeScript SVG factory exists yet.',
  },
  linkages: {
    strategy: 'metadata-only',
    status: 'partial',
    generatedBy: FABRICATION_SOURCE_SSOT,
    notes: 'Runtime constants mirror Python-authored geometry specs; no dedicated TypeScript SVG factory exists yet.',
  },
  ring_gears: {
    strategy: 'metadata-only',
    status: 'partial',
    generatedBy: FABRICATION_SOURCE_SSOT,
    notes: 'Runtime constants mirror Python-authored geometry specs; no dedicated TypeScript SVG factory exists yet.',
  },
  spacers: {
    strategy: 'metadata-only',
    status: 'partial',
    generatedBy: FABRICATION_SOURCE_SSOT,
    notes: 'Runtime constants mirror Python-authored geometry specs; no dedicated TypeScript SVG factory exists yet.',
  },
  cams: {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'No TypeScript generator path mapped for cam SVG outputs.',
  },
  followers: {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'No TypeScript generator path mapped for follower SVG outputs.',
  },
  brackets: {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'No TypeScript generator path mapped for bracket SVG outputs.',
  },
  cam_modules: {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'No TypeScript generator path mapped for cam module SVG outputs.',
  },
  sheets: {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'No TypeScript generator path mapped for cut-sheet SVG outputs.',
  },
  assembly: {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'No TypeScript generator path mapped for assembly artifacts.',
  },
  'root-readme': {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'README.md is documentation contract, not generation output.',
  },
  'misc-root': {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'Misc root-level file paths have no TypeScript generator yet.',
  },
});

const buildMechanismCoverage = (pythonManifest: Manifest): CategoryAudit[] => {
  const grouped = categoryListFromManifest(pythonManifest);
  const categories = Object.keys(grouped).sort();
  const coverage = tsCoverageForCategory();

  const byCategory = (category: string): CategoryCoverage => coverage[category] ?? {
    strategy: 'not-implemented',
    status: 'not-covered',
    notes: 'No parity strategy registered for this category.',
  };

  return categories.map((category) => {
    const files = grouped[category] ?? [];
    const ts = byCategory(category);
    const result: CategoryAudit = {
      category,
      python: {
        fileCount: files.length,
        filePaths: files,
      },
      ts,
      parity: {},
      recommendation: ts.status === 'covered'
        ? 'Already parity-covered in TS artifacts.'
        : 'Parity gap: require a TS source generator or explicit adapter to claim full 1:1 parity for this category.',
    };

    if (category === 'gears') {
      const canonical = FABRICATION_GEAR_SPECS.map((spec) => ({
        key: spec.key,
        path: spec.path,
        teeth: spec.teeth,
        pitchRadiusMm: spec.pitchRadiusMm,
        outerRadiusMm: spec.outerRadiusMm,
        rootRadiusMm: spec.rootRadiusMm,
        holeDiameterMm: spec.holeDiameterMm,
        label: spec.label,
        attachmentHoleCentersMm: spec.attachmentHoleCentersMm.map((point) => [point.x, point.y]),
      }));
      const manifestGeared = Array.isArray(pythonManifest.parts?.gears)
        ? pythonManifest.parts.gears.map((spec) => ({
          key: spec.key,
          path: spec.path,
          teeth: spec.teeth,
          pitchRadiusMm: spec.pitch_radius_mm,
          outerRadiusMm: spec.outer_radius_mm,
          rootRadiusMm: spec.root_radius_mm,
          holeDiameterMm: spec.hole_diameter_mm,
          label: spec.label,
          attachmentHoleCentersMm: normalizePointPairs(spec.attachment_hole_centers_mm),
        }))
        : [];
      const matched = jsonDeepEqual(canonical, manifestGeared);
      result.parity = {
        metadataMatch: matched,
        notes: matched
          ? 'Python geometry metadata and TS constants are aligned for gears.'
          : 'Gear metadata mismatch: verify FABRICATION_GEAR_SPECS or committed manifest canonical geometry contract.',
      };
    }

    if (category === 'linkages') {
      const canonical = FABRICATION_LINKAGE_SPECS.map((spec) => ({
        key: spec.key,
        path: spec.path,
        cells: spec.cells,
        lengthMm: spec.lengthMm,
        pitchMm: spec.pitchMm,
        holeDiameterMm: spec.holeDiameterMm,
        label: spec.label,
      }));
      const manifestLinkages = Array.isArray(pythonManifest.parts?.linkages)
        ? (pythonManifest.parts.linkages as Array<Record<string, unknown>>).map((spec) => ({
          key: spec.key,
          path: spec.path,
          cells: spec.cells,
          lengthMm: spec.length_mm,
          pitchMm: spec.pitch_mm,
          holeDiameterMm: spec.hole_diameter_mm,
          label: spec.label,
        }))
        : [];
      const matched = jsonDeepEqual(canonical, manifestLinkages);
      result.parity = {
        metadataMatch: matched,
        notes: matched
          ? 'Python linkage geometry metadata and TS constants are aligned.'
          : 'Linkage metadata mismatch: verify spec constants and manifest field naming.',
      };
    }

    if (category === 'ring_gears') {
      const manifestRecord = Array.isArray(pythonManifest.parts?.ring_gears) && pythonManifest.parts.ring_gears[0]
        ? (pythonManifest.parts.ring_gears[0] as Record<string, unknown>)
        : null;
      const canonical = {
        key: FABRICATION_RING_GEAR_SPEC.key,
        path: FABRICATION_RING_GEAR_SPEC.path,
        compatibleSunTeeth: FABRICATION_RING_GEAR_SPEC.compatibleSunTeeth,
        compatiblePlanetTeeth: FABRICATION_RING_GEAR_SPEC.compatiblePlanetTeeth,
        internalTeeth: FABRICATION_RING_GEAR_SPEC.internalTeeth,
        pitchRadiusMm: FABRICATION_RING_GEAR_SPEC.pitchRadiusMm,
        innerTipRadiusMm: FABRICATION_RING_GEAR_SPEC.innerTipRadiusMm,
        innerRootRadiusMm: FABRICATION_RING_GEAR_SPEC.innerRootRadiusMm,
        outerRadiusMm: FABRICATION_RING_GEAR_SPEC.outerRadiusMm,
        mountRadiusMm: FABRICATION_RING_GEAR_SPEC.mountRadiusMm,
        holeDiameterMm: FABRICATION_RING_GEAR_SPEC.holeDiameterMm,
      };
      const manifestRing = manifestRecord ? {
        key: manifestRecord.key,
        path: manifestRecord.path,
        compatibleSunTeeth: manifestRecord.compatible_sun_teeth,
        compatiblePlanetTeeth: manifestRecord.compatible_planet_teeth,
        internalTeeth: manifestRecord.internal_teeth,
        pitchRadiusMm: manifestRecord.pitch_radius_mm,
        innerTipRadiusMm: manifestRecord.inner_tip_radius_mm,
        innerRootRadiusMm: manifestRecord.inner_root_radius_mm,
        outerRadiusMm: manifestRecord.outer_radius_mm,
        mountRadiusMm: manifestRecord.mount_radius_mm,
        holeDiameterMm: manifestRecord.hole_diameter_mm,
      } : null;
      const matched = jsonDeepEqual(canonical, manifestRing);
      result.parity = {
        metadataMatch: matched,
        notes: matched
          ? 'Python ring-gear geometry metadata and TS constants are aligned.'
          : 'Ring gear metadata mismatch: verify ring-gear spec constants.',
      };
    }

    if (category === 'spacers') {
      const canonical = {
        key: FABRICATION_SPACER_SPEC.key,
        path: FABRICATION_SPACER_SPEC.path,
        outerDiameterMm: FABRICATION_SPACER_SPEC.outerDiameterMm,
        innerDiameterMm: FABRICATION_SPACER_SPEC.innerDiameterMm,
        holeDiameterMm: FABRICATION_SPACER_SPEC.holeDiameterMm,
        stackable: FABRICATION_SPACER_SPEC.stackable,
      };
      const manifestRecord = Array.isArray(pythonManifest.parts?.spacers) && pythonManifest.parts.spacers[0]
        ? (pythonManifest.parts.spacers[0] as Record<string, unknown>)
        : null;
      const manifestSpacer = manifestRecord ? {
        key: manifestRecord.key,
        path: manifestRecord.path,
        outerDiameterMm: manifestRecord.outer_diameter_mm,
        innerDiameterMm: manifestRecord.inner_diameter_mm,
        holeDiameterMm: manifestRecord.hole_diameter_mm,
        stackable: manifestRecord.stackable,
      } : null;
      const matched = jsonDeepEqual(canonical, manifestSpacer);
      result.parity = {
        metadataMatch: matched,
        notes: matched
          ? 'Python spacer metadata and TS constants are aligned.'
          : 'Spacer metadata mismatch: verify spacer spec constants and manifest payload.',
      };
    }

    if (category === 'assembly') {
      const assembly = (pythonManifest.assembly ?? {}) as Record<string, unknown>;
      result.parity = {
        boardMapMatch: assembly.board_map === 'board-final.svg',
        notes: `Python assembly board_map=${String(assembly.board_map ?? '')}`,
      };
    }

    return result;
  });
};

const buildMarkdown = (result: AuditResult) => {
  const lines: string[] = [];
  lines.push('# Fabrication 1:1 parity trace');
  lines.push('');
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push('');
  lines.push('## Checks');
  lines.push(`- python generation manifest loaded: ${result.checks.pythonManifestLoaded ? '✅' : '❌'}`);
  lines.push(`- committed manifest loaded: ${result.checks.committedManifestLoaded ? '✅' : '❌'}`);
  lines.push(`- managed file set 1:1: ${result.checks.managedFileSetExact ? '✅' : '❌'}`);
  lines.push(`- manifest metadata parity: ${result.checks.manifestMetaMatch ? '✅' : '❌'}`);
  lines.push(`- board coordinate parity (python vs committed): ${result.checks.boardCoordinateParity.status === 'ok' ? '✅' : '❌'} (${result.checks.boardCoordinateParity.pythonHoleCount} / ${result.checks.boardCoordinateParity.committedHoleCount})`);
  lines.push(`- TS board generated: ${result.checks.tsBoardGenerated ? '✅' : '❌'}`);
  lines.push(`- TS board exact vs committed: ${result.checks.tsBoardExactMatchCommitted ? '✅' : '❌'} (${result.checks.tsBoardCoordinateParity.tsHoleCount} / ${result.checks.tsBoardCoordinateParity.committedHoleCount})`);
  lines.push(`- TS board coordinate parity: ${result.checks.tsBoardCoordinateParity.status === 'ok' ? '✅' : '❌'}`);
  lines.push('');
  lines.push('## Hard failures');
  if (result.hardFailures.length === 0) lines.push('- none');
  else result.hardFailures.forEach((line) => lines.push(`- ${line}`));
  lines.push('');

  lines.push('## File-level parity');
  lines.push(`- exact: ${result.fileDiffs.exact}`);
  lines.push(`- mismatched: ${result.fileDiffs.mismatched.length}`);
  lines.push(`- missing in committed: ${result.fileDiffs.missingInCommitted.length}`);
  lines.push(`- missing in generated: ${result.fileDiffs.missingInGenerated.length}`);

  if (result.fileDiffs.mismatched.length) {
    lines.push('');
    lines.push('### Mismatch details');
    for (const item of result.fileDiffs.mismatched) lines.push(`- ${item.path}: ${item.reason ?? 'mismatch'}`);
  }
  if (result.fileDiffs.missingInCommitted.length) {
    lines.push('');
    lines.push('### Missing in committed manifest');
    for (const item of result.fileDiffs.missingInCommitted) lines.push(`- ${item.path}: ${item.reason}`);
  }
  if (result.fileDiffs.missingInGenerated.length) {
    lines.push('');
    lines.push('### Missing in generated output');
    for (const item of result.fileDiffs.missingInGenerated) lines.push(`- ${item.path}: ${item.reason}`);
  }

  lines.push('');
  lines.push('## Mechanism-category parity matrix');
  lines.push('| category | python file count | ts strategy | ts coverage | metadata match | recommendation |');
  lines.push('|---|---:|---|---|---|---|');
  for (const row of result.mechanismCoverage) {
    const metadata = row.parity.metadataMatch === undefined ? 'N/A' : row.parity.metadataMatch ? '✅' : '⚠️';
    lines.push(`| ${row.category} | ${row.python.fileCount} | ${row.ts.strategy} | ${row.ts.status} | ${metadata} | ${row.recommendation} |`);
  }

  lines.push('');
  lines.push('## Recommendations');
  if (!result.recommendations.length) lines.push('- none');
  else result.recommendations.forEach((rec) => lines.push(`- ${rec}`));

  return `${lines.join('\n')}\n`;
};

const readSvgAndCount = (path: string) => {
  const text = safeReadText(path);
  const circles = boardHoleRecord(text);
  return { text, count: circles.length, signature: holeSignature(text) };
};

const main = () => {
  const reportDir = join(cwd, 'docs', 'analysis');
  const pythonOut = mkdtempSync(join(tmpdir(), `ms-fab-python-${Date.now()}-`));
  const tsBoardOut = mkdtempSync(join(tmpdir(), `ms-fab-ts-board-${Date.now()}-`));

  const result: AuditResult = {
    generatedAt: new Date().toISOString(),
    paths: {
      pythonOutputDir: pythonOut,
      tsBoardOutputDir: tsBoardOut,
      pythonManifestPath: join(pythonOut, 'manifest.json'),
      committedManifestPath: join(cwd, 'fabrication', 'manifest.json'),
      reportJsonPath: join(reportDir, `fabrication-parity-${reportDate}.json`),
      reportMarkdownPath: join(reportDir, `fabrication-parity-${reportDate}.md`),
    },
    checks: {
      pythonManifestLoaded: false,
      committedManifestLoaded: false,
      pythonGenerated: false,
      managedFileSetExact: false,
      manifestMetaMatch: false,
      boardCoordinateParity: { status: 'blocked', details: 'not run', pythonHoleCount: 0, committedHoleCount: 0 },
      tsBoardGenerated: false,
      tsBoardExactMatchCommitted: false,
      tsBoardCoordinateParity: { status: 'blocked', details: 'not run', tsHoleCount: 0, committedHoleCount: 0 },
    },
    fileDiffs: {
      exact: 0,
      mismatched: [],
      missingInCommitted: [],
      missingInGenerated: [],
    },
    mechanismCoverage: [],
    recommendations: [],
    hardFailures: [],
  };

  const writeReport = (forceFail = false) => {
    writeFileSync(result.paths.reportJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    writeFileSync(result.paths.reportMarkdownPath, buildMarkdown(result), 'utf8');
    if (forceFail) process.exitCode = 1;
  };

  try {
    // Step 1: regenerate everything from Python
    execSync(`python3 fabrication/generate_fabrication_templates.py --output ${pythonOut}`, {
      cwd,
      stdio: 'pipe',
    });
    result.checks.pythonGenerated = true;

    const pythonManifest = parseManifest(result.paths.pythonManifestPath);
    const committedManifest = parseManifest(result.paths.committedManifestPath);
    result.checks.pythonManifestLoaded = true;
    result.checks.committedManifestLoaded = true;

    // Step 2: full managed-file parity (path+content)
    const fileSetDiff = compareManagedFiles(committedManifest, pythonManifest, join(cwd, 'fabrication'), pythonOut);
    result.fileDiffs = {
      exact: fileSetDiff.exactCount,
      mismatched: fileSetDiff.mismatched,
      missingInCommitted: fileSetDiff.missingInCommitted,
      missingInGenerated: fileSetDiff.missingInGenerated,
    };

    const meta = {
      generated_by: pythonManifest.generated_by,
      source_ssot: pythonManifest.source_ssot,
      board_rows: pythonManifest.board_rows,
      board_columns: pythonManifest.board_columns,
      grid_pitch_mm: pythonManifest.grid_pitch_mm,
      hole_diameter_mm: pythonManifest.hole_diameter_mm,
      managed_file_count: Array.isArray(pythonManifest.managed_files) ? pythonManifest.managed_files.length : null,
    };
    const committedMeta = {
      generated_by: committedManifest.generated_by,
      source_ssot: committedManifest.source_ssot,
      board_rows: committedManifest.board_rows,
      board_columns: committedManifest.board_columns,
      grid_pitch_mm: committedManifest.grid_pitch_mm,
      hole_diameter_mm: committedManifest.hole_diameter_mm,
      managed_file_count: Array.isArray(committedManifest.managed_files) ? committedManifest.managed_files.length : null,
    };
    result.checks.manifestMetaMatch = jsonDeepEqual(meta, committedMeta);
    if (!result.checks.manifestMetaMatch) {
      result.hardFailures.push('Python manifest metadata drifted from committed manifest (key generation and geometry fields differ).');
    }
    if ((pythonManifest.source_ssot ?? FABRICATION_SOURCE_PYTHON_TEMPLATES) !== FABRICATION_SOURCE_PYTHON_TEMPLATES) {
      result.recommendations.push(`Manifest source_ssot is not ${FABRICATION_SOURCE_PYTHON_TEMPLATES}; confirm generator provenance policy.`);
    }

    // Step 3: board coordinate parity between python regen and committed
    const committedBoard = readSvgAndCount(join(cwd, 'fabrication', 'board-final.svg'));
    const pythonBoard = readSvgAndCount(join(pythonOut, 'board-final.svg'));
    const boardMismatchIdx = result.fileDiffs.mismatched.findIndex((entry) => entry.path === 'board-final.svg');
    if (boardMismatchIdx >= 0) {
      if (pythonBoard.signature === committedBoard.signature) {
        result.fileDiffs.mismatched.splice(boardMismatchIdx, 1);
        result.fileDiffs.exact += 1;
      } else {
        result.fileDiffs.exact = Math.max(0, result.fileDiffs.exact);
      }
    }

    result.checks.managedFileSetExact = !result.fileDiffs.missingInCommitted.length && !result.fileDiffs.missingInGenerated.length && !result.fileDiffs.mismatched.length;
    if (!result.checks.managedFileSetExact) {
      result.hardFailures.push('Python manifest-managed-files set is not 1:1 with committed.');
    }

    result.checks.boardCoordinateParity.pythonHoleCount = pythonBoard.count;
    result.checks.boardCoordinateParity.committedHoleCount = committedBoard.count;
    if (pythonBoard.signature === committedBoard.signature) {
      result.checks.boardCoordinateParity = {
        status: 'ok',
        details: 'Board coordinate signatures match exactly.',
        pythonHoleCount: pythonBoard.count,
        committedHoleCount: committedBoard.count,
      };
    } else {
      result.checks.boardCoordinateParity = {
        status: 'blocked',
        details: 'Board coordinate signatures differ between python output and committed board-final.svg.',
        pythonHoleCount: pythonBoard.count,
        committedHoleCount: committedBoard.count,
      };
      result.hardFailures.push('Python-generated board does not match committed board-final.svg by hole coordinates.');
    }

    // Step 4: TS board generation check
    try {
      execSync(`bun scripts/generate-fabrication-board.ts --output ${tsBoardOut}`, {
        cwd,
        stdio: 'pipe',
      });
      result.checks.tsBoardGenerated = true;
    } catch (error) {
      result.hardFailures.push(`TS board generation failed: ${error instanceof Error ? error.message : `${error}`}`);
    }

    if (result.checks.tsBoardGenerated) {
      const tsBoard = readSvgAndCount(join(tsBoardOut, 'board-final.svg'));
      const committedBoardText = committedBoard.text;
      const tsBoardText = safeReadText(join(tsBoardOut, 'board-final.svg'));
      const sameText = committedBoardText === tsBoardText;
      result.checks.tsBoardExactMatchCommitted = sameText;
      result.checks.tsBoardCoordinateParity.tsHoleCount = tsBoard.count;
      result.checks.tsBoardCoordinateParity.committedHoleCount = committedBoard.count;
      if (sameText) {
        result.checks.tsBoardCoordinateParity = {
          status: 'ok',
          details: 'TS board text is byte-identical to committed artifact.',
          tsHoleCount: tsBoard.count,
          committedHoleCount: committedBoard.count,
        };
      } else if (tsBoard.signature === parseBoardDataSignature(committedBoard.text)) {
        result.checks.tsBoardCoordinateParity.status = 'ok';
        result.checks.tsBoardCoordinateParity.details = 'TS board hole coordinate signature matches; visual/text metadata differs only in non-coordinate surface text.';
      } else {
        result.checks.tsBoardCoordinateParity.status = 'blocked';
        result.checks.tsBoardCoordinateParity.details = 'TS board hole coordinate signature differs from committed board artifact.';
        result.hardFailures.push('TS board coordinate parity failed against committed board-final.svg.');
      }
    } else {
      result.hardFailures.push('TS board generation unavailable; cannot complete 1:1 parity tracking.');
    }

    // Step 5: mechanism coverage matrix
    result.mechanismCoverage = buildMechanismCoverage(pythonManifest);
    const notCovered = result.mechanismCoverage.filter((item) => item.ts.status !== 'covered');
    if (notCovered.length > 0) {
      result.recommendations.push(`Implement TS generators or adapters for parity-hard category files: ${notCovered.map((item) => item.category).join(', ')}.`);
    }

    const mismatchMetadata = result.mechanismCoverage
      .filter((entry) => entry.parity?.metadataMatch === false)
      .map((entry) => entry.category);
    if (mismatchMetadata.length > 0) {
      result.hardFailures.push(`Runtime-vs-manifest metadata mismatch in categories: ${mismatchMetadata.join(', ')}`);
    }

    if (!result.checks.tsBoardGenerated) {
      result.recommendations.push('Keep TS board generator execution as required gate in CI for each audit run.');
    }

    if (!result.hardFailures.length) {
      result.recommendations.push('Current Python and TS parity checks are clean for board artifacts; remaining categories remain metadata-only parity only.');
    }
  } finally {
    writeReport(result.hardFailures.length > 0);
    if (existsSync(pythonOut)) rmSync(pythonOut, { recursive: true, force: true });
    if (existsSync(tsBoardOut)) rmSync(tsBoardOut, { recursive: true, force: true });
  }
};

const parseBoardDataSignature = (svgText: string) => {
  const records = boardHoleRecord(svgText);
  return records.map((entry) => `${entry.coord}:${entry.cx},${entry.cy},${entry.r}`).join('|');
};

main();
