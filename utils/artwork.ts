import type {
  ArtworkDocument, ArtworkOperation, BodyPartLayer, Bounds, Point, ProjectState, SceneObject, Transform,
} from '../types';

export const ARTWORK_LIMITS = Object.freeze({
  operations: 1024,
  pointsPerOperation: 4096,
  pointsPerDocument: 16000,
  totalProjectOperations: 4096,
  totalProjectPoints: 32000,
  coordinate: 100000,
  width: 10000,
  idLength: 120,
});

export type ArtworkOwner = Pick<BodyPartLayer | SceneObject, 'textureUrl' | 'artwork' | 'bounds' | 'fillColor'>;
type ArtworkContent = Omit<ArtworkDocument, 'revision'>;

const fail = (label: string, detail: string): never => {
  throw new Error(`${label}: ${detail}. The original project is unchanged.`);
};
const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label, 'expected an object');
  return value as Record<string, unknown>;
};
const onlyKeys = (value: Record<string, unknown>, keys: readonly string[], label: string) => {
  if (Object.keys(value).some(key => !keys.includes(key))) fail(label, 'unsupported artwork field');
};
const finite = (value: unknown, label: string, positive = false, limit: number = ARTWORK_LIMITS.coordinate): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > limit || (positive && value <= 0)) {
    fail(label, 'use finite artwork coordinates and positive sizes within the classroom limits');
  }
  return value as number;
};
const point = (value: unknown, label: string): Readonly<Point> => {
  const raw = record(value, label);
  onlyKeys(raw, ['x', 'y'], label);
  return Object.freeze({ x: finite(raw.x, label), y: finite(raw.y, label) });
};
const frame = (value: unknown, label: string): Readonly<Bounds> => {
  const raw = record(value, label);
  onlyKeys(raw, ['x', 'y', 'width', 'height'], label);
  return Object.freeze({
    x: finite(raw.x, label), y: finite(raw.y, label),
    width: finite(raw.width, label, true), height: finite(raw.height, label, true),
  });
};
const color = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) {
    fail(label, 'use a hexadecimal artwork color');
  }
  return value as string;
};

export const normalizeArtworkOperation = (value: unknown, label = 'Artwork'): ArtworkOperation => {
  const raw = record(value, label);
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > ARTWORK_LIMITS.idLength) {
    fail(label, 'each artwork operation needs a stable text id');
  }
  const id = raw.id as string;
  const width = () => finite(raw.width, label, true, ARTWORK_LIMITS.width);
  if (raw.kind === 'brush' || raw.kind === 'erase') {
    onlyKeys(raw, raw.kind === 'brush' ? ['id', 'kind', 'points', 'width', 'color'] : ['id', 'kind', 'points', 'width'], label);
    if (!Array.isArray(raw.points) || !raw.points.length || raw.points.length > ARTWORK_LIMITS.pointsPerOperation) {
      fail(label, `each stroke needs 1–${ARTWORK_LIMITS.pointsPerOperation} points`);
    }
    const points = Object.freeze((raw.points as unknown[]).map(value => point(value, label)));
    return Object.freeze(raw.kind === 'brush'
      ? { id, kind: raw.kind, points, width: width(), color: color(raw.color, label) }
      : { id, kind: raw.kind, points, width: width() });
  }
  if (raw.kind === 'line' || raw.kind === 'rectangle' || raw.kind === 'ellipse') {
    onlyKeys(raw, raw.kind === 'line' ? ['id', 'kind', 'from', 'to', 'width', 'color'] : ['id', 'kind', 'from', 'to', 'color'], label);
    const base = { id, from: point(raw.from, label), to: point(raw.to, label), color: color(raw.color, label) };
    return Object.freeze(raw.kind === 'line'
      ? { ...base, kind: raw.kind, width: width() }
      : { ...base, kind: raw.kind });
  }
  return fail(label, 'unsupported artwork operation');
};

