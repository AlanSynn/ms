#!/usr/bin/env bun
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FABRICATION_GEAR_SPECS,
  FABRICATION_LINKAGE_SPECS,
  FABRICATION_RING_GEAR_SPEC,
  FABRICATION_SPACER_SPEC,
  FABRICATION_SOURCE_SSOT,
} from '../utils/fabricationContract';
import { FABRICATION_ASSET_GENERATOR_SOURCE } from './fabrication/source-template';
import { compareSvgContours } from './fabrication/svg-contour';

const cwd = process.cwd();
const reportDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

interface AuditFileDiff {
  path: string;
  status: 'exact' | 'semantic-contour-match' | 'missing-in-committed' | 'missing-in-generated' | 'content-mismatch';
  reason?: string;
}

interface CategoryCoverage {
  strategy: 'template-copy' | 'ts-board-generation';
  status: 'covered';
  generatedBy: string;
  notes?: string;
}

interface CategoryAudit {
  category: string;
  filePaths: string[];
  fileCount: number;
  parity: {
    metadataMatch?: boolean;
    generatedFileCountExact?: boolean;
    coordinatesMatch?: boolean;
    notes?: string[];
  };
  ts: CategoryCoverage;
  recommendation: string;
}

interface AuditResult {
  generatedAt: string;
  paths: {
    sourceManifestPath: string;
    generatedManifestPath: string;
    outputDir: string;
    reportJsonPath: string;
    reportMarkdownPath: string;
  };
  checks: {
    generatedFromTs: boolean;
    manifestMetaMatch: boolean;
    managedFileSetExact: boolean;
    boardPresence: boolean;
    boardCoordinateParity: {
      status: 'ok' | 'blocked';
      details: string;
      tsHoleCount: number;
      committedHoleCount: number;
    };
    frozenPythonOracleParity: {
      status: 'ok' | 'blocked';
      schemaVersion?: number;
      capturedAt?: string;
      semanticContourCount: number;
      firstMismatch?: string;
    };
    runtimeSceneBoundary: {
      status: 'presentation-non-cutter';
      details: string;
    };
  };
  fileDiffs: {
    exact: number;
    exactFiles: AuditFileDiff[];
    missingInCommitted: AuditFileDiff[];
    missingInGenerated: AuditFileDiff[];
    mismatched: AuditFileDiff[];
  };
  mechanismCoverage: CategoryAudit[];
  recommendations: string[];
  hardFailures: string[];
}

