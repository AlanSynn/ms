import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { type ClassifiedFiles, type FabricationTemplateManifest, type ManagedCategory } from './types';

export const FABRICATION_ASSET_GENERATOR_SOURCE = 'scripts/generate-fabrication-assets.ts' as const;
export const FABRICATION_ASSET_TEMPLATE_DIR = 'scripts/fabrication/source' as const;
export const FABRICATION_ASSET_TEMPLATE_MANIFEST = `${FABRICATION_ASSET_TEMPLATE_DIR}/manifest.template.json` as const;

export type TemplateCategoryBuckets = Record<ManagedCategory, string[]>;

const normalizeCategory = (path: string): ManagedCategory => {
  if (path === 'board-final.svg' || path === 'board.svg' || path === 'assembly/board.svg') return 'board';
  if (path === 'README.md') return 'root-readme';
  if (path === 'manifest.json') return 'manifest';
  const root = path.split('/')[0];
  switch (root) {
    case 'assembly':
      return 'assembly';
    case 'gears':
      return 'gears';
    case 'ring_gears':
      return 'ring_gears';
    case 'linkages':
      return 'linkages';
    case 'cams':
      return 'cams';
    case 'followers':
      return 'followers';
    case 'brackets':
      return 'brackets';
    case 'handles':
      return 'handles';
    case 'spacers':
      return 'spacers';
    case 'cam_modules':
      return 'cam_modules';
    case 'sheets':
      return 'sheets';
    case 'manifest.json':
      return 'manifest';
    default:
      return 'misc-root';
  }
};

export const loadTemplateManifest = (): FabricationTemplateManifest => {
  if (!existsSync(FABRICATION_ASSET_TEMPLATE_MANIFEST)) {
    throw new Error(`Missing template manifest: ${FABRICATION_ASSET_TEMPLATE_MANIFEST}`);
  }
  return JSON.parse(readFileSync(FABRICATION_ASSET_TEMPLATE_MANIFEST, 'utf8')) as FabricationTemplateManifest;
};

const makeBucketTemplate = (): TemplateCategoryBuckets => ({
  board: [],
  assembly: [],
  gears: [],
  ring_gears: [],
  linkages: [],
  cams: [],
  followers: [],
  brackets: [],
  handles: [],
  spacers: [],
  cam_modules: [],
  sheets: [],
  'root-readme': [],
  'misc-root': [],
  manifest: [],
});

export const classifyTemplateFiles = (manifest: FabricationTemplateManifest): ClassifiedFiles => {
  const managedFiles = Array.isArray(manifest.managed_files) ? manifest.managed_files : [];
  const byCategory = makeBucketTemplate();

  for (const relPath of managedFiles) {
    if (typeof relPath !== 'string' || !relPath) continue;
    const category = normalizeCategory(relPath);
    byCategory[category].push(relPath);
  }

  const all = [...managedFiles].filter((item): item is string => typeof item === 'string').sort();
  Object.values(byCategory).forEach((paths) => paths.sort());

  const sourceRoot = resolve(process.cwd(), FABRICATION_ASSET_TEMPLATE_DIR);
  const missing = all.filter((relPath) => relPath !== 'manifest.json' && !existsSync(join(sourceRoot, relPath)));
  if (missing.length > 0) {
    throw new Error(`Template source is missing managed files: ${missing.join(', ')}`);
  }

  return { byCategory, all };
};