/** Deterministic cache revision; independent of owner transforms and cut geometry. */
export const artworkRevision = (document: ArtworkContent): string => {
  const bounds = (value: Readonly<Bounds>) => [value.x, value.y, value.width, value.height];
  const coordinates = (value: Readonly<Point>) => [value.x, value.y];
  const text = JSON.stringify({
    version: document.version, frame: bounds(document.frame),
    sourceImage: document.sourceImage ? [document.sourceImage.asset, bounds(document.sourceImage.frame)] : null,
    operations: document.operations.map(operation => 'points' in operation
      ? [operation.id, operation.kind, operation.points.map(coordinates), operation.width, 'color' in operation ? operation.color : null]
      : [operation.id, operation.kind, coordinates(operation.from), coordinates(operation.to), 'width' in operation ? operation.width : null, operation.color]),
  });
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `art1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
};

const documentFromContent = (content: ArtworkContent): ArtworkDocument => Object.freeze({
  ...content, revision: artworkRevision(content),
});

export const createArtworkDocument = (
  ownerFrame: Bounds,
  options: { sourceImageFrame?: Bounds } = {},
): ArtworkDocument => documentFromContent({
  version: 1,
  frame: frame(ownerFrame, 'Artwork frame'),
  ...(options.sourceImageFrame ? { sourceImage: Object.freeze({
    asset: 'textureUrl' as const, frame: frame(options.sourceImageFrame, 'Original artwork frame'),
  }) } : {}),
  operations: Object.freeze([]),
});

export const artworkPointCount = (document: ArtworkDocument) => document.operations.reduce(
  (total, operation) => total + ('points' in operation ? operation.points.length : 2), 0,
);

export const normalizeArtworkDocument = (
  value: unknown,
  options: { textureUrl?: unknown; label?: string } = {},
): ArtworkDocument | undefined => {
  if (value === undefined) return undefined;
  const label = options.label ?? 'Artwork';
  const raw = record(value, label);
  if (raw.version !== 1) fail(label, 'unsupported artwork version; open this file with a compatible MotionSmith version');
  onlyKeys(raw, ['version', 'frame', 'sourceImage', 'operations', 'revision'], label);
  if (!Array.isArray(raw.operations) || raw.operations.length > ARTWORK_LIMITS.operations) {
    fail(label, `artwork exceeds the ${ARTWORK_LIMITS.operations} operation limit`);
  }
  let sourceImage: ArtworkDocument['sourceImage'];
  if (raw.sourceImage !== undefined) {
    const source = record(raw.sourceImage, label);
    onlyKeys(source, ['asset', 'frame'], label);
    if (source.asset !== 'textureUrl' || typeof options.textureUrl !== 'string' || !options.textureUrl.startsWith('data:image/')) {
      fail(label, 'the original embedded artwork asset is missing');
    }
    sourceImage = Object.freeze({ asset: 'textureUrl', frame: frame(source.frame, label) });
  }
  const operations = Object.freeze((raw.operations as unknown[]).map(value => normalizeArtworkOperation(value, label)));
  if (new Set(operations.map(operation => operation.id)).size !== operations.length) {
    fail(label, 'artwork operation ids must be unique');
  }
  const document = documentFromContent({
    version: 1, frame: frame(raw.frame, label), ...(sourceImage ? { sourceImage } : {}), operations,
  });
  if (artworkPointCount(document) > ARTWORK_LIMITS.pointsPerDocument) fail(label, 'artwork exceeds the point limit');
  if (raw.revision !== document.revision) fail(label, 'artwork revision does not match its retained source');
  return document;
};

export const appendArtworkOperation = (document: ArtworkDocument, value: ArtworkOperation): ArtworkDocument => {
  const operation = normalizeArtworkOperation(value);
  if (document.operations.length >= ARTWORK_LIMITS.operations) fail('Artwork', 'operation limit reached; undo or clear artwork');
  if (document.operations.some(existing => existing.id === operation.id)) fail('Artwork', 'operation id already exists');
  const next = documentFromContent({
    version: 1, frame: document.frame, ...(document.sourceImage ? { sourceImage: document.sourceImage } : {}),
    operations: Object.freeze([...document.operations, operation]),
  });
  if (artworkPointCount(next) > ARTWORK_LIMITS.pointsPerDocument) fail('Artwork', 'point limit reached; undo or clear artwork');
  return next;
};

/** Clear removes initial ink and commands; retained original image bytes stay on the owner. */
export const clearArtwork = (document: ArtworkDocument): ArtworkDocument => createArtworkDocument(document.frame);

/** Check completed edits before dispatch; pointer sampling never scans a project. */
export const assertArtworkEditWithinProjectLimits = (
  project: Pick<ProjectState, 'parts' | 'sceneObjects'>,
  kind: 'part' | 'object',
  id: string,
  nextDocument: ArtworkDocument,
) => {
  let operations = nextDocument.operations.length;
  let points = artworkPointCount(nextDocument);
  for (const [group, owners] of [['part', project.parts], ['object', project.sceneObjects]] as const) {
    for (const [ownerId, owner] of Object.entries(owners)) {
      if (group === kind && ownerId === id) continue;
      if (!owner.artwork) continue;
      operations += owner.artwork.operations.length;
      points += artworkPointCount(owner.artwork);
    }
  }
  if (operations > ARTWORK_LIMITS.totalProjectOperations || points > ARTWORK_LIMITS.totalProjectPoints) {
    throw new Error('Project paint limit reached. Undo or clear some artwork before adding more.');
  }
};

export const artworkOwnerFrame = (owner: ArtworkOwner): Bounds => 'x' in owner.bounds
  ? { ...owner.bounds } as Bounds
  : { x: -owner.bounds.width / 2, y: -owner.bounds.height / 2, width: owner.bounds.width, height: owner.bounds.height };

export const artworkForOwner = (owner: ArtworkOwner): ArtworkDocument => owner.artwork ?? createArtworkDocument(
  artworkOwnerFrame(owner),
  owner.textureUrl ? { sourceImageFrame: artworkOwnerFrame(owner) } : {},
);

export const ownerLocalToScene = (point: Point, transform: Transform): Point => {
  const angle = transform.rotation * Math.PI / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return { x: transform.x + (point.x * cos - point.y * sin) * transform.scale,
    y: transform.y + (point.x * sin + point.y * cos) * transform.scale };
};

export const sceneToOwnerLocal = (point: Point, transform: Transform): Point => {
  if (!Number.isFinite(transform.scale) || transform.scale === 0) throw new Error('Unlock a valid part scale before painting.');
  const angle = -transform.rotation * Math.PI / 180;
  const dx = point.x - transform.x, dy = point.y - transform.y;
  return { x: (dx * Math.cos(angle) - dy * Math.sin(angle)) / transform.scale,
    y: (dx * Math.sin(angle) + dy * Math.cos(angle)) / transform.scale };
};

/** Surface pixels are Y-down; document and scene coordinates are Y-up. */
export const artworkLocalToPixel = (point: Point, target: Bounds, resolution: { width: number; height: number }): Point => ({
  x: (point.x - target.x) * resolution.width / target.width,
  y: (target.y + target.height - point.y) * resolution.height / target.height,
});

export const artworkPixelToLocal = (point: Point, target: Bounds, resolution: { width: number; height: number }): Point => ({
  x: target.x + point.x * target.width / resolution.width,
  y: target.y + target.height - point.y * target.height / resolution.height,
});