type Manifest = {
  generated_by?: string;
  source_ssot?: string;
  board_rows?: number;
  board_columns?: number;
  grid_pitch_mm?: number;
  hole_diameter_mm?: number;
  managed_files?: string[];
  parts?: {
    gears?: Array<Record<string, unknown>>;
    linkages?: Array<Record<string, unknown>>;
    ring_gears?: Array<Record<string, unknown>>;
    spacers?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

const roundPoint = (value: number) => Math.round(value * 1000) / 1000;

const parseBoardHoleSignature = (svgText: string) => {
  const records = [...svgText.matchAll(/<circle\b[^>]*>/g)]
    .map((match) => {
      const tag = match[0];
      const coord = tag.match(/\bdata-board-coord="([^"]+)"/)?.[1];
      const cx = Number(tag.match(/\bcx="([^"]+)"/)?.[1]);
      const cy = Number(tag.match(/\bcy="([^"]+)"/)?.[1]);
      const r = Number(tag.match(/\br="([^"]+)"/)?.[1]);
      if (!coord || !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(r)) return null;
      return `${coord}:${roundPoint(cx)},${roundPoint(cy)},${roundPoint(r)}`;
    })
    .filter((entry): entry is string => typeof entry === 'string')
    .sort();
  return records.join('|');
};

const parseManifest = (path: string): Manifest => {
  if (!existsSync(path)) throw new Error(`Missing manifest ${path}`);
  return JSON.parse(readFileSync(path, 'utf8')) as Manifest;
};

const safeRead = (path: string) => {
  if (!existsSync(path)) throw new Error(`Missing file ${path}`);
  return readFileSync(path, 'utf8');
};

const normalizeCategory = (path: string) => {
  if (path === 'board-final.svg') return 'board';
  if (path === 'README.md' || path === 'manifest.json') return 'root-readme';
  if (!path.includes('/')) return 'misc-root';
  return path.split('/')[0];
};

const bucketFilesByCategory = (paths: string[]) => {
  const grouped: Record<string, string[]> = {};
  for (const relPath of paths) {
    const category = normalizeCategory(relPath);
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(relPath);
  }
  Object.values(grouped).forEach((items) => items.sort());
  return grouped;
};

const compareManagedFileSets = (leftManifest: Manifest, rightManifest: Manifest, leftRoot: string, rightRoot: string) => {
  const leftSet = new Set(Array.isArray(leftManifest.managed_files) ? leftManifest.managed_files : []);
  const rightSet = new Set(Array.isArray(rightManifest.managed_files) ? rightManifest.managed_files : []);

  const mismatched: AuditFileDiff[] = [];
  const missingInCommitted: AuditFileDiff[] = [];
  const missingInGenerated: AuditFileDiff[] = [];
  const exact: AuditFileDiff[] = [];

  for (const relPath of [...rightSet].sort()) {
    const leftPath = join(leftRoot, relPath);
    const rightPath = join(rightRoot, relPath);
    if (!leftSet.has(relPath)) {
      missingInCommitted.push({ path: relPath, status: 'missing-in-committed', reason: 'File exists only in generated output managed-set.' });
      continue;
    }
    const leftExists = existsSync(leftPath);
    const rightExists = existsSync(rightPath);
    if (!leftExists) {
      missingInCommitted.push({ path: relPath, status: 'missing-in-committed', reason: `Missing file ${leftPath}` });
      continue;
    }
    if (!rightExists) {
      missingInGenerated.push({ path: relPath, status: 'missing-in-generated', reason: `Missing file ${rightPath}` });
      continue;
    }
    const leftText = safeRead(leftPath);
    const rightText = safeRead(rightPath);
    if (relPath.endsWith('.svg')) {
      try {
        const semantic = compareSvgContours(leftText, rightText);
        if (semantic.equal) exact.push({ path: relPath, status: leftText === rightText ? 'exact' : 'semantic-contour-match', reason: leftText === rightText ? undefined : 'Text differs only by ignored SVG metadata/formatting.' });
        else mismatched.push({ path: relPath, status: 'content-mismatch', reason: semantic.firstMismatch ?? 'Committed artifact differs from TS-generated SVG contour.' });
      } catch (error) {
        mismatched.push({ path: relPath, status: 'content-mismatch', reason: error instanceof Error ? error.message : `${error}` });
      }
    } else if (leftText === rightText) exact.push({ path: relPath, status: 'exact' });
    else mismatched.push({ path: relPath, status: 'content-mismatch', reason: 'Committed artifact differs from TS-generated output.' });
  }

  for (const relPath of [...leftSet].sort()) {
    if (!rightSet.has(relPath)) {
      missingInGenerated.push({ path: relPath, status: 'missing-in-generated', reason: 'Committed managed file missing from generated output.' });
    }
  }

  return {
    exact,
    mismatched,
    missingInCommitted,
    missingInGenerated,
    matched: mismatched.length === 0 && missingInCommitted.length === 0 && missingInGenerated.length === 0,
  };
};

const jsonDeepEqual = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const normalizePointPairs = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (Array.isArray(item) && item.length >= 2 ? [Number(item[0]), Number(item[1])] : [NaN, NaN]))
    .filter((entry) => Number.isFinite(entry[0]) && Number.isFinite(entry[1]))
    .map((entry) => entry.map((axis) => roundPoint(axis)) as [number, number]);
};

