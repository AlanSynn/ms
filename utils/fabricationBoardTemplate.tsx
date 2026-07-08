import { boardCoordinateLabel } from './coordinates';

export const FABRICATION_BOARD_DEFAULT_CELL_COUNT = 15;
export const FABRICATION_BOARD_DEFAULT_PITCH_MM = 20;
export const FABRICATION_BOARD_DEFAULT_HOLE_DIAMETER_MM = 4;

const DRILL = '#0071bc';
const SCORE = '#777777';
const TEXT = '#333333';
const ENGRAVE_TEXT = '#008000';
const BOARD_FILL = '#ffffff';

export interface BoardTemplateMetadata {
  /** SVG data key for downstream tooling. */
  profileKey: string;
  /** Number of board rows (A..O). */
  rows: number;
  /** Number of board columns (1..15). */
  columns: number;
  /** Board hole pitch in mm. */
  pitchMm: number;
  /** Hole diameter in mm. */
  holeDiameterMm: number;
  /** Optional board role contract tag. */
  role?: 'main-board' | 'assembly-board-map' | string;
}

export interface BoardTemplateOptions {
  /** Profile key that produced the board contract. */
  profileKey?: string;
  /** Board rows count. */
  rows?: number;
  /** Board columns count. */
  columns?: number;
  /** Board pitch in mm. */
  pitchMm?: number;
  /** Hole diameter in mm. */
  holeDiameterMm?: number;
  /** Optional board role (`main-board` or `assembly-board-map`). */
  role?: BoardTemplateMetadata['role'];
  /** Override board title text. */
  title?: string;
  /** Override board description text. */
  description?: string;
}

const safeRows = (rows: number | undefined) => (Number.isFinite(rows ?? 0) ? Math.max(1, Math.floor(rows ?? 0)) : 1);
const safeColumns = (columns: number | undefined) => (Number.isFinite(columns ?? 0) ? Math.max(1, Math.floor(columns ?? 0)) : 1);

const toAxisLabel = (rowIndex: number) => {
  if (rowIndex < 26) return String.fromCharCode(65 + rowIndex);
  let value = rowIndex;
  let letters = '';
  while (value >= 0) {
    letters = String.fromCharCode((value % 26) + 65) + letters;
    value = Math.floor(value / 26) - 1;
  }
  return letters;
};

const attrs = (values: Record<string, string | number>) =>
  Object.entries(values)
    .map(([name, value]) => `${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`)
    .join(' ');

const escapeText = (value: string | number) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

export const makeFabricationBoardTemplateSpec = (options: BoardTemplateOptions = {}): BoardTemplateMetadata => {
  const rows = safeRows(options.rows);
  const columns = safeColumns(options.columns);
  const pitchMm = Number(options.pitchMm) > 0 ? options.pitchMm as number : FABRICATION_BOARD_DEFAULT_PITCH_MM;
  const holeDiameterMm = Number(options.holeDiameterMm) > 0 ? options.holeDiameterMm as number : FABRICATION_BOARD_DEFAULT_HOLE_DIAMETER_MM;
  return {
    profileKey: options.profileKey ?? 'motionsmith-ms4n',
    rows,
    columns,
    pitchMm,
    holeDiameterMm,
    role: options.role,
  };
};

/**
 * Build the canonical fabrication board template as a string.
 *
 * The function is pure + dependency-light so both Node tooling and app runtime
 * clients can generate a board contract without relying on Python scripts.
 */
export const makeFabricationBoardTemplateSvg = (options: BoardTemplateOptions = {}) => {
  const metadata = makeFabricationBoardTemplateSpec(options);
  const sideCount = Math.max(metadata.rows, metadata.columns);
  const boardSizeMm = metadata.pitchMm * Math.max(1, sideCount - 1);
  const margin = 15;
  const widthMm = boardSizeMm + 2 * margin;
  const heightMm = widthMm;
  const step = boardSizeMm / Math.max(1, sideCount - 1);
  const holeRadius = metadata.holeDiameterMm / 2;
  const title = options.title ??
    (metadata.role === 'main-board'
      ? `MotionSmith ${metadata.rows}x${metadata.columns} main board`
      : `Automataii ${metadata.rows}x${metadata.columns} board map`);
  const desc = options.description ??
    `Main fabrication board with ${metadata.holeDiameterMm} mm holes and engraved A-${toAxisLabel(metadata.columns - 1)}/${metadata.rows} coordinates.`;

  const boardRole = metadata.role ?? 'assembly-board-map';
  const rootData = attrs({
    'data-board-role': boardRole,
    'data-grid-columns': metadata.columns,
    'data-grid-rows': metadata.rows,
    'data-grid-pitch-mm': metadata.pitchMm,
    'data-hole-diameter-mm': metadata.holeDiameterMm,
    'data-profile-key': metadata.profileKey,
  });

  const rows: string[] = [];
  const labelsRows: string[] = [];
  const labelCols: string[] = [];
  const holeClass = 'drill board-hole';
  const outerInset = 5;

  rows.push(
    `<rect x="${margin - outerInset}" y="${margin - outerInset}" width="${boardSizeMm + outerInset * 2}" height="${boardSizeMm + outerInset * 2}" class="score board-outline"/>`
  );

  for (let row = 0; row < metadata.rows; row += 1) {
    const label = toAxisLabel(row);
    const x = margin + row * step;
    labelsRows.push(`<text ${attrs({ x, y: margin - 7, class: 'coord-label', 'text-anchor': 'middle' })} data-axis="horizontal" data-index="${row + 1}" data-label="${label}">${escapeText(label)}</text>`);
  }
  for (let col = 0; col < metadata.columns; col += 1) {
    const label = String(col + 1);
    const y = margin + col * step;
    labelCols.push(`<text ${attrs({ x: margin - 7, y, class: 'coord-label', 'text-anchor': 'end' })} data-axis="vertical" data-index="${col + 1}" data-label="${label}">${escapeText(label)}</text>`);
  }

  for (let row = 0; row < metadata.rows; row += 1) {
    for (let col = 0; col < metadata.columns; col += 1) {
      const coord = boardCoordinateLabel(col, row);
      const cx = margin + col * step;
      const cy = margin + row * step;
      rows.push(`<circle ${attrs({ cx, cy, r: holeRadius, class: holeClass })} data-board-coord="${coord}"/>`);
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" ${rootData}>
  <title>${escapeText(title)}</title>
  <desc>${escapeText(desc)}</desc>
  <defs>
    <style>
      .drill { fill: none; stroke: ${DRILL}; stroke-width: 0.2; stroke-miterlimit: 10; }
      .score { fill: none; stroke: ${SCORE}; stroke-width: 0.15; stroke-dasharray: 2 1; }
      .label { fill: ${TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 4px; }
      .engrave { fill: ${ENGRAVE_TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 3.2px; font-weight: bold; }
      .tiny { fill: ${TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 3px; }
      .small { fill: ${TEXT}; font-family: Arial, Helvetica, sans-serif; font-size: 3.6px; }
      .coord-label { fill: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 6px; font-weight: bold; }
      .paper { fill: ${BOARD_FILL}; stroke: none; }
    </style>
  </defs>
  <g id="layer-board-grid" class="board-grid">
${labelsRows.map(line => `    ${line}`).join('\n')}
${labelCols.map(line => `    ${line}`).join('\n')}
${rows.map(line => `    ${line}`).join('\n')}
  </g>
</svg>`;
};
