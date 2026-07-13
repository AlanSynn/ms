#!/usr/bin/env bun
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  copyFileSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';

import {
  FABRICATION_ASSET_GENERATOR_SOURCE,
  FABRICATION_ASSET_TEMPLATE_DIR,
  FABRICATION_ASSET_TEMPLATE_MANIFEST,
  classifyTemplateFiles,
  loadTemplateManifest,
} from './fabrication/source-template';
import type {
  CategoryPathMap,
  CategorySummary,
  GeneratorAdapter,
  GeneratorContext,
  GenerationSummary,
  FabricationTemplateManifest,
} from './fabrication/types';
import { compareSvgContours, svgContourSignature } from './fabrication/svg-contour';

const BOARD_FILE = 'board-final.svg';
const BOARD_GENERATOR_SCRIPT = 'scripts/generate-fabrication-board.ts';

const MANAGED_CATEGORIES = [
  'board',
  'assembly',
  'gears',
  'ring_gears',
  'linkages',
  'cams',
  'followers',
  'brackets',
  'handles',
  'spacers',
  'cam_modules',
  'sheets',
  'root-readme',
  'misc-root',
  'manifest',
] as const;

export type GeneratorMode = 'board' | 'non-board' | 'all';

type CliOptions = {
  output: string;
  adapters: string[];
  onlyBoard: boolean;
  onlyNonBoard: boolean;
  compareCommitted: boolean;
};

type CompareReport = {
  exact: string[];
  contourExact: string[];
  missingInCommitted: string[];
  missingInGenerated: string[];
  mismatched: string[];
  managedExpected: string[];
  managedGenerated: string[];
  firstMismatch?: string;
};

type CategoryDiff = CategorySummary & {
  categoryName: string;
};

const ensureDirectory = (path: string) => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
};

const readText = (path: string) => {
  if (!existsSync(path)) {
    throw new Error(`Missing file: ${path}`);
  }
  return readFileSync(path, 'utf8');
};

const readManifest = (path: string): FabricationTemplateManifest => {
  if (!existsSync(path)) {
    throw new Error(`Missing manifest: ${path}`);
  }
  return JSON.parse(readText(path)) as FabricationTemplateManifest;
};

const writeJson = (path: string, payload: unknown) => {
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
};

