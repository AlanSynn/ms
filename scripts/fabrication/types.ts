export type JsonObject = Record<string, unknown>;

export type GeneratorMode = 'board' | 'non-board' | 'all';

export type ManagedCategory =
  | 'board'
  | 'assembly'
  | 'gears'
  | 'ring_gears'
  | 'linkages'
  | 'cams'
  | 'followers'
  | 'brackets'
  | 'handles'
  | 'spacers'
  | 'cam_modules'
  | 'sheets'
  | 'root-readme'
  | 'misc-root'
  | 'manifest';

export const MANAGED_CATEGORIES = [
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

export type TextManifest = Record<string, unknown> & JsonObject;

export type CategoryPathMap = Record<ManagedCategory, string[]>;

export type GenerationInputFileInfo = {
  path: string;
  bytes: number;
};

export type GeneratorAdapter = {
  id: string;
  description: string;
  mode: GeneratorMode;
  sourceSsot: string;
  run: (context: GeneratorContext) => readonly string[];
};

export type GeneratorContext = {
  sourceRoot: string;
  outputRoot: string;
  sourceManifest: FabricationTemplateManifest;
  options: GeneratorOptions;
};

export type GeneratorOptions = {
  output: string;
  includeBoard: boolean;
  includeNonBoard: boolean;
};

export type GeneratorResult = {
  adapter_id: string;
  source_ssot: string;
  output_dir: string;
  status: 'ok' | 'skipped' | 'failed';
  files_generated?: number;
  files_skipped?: number;
  error?: string;
};

export type GenerationSummary = {
  generated_at: string;
  output_dir: string;
  requested_adapters: string[];
  executed: GeneratorResult[];
  manifest: {
    path: string;
    generated_by: string;
    source_ssot: string;
    managed_file_count: number;
    updated: boolean;
  };
  board_final: {
    path: string;
    has_generated_by_marker: boolean;
  };
  categorySummary: CategorySummary[];
};

export type CategorySummary = {
  category: ManagedCategory;
  managed: string[];
  generated: string[];
  missingInGenerated: string[];
  missingInCommitted: string[];
  mismatched: string[];
  exact: string[];
};

export type ManifestByCategory = {
  [key in ManagedCategory]: string[];
};

export type FabricationTemplateManifest = {
  generated_by?: string;
  source_ssot?: string;
  generated_at?: string;
  board_rows?: number;
  board_columns?: number;
  grid_pitch_mm?: number;
  hole_diameter_mm?: number;
  grid_cell_cm?: number;
  managed_files?: unknown;
  board?: unknown;
  [key: string]: unknown;
};

export type ClassifiedFiles = {
  byCategory: ManifestByCategory;
  all: string[];
};