const buildCategoryCoverage = () => ({
  board: { strategy: 'ts-board-generation' as const, status: 'covered' as const, generatedBy: 'scripts/generate-fabrication-board.ts' },
  assembly: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  gears: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  ring_gears: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  linkages: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  cams: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  followers: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  brackets: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  handles: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  spacers: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  cam_modules: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  sheets: { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  'root-readme': { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
  'misc-root': { strategy: 'template-copy' as const, status: 'covered' as const, generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE },
});

const metadataParity = (category: string, manifest: Manifest) => {
  const byCategory = buildCategoryCoverage() as Record<string, CategoryCoverage>;
  const coverage = byCategory[category] ?? { strategy: 'template-copy', status: 'covered', generatedBy: FABRICATION_ASSET_GENERATOR_SOURCE, notes: 'No category fixture available yet.' };
  const parts = manifest.parts ?? {};
  const parity: CategoryAudit['parity'] = {};

  if (category === 'gears') {
    const canonical = FABRICATION_GEAR_SPECS.map((spec) => ({
      key: spec.key,
      teeth: spec.teeth,
      path: spec.path,
      pitchRadiusMm: spec.pitchRadiusMm,
      outerRadiusMm: spec.outerRadiusMm,
      rootRadiusMm: spec.rootRadiusMm,
      holeDiameterMm: spec.holeDiameterMm,
      attachmentHoleCentersMm: spec.attachmentHoleCentersMm.map((point) => [point.x, point.y]),
    }));
    const manifestGeared = Array.isArray(parts.gears) ? parts.gears.map((spec) => ({
      key: spec.key,
      teeth: spec.teeth,
      path: spec.path,
      pitchRadiusMm: spec.pitch_radius_mm,
      outerRadiusMm: spec.outer_radius_mm,
      rootRadiusMm: spec.root_radius_mm,
      holeDiameterMm: spec.hole_diameter_mm,
      attachmentHoleCentersMm: normalizePointPairs(spec.attachment_hole_centers_mm),
    })) : null;
    parity.metadataMatch = jsonDeepEqual(canonical, manifestGeared);
    parity.notes = [parity.metadataMatch ? 'geometry metadata aligned' : 'gear metadata mismatch'];
  }

  if (category === 'linkages') {
    const canonical = FABRICATION_LINKAGE_SPECS.map((spec) => ({
      key: spec.key,
      path: spec.path,
      cells: spec.cells,
      lengthMm: spec.lengthMm,
      pitchMm: spec.pitchMm,
      holeDiameterMm: spec.holeDiameterMm,
    }));
    const manifestLinkage = Array.isArray(parts.linkages) ? parts.linkages.map((spec) => ({
      key: spec.key,
      path: spec.path,
      cells: spec.cells,
      lengthMm: spec.length_mm,
      pitchMm: spec.pitch_mm,
      holeDiameterMm: spec.hole_diameter_mm,
    })) : null;
    parity.metadataMatch = jsonDeepEqual(canonical, manifestLinkage);
    parity.notes = [parity.metadataMatch ? 'geometry metadata aligned' : 'linkage metadata mismatch'];
  }

  if (category === 'ring_gears') {
    const item = Array.isArray(parts.ring_gears) ? parts.ring_gears[0] : null;
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
    const manifestRing = item ? {
      key: item.key,
      path: item.path,
      compatibleSunTeeth: item.compatible_sun_teeth,
      compatiblePlanetTeeth: item.compatible_planet_teeth,
      internalTeeth: item.internal_teeth,
      pitchRadiusMm: item.pitch_radius_mm,
      innerTipRadiusMm: item.inner_tip_radius_mm,
      innerRootRadiusMm: item.inner_root_radius_mm,
      outerRadiusMm: item.outer_radius_mm,
      mountRadiusMm: item.mount_radius_mm,
      holeDiameterMm: item.hole_diameter_mm,
    } : null;
    parity.metadataMatch = jsonDeepEqual(canonical, manifestRing);
    parity.notes = [parity.metadataMatch ? 'geometry metadata aligned' : 'ring geometry metadata mismatch'];
  }

  if (category === 'spacers') {
    const item = Array.isArray(parts.spacers) ? parts.spacers[0] : null;
    const canonical = {
      key: FABRICATION_SPACER_SPEC.key,
      path: FABRICATION_SPACER_SPEC.path,
      outerDiameterMm: FABRICATION_SPACER_SPEC.outerDiameterMm,
      innerDiameterMm: FABRICATION_SPACER_SPEC.innerDiameterMm,
      holeDiameterMm: FABRICATION_SPACER_SPEC.holeDiameterMm,
      stackable: FABRICATION_SPACER_SPEC.stackable,
    };
    const manifestSpacer = item ? {
      key: item.key,
      path: item.path,
      outerDiameterMm: item.outer_diameter_mm,
      innerDiameterMm: item.inner_diameter_mm,
      holeDiameterMm: item.hole_diameter_mm,
      stackable: item.stackable,
    } : null;
    parity.metadataMatch = jsonDeepEqual(canonical, manifestSpacer);
    parity.notes = [parity.metadataMatch ? 'geometry metadata aligned' : 'spacer metadata mismatch'];
  }

  return { coverage, parity };
};

const buildMarkdown = (result: AuditResult) => {
  const lines: string[] = [];
  lines.push('# TS/frozen-oracle managed SVG contour parity trace');
  lines.push('');
  lines.push(`Generated: ${result.generatedAt}`);
  lines.push('');
  lines.push('## Checks');
  lines.push(`- TS generation executed: ${result.checks.generatedFromTs ? '✅' : '❌'}`);
  lines.push(`- managed manifest metadata parity: ${result.checks.manifestMetaMatch ? '✅' : '❌'}`);
  lines.push(`- managed file set parity: ${result.checks.managedFileSetExact ? '✅' : '❌'}`);
  lines.push(`- board file present: ${result.checks.boardPresence ? '✅' : '❌'}`);
  lines.push(`- board coordinate parity: ${result.checks.boardCoordinateParity.status === 'ok' ? '✅' : '❌'} (${result.checks.boardCoordinateParity.tsHoleCount}/${result.checks.boardCoordinateParity.committedHoleCount})`);
  lines.push(`- TS/frozen-oracle managed SVG contours: ${result.checks.frozenPythonOracleParity.status === 'ok' ? '✅' : '❌'} (${result.checks.frozenPythonOracleParity.semanticContourCount} semantic)`);
  lines.push(`- runtime Blueprint/scene SVGs: ${result.checks.runtimeSceneBoundary.status} — ${result.checks.runtimeSceneBoundary.details}`);
  lines.push('');
  lines.push('## File-level parity');
  lines.push(`- exact: ${result.fileDiffs.exact}`);
  lines.push(`- mismatched: ${result.fileDiffs.mismatched.length}`);
  lines.push(`- missing in committed: ${result.fileDiffs.missingInCommitted.length}`);
  lines.push(`- missing in generated: ${result.fileDiffs.missingInGenerated.length}`);

  if (result.fileDiffs.mismatched.length) {
    lines.push('### Mismatch details');
    for (const entry of result.fileDiffs.mismatched) lines.push(`- ${entry.path}: ${entry.reason ?? 'mismatch'}`);
  }

  lines.push('');
  lines.push('## Mechanism-category parity matrix');
  lines.push('| category | file count | strategy | coverage | metadata match | generated-by | recommendation |');
  lines.push('|---|---:|---|---|---|---|---|');
  for (const category of result.mechanismCoverage) {
    let metadata = 'n/a';
    if (category.parity.metadataMatch !== undefined) {
      metadata = category.parity.metadataMatch ? '✅' : '⚠️';
    }
    lines.push(`| ${category.category} | ${category.fileCount} | ${category.ts.strategy} | ${category.ts.status} | ${metadata} | ${category.ts.generatedBy} | ${category.recommendation} |`);
  }

  lines.push('');
  lines.push('## Recommendations');
  if (!result.recommendations.length) lines.push('- none');
  else result.recommendations.forEach((item) => lines.push(`- ${item}`));

  lines.push('');
  lines.push('## Hard failures');
  if (!result.hardFailures.length) lines.push('- none');
  else result.hardFailures.forEach((item) => lines.push(`- ${item}`));

  return `${lines.join('\n')}\n`;
};

const main = () => {
  const reportDir = join(cwd, 'docs', 'analysis');
  const outputDir = mkdtempSync(join(tmpdir(), `ms-fab-ts-${Date.now()}-`));
  const result: AuditResult = {
    generatedAt: new Date().toISOString(),
    paths: {
      sourceManifestPath: join(cwd, 'fabrication', 'manifest.json'),
      generatedManifestPath: join(outputDir, 'manifest.json'),
      outputDir,
      reportJsonPath: join(reportDir, `fabrication-parity-${reportDate}.json`),
      reportMarkdownPath: join(reportDir, `fabrication-parity-${reportDate}.md`),
    },
    checks: {
      generatedFromTs: false,
      manifestMetaMatch: false,
      managedFileSetExact: false,
      boardPresence: false,
      boardCoordinateParity: { status: 'blocked', details: 'not run', tsHoleCount: 0, committedHoleCount: 0 },
      frozenPythonOracleParity: { status: 'blocked', semanticContourCount: 0 },
      runtimeSceneBoundary: {
        status: 'presentation-non-cutter',
        details: 'Blueprint/export scene SVGs reuse some primitives but are presentation/non-cutter outputs and are not claimed contour-identical.',
      },
    },
    fileDiffs: {
      exact: 0,
      exactFiles: [],
      missingInCommitted: [],
      missingInGenerated: [],
      mismatched: [],
    },
    mechanismCoverage: [],
    recommendations: [],
    hardFailures: [],
  };

  const refreshIndexes = () => {
    const reportName = `fabrication-parity-${reportDate}.md`;
    const analysisIndexPath = join(reportDir, 'README.md');
    const analysisIndex = safeRead(analysisIndexPath).replace(
      /^- \[Fabrication parity trace \(\d{4}-\d{2}-\d{2}\)\]\(fabrication-parity-\d{4}-\d{2}-\d{2}\.md\)/m,
      `- [Fabrication parity trace (${reportDate})](${reportName})`,
    );
    if (!analysisIndex.includes(reportName)) throw new Error(`Missing active fabrication parity link in ${analysisIndexPath}`);
    writeFileSync(analysisIndexPath, analysisIndex, 'utf8');

    const docsIndexPath = join(cwd, 'docs', 'index.md');
    const docsIndex = safeRead(docsIndexPath)
      .replace(/^Last refreshed: \d{4}-\d{2}-\d{2}$/m, `Last refreshed: ${reportDate}`)
      .replace(
        /\[`analysis\/fabrication-parity-\d{4}-\d{2}-\d{2}\.md`\]\(analysis\/fabrication-parity-\d{4}-\d{2}-\d{2}\.md\)/,
        '[`analysis/' + reportName + '`](analysis/' + reportName + ')',
      );
    if (!docsIndex.includes(`analysis/${reportName}`)) throw new Error(`Missing active fabrication parity link in ${docsIndexPath}`);
    writeFileSync(docsIndexPath, docsIndex, 'utf8');
  };

  const writeReport = (forceFail = false) => {
    if (!process.argv.includes('--no-write')) {
      writeFileSync(result.paths.reportJsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      writeFileSync(result.paths.reportMarkdownPath, buildMarkdown(result), 'utf8');
      refreshIndexes();
    }
    if (forceFail) process.exitCode = 1;
  };

  try {
    const generatorOutput = execFileSync('bun', ['scripts/generate-fabrication-assets.ts', '--output', outputDir, '--compare-committed'], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const generatorSummary = JSON.parse(generatorOutput) as { frozen_python_oracle_parity?: { status: boolean; schema_version?: number; captured_at?: string; semantic_contour_files?: string[]; first_mismatch?: string } };
    result.checks.generatedFromTs = true;
    result.checks.frozenPythonOracleParity = {
      status: generatorSummary.frozen_python_oracle_parity?.status ? 'ok' : 'blocked',
      schemaVersion: generatorSummary.frozen_python_oracle_parity?.schema_version,
      capturedAt: generatorSummary.frozen_python_oracle_parity?.captured_at,
      semanticContourCount: generatorSummary.frozen_python_oracle_parity?.semantic_contour_files?.length ?? 0,
      firstMismatch: generatorSummary.frozen_python_oracle_parity?.first_mismatch,
    };
    if (result.checks.frozenPythonOracleParity.status !== 'ok') {
      result.hardFailures.push(`Frozen Python oracle managed SVG contour parity failed: ${result.checks.frozenPythonOracleParity.firstMismatch ?? 'unknown mismatch'}`);
    }

    const committedRoot = join(cwd, 'fabrication');
    const committedManifest = parseManifest(result.paths.sourceManifestPath);
    const generatedManifest = parseManifest(result.paths.generatedManifestPath);
    result.checks.manifestMetaMatch = jsonDeepEqual(
      {
        generated_by: committedManifest.generated_by,
        source_ssot: committedManifest.source_ssot,
        board_rows: committedManifest.board_rows,
        board_columns: committedManifest.board_columns,
        grid_pitch_mm: committedManifest.grid_pitch_mm,
        hole_diameter_mm: committedManifest.hole_diameter_mm,
        managed_file_count: Array.isArray(committedManifest.managed_files) ? committedManifest.managed_files.length : null,
      },
      {
        generated_by: generatedManifest.generated_by,
        source_ssot: generatedManifest.source_ssot,
        board_rows: generatedManifest.board_rows,
        board_columns: generatedManifest.board_columns,
        grid_pitch_mm: generatedManifest.grid_pitch_mm,
        hole_diameter_mm: generatedManifest.hole_diameter_mm,
        managed_file_count: Array.isArray(generatedManifest.managed_files) ? generatedManifest.managed_files.length : null,
      }
    );

    const fileDiff = compareManagedFileSets(
      committedManifest,
      generatedManifest,
      committedRoot,
      outputDir,
    );

    result.fileDiffs = {
      exact: fileDiff.exact.length,
      exactFiles: fileDiff.exact,
      mismatched: fileDiff.mismatched,
      missingInCommitted: fileDiff.missingInCommitted,
      missingInGenerated: fileDiff.missingInGenerated,
    };

    result.checks.managedFileSetExact = fileDiff.matched;

    const committedBoardPath = join(committedRoot, 'board-final.svg');
    const generatedBoardPath = join(outputDir, 'board-final.svg');
    result.checks.boardPresence = existsSync(generatedBoardPath);

    if (result.checks.boardPresence) {
      const committedBoard = safeRead(committedBoardPath);
      const generatedBoard = safeRead(generatedBoardPath);
      const committedBoardSignature = parseBoardHoleSignature(committedBoard);
      const generatedBoardSignature = parseBoardHoleSignature(generatedBoard);
      if (committedBoardSignature === generatedBoardSignature) {
        result.checks.boardCoordinateParity = {
          status: 'ok',
          details: 'Board hole signatures match.',
          tsHoleCount: committedBoardSignature ? committedBoardSignature.split('|').length : 0,
          committedHoleCount: committedBoardSignature ? committedBoardSignature.split('|').length : 0,
        };
      } else {
        result.checks.boardCoordinateParity = {
          status: 'blocked',
          details: 'Generated board file does not match committed board coordinates.',
          tsHoleCount: generatedBoardSignature.split('|').length,
          committedHoleCount: committedBoardSignature.split('|').length,
        };
        result.hardFailures.push('Board coordinate parity failed for committed and TS-generated board-final.svg.');
      }
    } else {
      result.hardFailures.push('Generated board artifact is missing; cannot complete parity check.');
    }

    if (!result.checks.manifestMetaMatch) {
      result.recommendations.push('Manifest metadata drifts from committed baseline; update scripts/fabrication/source/manifest.template.json and committed manifest snapshot together.');
      result.hardFailures.push('Manifest metadata parity failure.');
    }

    if (!result.checks.managedFileSetExact) {
      result.hardFailures.push('Managed file set drift detected between TS source template output and committed fabrication package.');
      result.recommendations.push('Resolve generation drift by syncing scripts/fabrication/source with committed artifacts and re-running generator.');
    }

    const grouped = bucketFilesByCategory(Array.isArray(committedManifest.managed_files) ? committedManifest.managed_files : []);
    result.mechanismCoverage = Object.keys(grouped)
      .sort()
      .map((category): CategoryAudit => {
        const paths = grouped[category] ?? [];
        const { coverage, parity } = metadataParity(category, committedManifest);
        let recommendation = 'Template-copy artifacts are contour-checked against fresh TS output, committed artifacts, and the frozen oracle.';
        if (parity.metadataMatch === false) {
          recommendation = `Category ${category} metadata drift detected; check runtime contracts and manifest source data.`;
        } else if (category === 'board') {
          recommendation = 'TypeScript board generation is contour-checked against committed output and the frozen oracle.';
        }
        return {
          category,
          filePaths: paths,
          fileCount: paths.length,
          parity: {
            ...parity,
            generatedFileCountExact: result.checks.managedFileSetExact,
          },
          ts: coverage,
          recommendation,
        };
      });

    if (generatedManifest.generated_by !== FABRICATION_ASSET_GENERATOR_SOURCE || generatedManifest.source_ssot !== FABRICATION_ASSET_GENERATOR_SOURCE) {
      result.hardFailures.push(`Generated manifest generator tags not TS-only (generated_by=${generatedManifest.generated_by}, source_ssot=${generatedManifest.source_ssot}).`);
    }
    if (FABRICATION_SOURCE_SSOT !== FABRICATION_ASSET_GENERATOR_SOURCE) {
      result.recommendations.push('Runtime FABRICATION_SOURCE_SSOT should be scripts/fabrication source generator for strict provenance.');
    }

    if (!result.hardFailures.length) {
      result.recommendations.push('TS managed SVG contour parity holds against committed artifacts and the frozen Python-derived oracle. Runtime Blueprint/scene SVGs remain presentation geometry, not cutter-contour identity evidence.');
    }
  } catch (error) {
    result.hardFailures.push(error instanceof Error ? error.message : `${error}`);
    result.recommendations.push('Run: bun scripts/generate-fabrication-assets.ts and fix generation failures before re-running parity trace.');
  } finally {
    writeReport(result.hardFailures.length > 0);
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
  }
};

main();