const copyPath = (sourceRoot: string, outputRoot: string, relPath: string) => {
  const sourcePath = join(sourceRoot, relPath);
  const outputPath = join(outputRoot, relPath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Template file missing: ${relPath}`);
  }

  const stat = lstatSync(sourcePath);
  if (stat.isDirectory()) {
    ensureDirectory(outputPath);
    for (const entry of readdirSync(sourcePath, { withFileTypes: true })) {
      copyPath(sourcePath, outputPath, entry.name);
    }
    return;
  }

  ensureDirectory(dirname(outputPath));
  copyFileSync(sourcePath, outputPath);
};

const listManagedFiles = (manifest: FabricationTemplateManifest): string[] => {
  return [...new Set((Array.isArray(manifest.managed_files) ? manifest.managed_files : []).map((entry) => `${entry}`))]
    .filter(Boolean)
    .sort();
};

const normalizeManagedManifest = (manifest: FabricationTemplateManifest): CategoryPathMap => {
  return classifyTemplateFiles(manifest).byCategory;
};

const parseArgs = (): CliOptions => {
  const args = process.argv.slice(2);
  const options: CliOptions = {
    output: 'fabrication',
    adapters: ['template-source', 'board-generator'],
    onlyBoard: false,
    onlyNonBoard: false,
    compareCommitted: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    switch (arg) {
      case '--output': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('Missing value for --output');
        }
        options.output = value;
        index += 1;
        break;
      }
      case '--adapters': {
        const value = args[index + 1];
        if (!value) {
          throw new Error('Missing value for --adapters');
        }
        options.adapters = value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        index += 1;
        break;
      }
      case '--only-board':
        options.onlyBoard = true;
        break;
      case '--only-non-board':
        options.onlyNonBoard = true;
        break;
      case '--compare-committed':
        options.compareCommitted = true;
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

  if (options.onlyBoard && options.onlyNonBoard) {
    throw new Error('--only-board and --only-non-board cannot be used together');
  }

  if (!options.adapters.length) {
    options.adapters = ['template-source', 'board-generator'];
  }

  return options;
};

const printUsage = () => {
  console.log('Usage: bun scripts/generate-fabrication-assets.ts [--output <dir>] [--adapters <id,id2>] [--only-board] [--only-non-board] [--compare-committed]');
  console.log('Available adapters:');
  GENERATORS.forEach((generator) => {
    console.log(`  ${generator.id}`);
    console.log(`    source: ${generator.sourceSsot}`);
    console.log(`    mode: ${generator.mode}`);
    console.log(`    ${generator.description}`);
  });
};

const compareManagedArtifacts = (leftRoot: string, rightRoot: string): CompareReport => {
  const leftFiles = new Set<string>(listManagedFiles(readManifest(join(leftRoot, 'manifest.json'))));
  const rightFiles = new Set<string>(listManagedFiles(readManifest(join(rightRoot, 'manifest.json'))));
  const mismatched: string[] = [];
  const exact: string[] = [];
  const contourExact: string[] = [];
  const missingInCommitted: string[] = [];
  const missingInGenerated: string[] = [];
  let firstMismatch: string | undefined;

  for (const relPath of leftFiles) {
    if (!rightFiles.has(relPath)) {
      missingInGenerated.push(relPath);
      firstMismatch ??= `${relPath}: missing in generated output manifest`;
      continue;
    }
    const leftText = readText(join(leftRoot, relPath));
    const rightText = readText(join(rightRoot, relPath));
    if (leftText === rightText) exact.push(relPath);
    if (relPath.endsWith('.svg')) {
      const semantic = compareSvgContours(leftText, rightText);
      if (semantic.equal) contourExact.push(relPath);
      else {
        mismatched.push(relPath);
        firstMismatch ??= `${relPath}: ${semantic.firstMismatch ?? 'SVG contour mismatch'}`;
      }
    } else if (leftText !== rightText) {
      mismatched.push(relPath);
      firstMismatch ??= `${relPath}: text mismatch`;
    }
  }

  for (const relPath of rightFiles) {
    if (!leftFiles.has(relPath)) {
      missingInCommitted.push(relPath);
      firstMismatch ??= `${relPath}: present only in generated output manifest`;
    }
  }

  return {
    exact,
    contourExact,
    missingInCommitted,
    missingInGenerated,
    mismatched,
    managedExpected: [...leftFiles].sort(),
    managedGenerated: [...rightFiles].sort(),
    firstMismatch,
  };
};

const buildCategorySummaries = (
  committedManifest: FabricationTemplateManifest,
  generatedManifest: FabricationTemplateManifest,
  leftRoot: string,
  rightRoot: string,
): CategorySummary[] => {
  const committedByCategory = normalizeManagedManifest(committedManifest);
  const generatedByCategory = normalizeManagedManifest(generatedManifest);

  const summaries: CategorySummary[] = [];
  for (const category of MANAGED_CATEGORIES) {
    const committed = [...new Set((committedByCategory[category] ?? []).filter(Boolean))].sort();
    const generated = [...new Set((generatedByCategory[category] ?? []).filter(Boolean))].sort();

    const missingInGenerated: string[] = [];
    const missingInCommitted: string[] = [];
    const mismatched: string[] = [];
    const exact: string[] = [];

    const generatedSet = new Set(generated);
    const committedSet = new Set(committed);

    for (const relPath of committed) {
      if (!generatedSet.has(relPath)) {
        missingInGenerated.push(relPath);
        continue;
      }
      const leftText = readText(join(leftRoot, relPath));
      const rightText = readText(join(rightRoot, relPath));
      if (leftText === rightText) {
        exact.push(relPath);
      } else if (relPath.endsWith('.svg')) {
        const semantic = compareSvgContours(leftText, rightText);
        if (!semantic.equal) mismatched.push(relPath);
      } else {
        mismatched.push(relPath);
      }
    }

    for (const relPath of generated) {
      if (!committedSet.has(relPath)) {
        missingInCommitted.push(relPath);
      }
    }

    summaries.push({
      category,
      managed: committed,
      generated,
      missingInGenerated,
      missingInCommitted,
      mismatched,
      exact,
    });
  }

  return summaries;
};

const normalizeManifest = (templateManifest: FabricationTemplateManifest, generatedAt: string): FabricationTemplateManifest => {
  const copy = JSON.parse(JSON.stringify(templateManifest)) as FabricationTemplateManifest;
  const managedFiles = listManagedFiles(copy);

  copy.generated_at = generatedAt;
  copy.generated_by = FABRICATION_ASSET_GENERATOR_SOURCE;
  copy.source_ssot = FABRICATION_ASSET_GENERATOR_SOURCE;
  copy.managed_files = [...new Set(managedFiles)];

  if (!Array.isArray(copy.assembly) && !(copy.assembly && typeof copy.assembly === 'object')) {
    copy.assembly = {} as never;
  }

  const assembly = copy.assembly as Record<string, unknown>;
  assembly.board_map = BOARD_FILE;

  return copy;
};

const makeContext = (outputRoot: string, sourceManifest: FabricationTemplateManifest, options: Pick<CliOptions, 'adapters' | 'onlyBoard' | 'onlyNonBoard'>): GeneratorContext => ({
  sourceRoot: resolve(process.cwd(), FABRICATION_ASSET_TEMPLATE_DIR),
  outputRoot,
  sourceManifest,
  options: {
    output: outputRoot,
    includeBoard: !options.onlyNonBoard,
    includeNonBoard: !options.onlyBoard,
  },
});

const shouldRunAdapter = (options: CliOptions) => (generator: GeneratorAdapter) => {
  if (!options.adapters.includes(generator.id)) {
    return false;
  }
  if (options.onlyBoard && generator.mode !== 'board') {
    return false;
  }
  if (options.onlyNonBoard && generator.mode !== 'non-board') {
    return false;
  }
  return true;
};

const boardAdapter: GeneratorAdapter = {
  id: 'board-generator',
  description: 'Generate board-final.svg from TypeScript board template source.',
  mode: 'board',
  sourceSsot: BOARD_GENERATOR_SCRIPT,
  run: (context) => {
    execFileSync('bun', ['scripts/generate-fabrication-board.ts', '--output', context.outputRoot], {
      stdio: 'pipe',
    });

    const boardOutput = join(context.outputRoot, BOARD_FILE);
    if (!existsSync(boardOutput)) {
      throw new Error(`Board generator did not create ${BOARD_FILE}`);
    }

    const boardText = readText(boardOutput);
    if (!boardText.includes(`data-generated-by="${BOARD_GENERATOR_SCRIPT}"`)) {
      throw new Error(`Board artifact is missing marker data-generated-by="${BOARD_GENERATOR_SCRIPT}"`);
    }

    return [BOARD_FILE];
  },
};

const templateAdapter: GeneratorAdapter = {
  id: 'template-source',
  description: 'Copy managed non-board fabrication SVGs and metadata from scripts/fabrication/source.',
  mode: 'non-board',
  sourceSsot: FABRICATION_ASSET_GENERATOR_SOURCE,
  run: (context) => {
    const managedFiles = listManagedFiles(context.sourceManifest).filter(
      (value) => value !== BOARD_FILE && value !== 'manifest.json',
    );

    const generated = new Set<string>();
    managedFiles.forEach((relPath) => {
      copyPath(context.sourceRoot, context.outputRoot, relPath);
      generated.add(relPath);
    });

    return [...generated].sort();
  },
};

const GENERATORS: readonly GeneratorAdapter[] = [templateAdapter, boardAdapter];

const compareGeneratedWithManifest = (
  baseManifest: FabricationTemplateManifest,
  generatedManifest: FabricationTemplateManifest,
  baseRoot: string,
  generatedRoot: string,
): { report: CompareReport; categorySummary: CategoryDiff[] } => {
  const report = compareManagedArtifacts(baseRoot, generatedRoot);

  const categorySummary = buildCategorySummaries(baseManifest, generatedManifest, baseRoot, generatedRoot).map((entry) => ({
    ...entry,
    categoryName: String(entry.category),
  }));

  return { report, categorySummary };
};

type FrozenPythonOracle = {
  schema_version: number;
  captured_at: string;
  source_command: string;
  python_generator_sha256: string;
  managed_files: string[];
  files: Record<string, {
    source_svg_sha256: string;
    normalized_contour_records: string[];
    contour_sha256: string;
  }>;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const readFrozenPythonOracle = (oraclePath = join(process.cwd(), 'fabrication', 'fabrication-python-oracle.json')): FrozenPythonOracle => {
  const oracle = JSON.parse(readText(oraclePath)) as FrozenPythonOracle;
  const required = ['schema_version', 'captured_at', 'source_command', 'python_generator_sha256', 'managed_files', 'files'];
  for (const field of required) {
    if (!(field in oracle)) throw new Error(`Python fabrication oracle missing ${field}`);
  }
  if (!Array.isArray(oracle.managed_files)) throw new Error('Python fabrication oracle managed_files must be an array');
  if (!oracle.files || typeof oracle.files !== 'object') throw new Error('Python fabrication oracle files must be an object');
  return oracle;
};

const compareToFrozenPythonOracle = (generatedRoot: string, generatedManifest: FabricationTemplateManifest) => {
  const oracle = readFrozenPythonOracle();
  const generatedManaged = listManagedFiles(generatedManifest);
  const oracleManaged = [...oracle.managed_files].sort();
  const mismatches: string[] = [];
  const semanticContours: string[] = [];
  let firstMismatch: string | undefined;

  if (JSON.stringify(generatedManaged) !== JSON.stringify(oracleManaged)) {
    mismatches.push('managed_files');
    firstMismatch ??= `managed_files: generated=${generatedManaged.length} oracle=${oracleManaged.length}`;
  }

  const generatedSvgFiles = generatedManaged.filter((path) => path.endsWith('.svg'));
  const oracleSvgFiles = Object.keys(oracle.files).sort();
  if (JSON.stringify(generatedSvgFiles) !== JSON.stringify(oracleSvgFiles)) {
    mismatches.push('oracle.files');
    firstMismatch ??= `oracle.files: generated SVGs=${generatedSvgFiles.length} oracle SVGs=${oracleSvgFiles.length}`;
  }

  for (const relPath of generatedSvgFiles) {
    const oracleFile = oracle.files[relPath];
    if (!oracleFile) {
      mismatches.push(relPath);
      firstMismatch ??= `${relPath}: missing in frozen oracle`;
      continue;
    }
    const signature = svgContourSignature(readText(join(generatedRoot, relPath)));
    const contourSha = sha256(signature.signature);
    if (contourSha === oracleFile.contour_sha256 && JSON.stringify(signature.records) === JSON.stringify(oracleFile.normalized_contour_records)) {
      semanticContours.push(relPath);
    } else {
      mismatches.push(relPath);
      firstMismatch ??= `${relPath}: frozen oracle contour mismatch`;
    }
  }

  return {
    status: mismatches.length === 0,
    schema_version: oracle.schema_version,
    captured_at: oracle.captured_at,
    total: generatedManaged.length,
    svg_total: generatedSvgFiles.length,
    semanticContours,
    firstMismatch,
    mismatches,
  };
};

const run = () => {
  const options = parseArgs();
  const outputRoot = resolve(process.cwd(), options.output);

  ensureDirectory(outputRoot);

  const sourceManifest = loadTemplateManifest();
  const context = makeContext(outputRoot, sourceManifest, options);
  const shouldRun = shouldRunAdapter(options);

  const generatedSet = new Set<string>(['manifest.json']);
  const executed = [] as GenerationSummary['executed'];

  for (const adapter of GENERATORS) {
    if (!shouldRun(adapter)) {
      executed.push({
        adapter_id: adapter.id,
        source_ssot: adapter.sourceSsot,
        output_dir: options.output,
        status: 'skipped',
        files_skipped: 0,
      });
      continue;
    }

    try {
      const generatedFiles = adapter.run(context);
      generatedFiles.forEach((file) => generatedSet.add(file));
      executed.push({
        adapter_id: adapter.id,
        source_ssot: adapter.sourceSsot,
        output_dir: options.output,
        status: 'ok',
        files_generated: generatedFiles.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : `${error}`;
      executed.push({
        adapter_id: adapter.id,
        source_ssot: adapter.sourceSsot,
        output_dir: options.output,
        status: 'failed',
        error: message,
      });
      throw error;
    }
  }

  const manifestPath = join(outputRoot, 'manifest.json');
  const beforeManifest = existsSync(manifestPath) ? readManifest(manifestPath) : null;

  const manifestGeneratedAt = sourceManifest.generated_at || 'reproducible';
  const generatedManifest = normalizeManifest(sourceManifest, manifestGeneratedAt);
  writeJson(manifestPath, generatedManifest);

  const afterManifest = readManifest(manifestPath);

  const generatedManifestUpdated = JSON.stringify(beforeManifest ?? {}) !== JSON.stringify(afterManifest);

  let categorySummary: CategorySummary[] = [];
  let manifestCoverage = {
    managedFileSetExact: false,
    managed_files_committed: [] as string[],
    managed_files_generated: [] as string[],
    missing_in_generated: [] as string[],
    missing_in_committed: [] as string[],
    mismatched: [] as string[],
  };
  let boardParity = {
    status: false,
    firstMismatch: undefined as string | undefined,
  };
  let committedComparison: ReturnType<typeof compareGeneratedWithManifest> | null = null;

  if (options.compareCommitted) {
    const committedRoot = join(process.cwd(), 'fabrication');
    const committedManifest = readManifest(join(committedRoot, 'manifest.json'));

    const comparison = compareGeneratedWithManifest(committedManifest, afterManifest, committedRoot, outputRoot);
    committedComparison = comparison;
    categorySummary = comparison.categorySummary;

    manifestCoverage = {
      managedFileSetExact:
        comparison.report.missingInCommitted.length === 0 && comparison.report.missingInGenerated.length === 0 && comparison.report.mismatched.length === 0,
      managed_files_committed: comparison.report.managedExpected,
      managed_files_generated: comparison.report.managedGenerated,
      missing_in_generated: comparison.report.missingInGenerated,
      missing_in_committed: comparison.report.missingInCommitted,
      mismatched: comparison.report.mismatched,
    };

    const boardContour = compareSvgContours(readText(join(committedRoot, BOARD_FILE)), readText(join(outputRoot, BOARD_FILE)));
    boardParity = {
      status: boardContour.equal,
      firstMismatch: boardContour.firstMismatch,
    };

    if (!manifestCoverage.managedFileSetExact) {
      throw new Error('Committed and generated managed file set mismatch');
    }
    if (!boardParity.status) {
      throw new Error(`Generated board-final.svg does not match committed board contour: ${boardParity.firstMismatch ?? 'unknown mismatch'}`);
    }
    const categoryFailures = categorySummary.filter(
      (entry) => entry.missingInCommitted.length || entry.missingInGenerated.length || entry.mismatched.length,
    );
    if (categoryFailures.length > 0) {
      throw new Error(`Category coverage drift: ${JSON.stringify(categoryFailures, null, 2)}`);
    }

    if (afterManifest.generated_by !== FABRICATION_ASSET_GENERATOR_SOURCE || afterManifest.source_ssot !== FABRICATION_ASSET_GENERATOR_SOURCE) {
      throw new Error('Generated manifest must identify the TypeScript generation source as SSOT');
    }
  }

  const oracleParity = options.compareCommitted ? compareToFrozenPythonOracle(outputRoot, afterManifest) : null;
  if (oracleParity && !oracleParity.status) {
    throw new Error(`Frozen Python oracle parity failed for ${oracleParity.mismatches.length} managed artifact(s)`);
  }

  const summary: GenerationSummary = {
    generated_at: afterManifest.generated_at ?? new Date().toISOString(),
    output_dir: options.output,
    requested_adapters: options.adapters,
    executed,
    manifest: {
      path: 'manifest.json',
      generated_by: afterManifest.generated_by ?? FABRICATION_ASSET_GENERATOR_SOURCE,
      source_ssot: afterManifest.source_ssot ?? FABRICATION_ASSET_GENERATOR_SOURCE,
      managed_file_count: listManagedFiles(afterManifest).length,
      updated: generatedManifestUpdated,
    },
    board_final: {
      path: BOARD_FILE,
      has_generated_by_marker: /data-generated-by="scripts\/generate-fabrication-board\.ts"/.test(readText(join(outputRoot, BOARD_FILE))),
    },
    categorySummary,
  };

  const finalSummary = {
    ...summary,
    committed_parity: options.compareCommitted
      ? {
          ...manifestCoverage,
          exact_text_files: committedComparison?.report.exact ?? [],
          semantic_contour_files: committedComparison?.report.contourExact ?? [],
          first_mismatch: committedComparison?.report.firstMismatch,
          board_contour_match: boardParity.status,
          board_first_mismatch: boardParity.firstMismatch,
          generated_manifest: {
            generated_by: afterManifest.generated_by,
            source_ssot: afterManifest.source_ssot,
          },
        }
      : undefined,
    frozen_python_oracle_parity: oracleParity
      ? {
          status: oracleParity.status,
          schema_version: oracleParity.schema_version,
          captured_at: oracleParity.captured_at,
          total: oracleParity.total,
          svg_total: oracleParity.svg_total,
          semantic_contour_files: oracleParity.semanticContours,
          first_mismatch: oracleParity.firstMismatch,
          mismatches: oracleParity.mismatches,
        }
      : undefined,
  };

  process.stdout.write(`${JSON.stringify(finalSummary)}\n`);
};

run();
