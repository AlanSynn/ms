export type SvgContourSignature = {
  records: string[];
  signature: string;
};

export type SvgContourCompareResult = {
  equal: boolean;
  left?: SvgContourSignature;
  right?: SvgContourSignature;
  firstMismatch?: string;
};

const CONTAINER_TAGS = new Set(['svg', 'defs', 'g']);
const LEAF_TAGS = new Set(['style', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text', 'use']);
const VISIBLE_GEOMETRY_TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'text']);
const IGNORED_TAGS = new Set(['title', 'desc']);
const NUMERIC_ATTRS = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height',
  'textLength', 'data-index', 'data-grid-rows', 'data-grid-columns', 'data-teeth',
  'data-cells', 'data-hole-count', 'data-stack-layer', 'data-part-index',
]);
const NUMERIC_DATA_SUFFIXES = [
  '-mm', '-mm2', '-deg', '-index', '-count', '-teeth', '-lobes', '-cells',
  '-harmonic', '-step', '-layer', '-rows', '-columns',
];
const isNumericDataAttr = (name: string) => name.startsWith('data-')
  && (NUMERIC_DATA_SUFFIXES.some((suffix) => name.endsWith(suffix)) || name.includes('-count-'));
const GEOMETRY_ATTRS = new Set(['d', 'points', 'transform', 'style', 'viewBox']);
const IGNORED_ATTRS = new Set(['xmlns', 'version', 'data-generated-by']);
const NUMBER = '[-+]?(?:\\d+\\.\\d+|\\d+|\\.\\d+)(?:[eE][-+]?\\d+)?';
const NUMERIC_VALUE_RE = new RegExp(`^(${NUMBER})(mm|px)?$`);
const SVG_COMMANDS = 'MmZzLlHhVvCcSsQqTtAa';

const decodeEntities = (value: string) => value
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&amp;/g, '&');

export const normalizeSvgNumber = (raw: string | number) => {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) throw new Error(`Malformed SVG number: ${raw}`);
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : `${rounded}`;
};

const tokenizeNumericStream = (name: string, value: string, allowCommands = false) => {
  const separators = /[\s,]+/y;
  const number = new RegExp(NUMBER, 'y');
  const command = new RegExp(`[${SVG_COMMANDS}]`, 'y');
  const tokens: Array<{ type: 'number' | 'command'; value: string }> = [];
  let index = 0;
  while (index < value.length) {
    separators.lastIndex = index;
    const sep = separators.exec(value);
    if (sep) {
      index = separators.lastIndex;
      continue;
    }
    number.lastIndex = index;
    const num = number.exec(value);
    if (num) {
      normalizeSvgNumber(num[0]);
      tokens.push({ type: 'number', value: num[0] });
      index = number.lastIndex;
      continue;
    }
    if (allowCommands) {
      command.lastIndex = index;
      const cmd = command.exec(value);
      if (cmd) {
        tokens.push({ type: 'command', value: cmd[0] });
        index = command.lastIndex;
        continue;
      }
    }
    throw new Error(`Malformed SVG ${name} token near "${value.slice(index, index + 20)}"`);
  }
  if (!tokens.length) throw new Error(`Malformed SVG ${name} token stream is empty`);
  return tokens;
};

const pathArgCount = (command: string) => ({
  M: 2, L: 2, T: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, A: 7, Z: 0,
}[command.toUpperCase()] ?? -1);

const validatePathTokens = (value: string) => {
  const tokens = tokenizeNumericStream('d', value, true);
  let index = 0;
  let currentCommand = '';
  let sawCommand = false;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.type === 'command') {
      currentCommand = token.value;
      sawCommand = true;
      index += 1;
      const argc = pathArgCount(currentCommand);
      if (argc < 0) throw new Error(`Unsupported SVG path command ${currentCommand}`);
      if (argc === 0) {
        if (index < tokens.length && tokens[index].type === 'number') throw new Error(`Malformed SVG path command ${currentCommand} takes no numbers`);
        continue;
      }
    } else if (!sawCommand) {
      throw new Error('Malformed SVG path numbers before command');
    }

    const argc = pathArgCount(currentCommand);
    if (argc === 0) continue;
    let groupCount = 0;
    while (index < tokens.length && tokens[index].type === 'number') {
      const remainingNumbers = tokens.slice(index).findIndex((entry) => entry.type === 'command');
      const available = remainingNumbers === -1 ? tokens.length - index : remainingNumbers;
      if (available < argc) throw new Error(`Malformed SVG path command ${currentCommand} requires ${argc} numbers`);
      index += argc;
      groupCount += 1;
      if (index < tokens.length && tokens[index].type === 'command') break;
    }
    if (groupCount === 0) throw new Error(`Malformed SVG path command ${currentCommand} missing numbers`);
    if (currentCommand === 'M') currentCommand = 'L';
    if (currentCommand === 'm') currentCommand = 'l';
  }
  return tokens.map((token) => token.type === 'number' ? normalizeSvgNumber(token.value) : token.value).join(' ');
};

const normalizeNumericStream = (name: string, value: string) => {
  if (name === 'd') return validatePathTokens(value);
  const tokens = tokenizeNumericStream(name, value, false);
  if (name === 'viewBox' && tokens.filter((token) => token.type === 'number').length !== 4) {
    throw new Error('Malformed SVG viewBox requires exactly four numbers');
  }
  if (name === 'points' && tokens.some((token) => token.type !== 'number')) {
    throw new Error('Malformed SVG points may contain only numbers');
  }
  if (name === 'points' && tokens.length % 2 !== 0) {
    throw new Error('Malformed SVG points requires x/y pairs');
  }
  return tokens.map((token) => token.type === 'number' ? normalizeSvgNumber(token.value) : token.value).join(' ');
};

const normalizeTransform = (value: string) => {
  const compact = value.trim();
  if (!compact) throw new Error('Malformed SVG transform token stream is empty');
  const transformRe = /([A-Za-z]+)\(([^()]*)\)\s*/gy;
  const arity: Record<string, number[]> = {
    matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1],
  };
  let cursor = 0;
  const normalized: string[] = [];
  while (cursor < compact.length) {
    transformRe.lastIndex = cursor;
    const match = transformRe.exec(compact);
    if (!match || match.index !== cursor) throw new Error(`Malformed SVG transform token near "${compact.slice(cursor, cursor + 20)}"`);
    const [, fn, argsText] = match;
    const range = arity[fn];
    if (!range) throw new Error(`Unsupported SVG transform function ${fn}`);
    const args = tokenizeNumericStream('transform', argsText).map((token) => token.value);
    if (!range.includes(args.length)) throw new Error(`Malformed SVG transform ${fn} arity`);
    normalized.push(`${fn}(${args.map(normalizeSvgNumber).join(' ')})`);
    cursor = transformRe.lastIndex;
  }
  return normalized.join(' ');
};

const normalizeAttrValue = (name: string, value: string) => {
  if (name === 'transform') return normalizeTransform(value);
  if (name === 'd' || name === 'points' || name === 'viewBox') return normalizeNumericStream(name, value);
  if (NUMERIC_ATTRS.has(name) || isNumericDataAttr(name)) {
    const match = value.match(NUMERIC_VALUE_RE);
    if (!match) throw new Error(`Malformed numeric SVG attribute ${name}="${value}"`);
    return `${normalizeSvgNumber(match[1])}${match[2] ?? ''}`;
  }
  return value.trim().replace(/\s+/g, ' ');
};

const CSS_NUMBER_RE = new RegExp(`(${NUMBER})(mm|px)?`, 'g');
const normalizeCssValue = (value: string) => value.replace(CSS_NUMBER_RE, (match, numeric, unit, offset, full) => {
  const before = full[offset - 1] ?? '';
  const after = full[offset + match.length] ?? '';
  if (before === '#' || /[A-Za-z_-]/.test(before) || (!unit && /[A-Za-z_-]/.test(after))) return match;
  return `${normalizeSvgNumber(numeric)}${unit ?? ''}`;
});

const normalizeStyle = (value: string) => {
  const seen = new Set<string>();
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [key, ...rest] = item.split(':');
      if (!key || !rest.length) return item.replace(/\s+/g, ' ');
      const prop = key.trim();
      if (seen.has(prop)) throw new Error(`Duplicate SVG style declaration ${prop}`);
      seen.add(prop);
      return `${prop}:${normalizeCssValue(rest.join(':').trim().replace(/\s+/g, ' '))}`;
    })
    .sort()
    .join(';');
};

const normalizeStyleElement = (value: string) => {
  const compact = value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
  const rules = [...compact.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  if (!rules.length) return compact;
  let cursor = 0;
  const normalized: string[] = [];
  for (const rule of rules) {
    if (rule.index !== cursor) throw new Error(`Malformed SVG style rule near "${compact.slice(cursor, cursor + 20)}"`);
    const selector = rule[1].trim();
    const body = rule[2].split(';').filter(Boolean).join(';');
    normalized.push(`${selector}{${normalizeStyle(body)}}`);
    cursor = rule.index + rule[0].length;
  }
  if (cursor !== compact.length) throw new Error(`Malformed SVG style rule near "${compact.slice(cursor, cursor + 20)}"`);
  return normalized.join('');
};

const parseAttrs = (source: string) => {
  const attrs = new Map<string, string>();
  let rest = source.trim();
  const attrRe = /^([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("[^"]*"|'[^']*')\s*/;
  while (rest) {
    const match = rest.match(attrRe);
    if (!match) throw new Error(`Malformed SVG attributes near: ${rest.slice(0, 40)}`);
    if (attrs.has(match[1])) throw new Error(`Duplicate SVG attribute ${match[1]}`);
    attrs.set(match[1], decodeEntities(match[2].slice(1, -1)));
    rest = rest.slice(match[0].length).trim();
  }
  return attrs;
};

const requiredAttr = (tag: string, attrs: Map<string, string>, name: string) => {
  const value = attrs.get(name);
  if (value === undefined || value.trim() === '') throw new Error(`Malformed SVG <${tag}> missing ${name}`);
  return value;
};

const resolveUseRef = (attrs: Map<string, string>) => {
  const href = attrs.get('href')?.trim();
  const xlinkHref = attrs.get('xlink:href')?.trim();
  const value = href || xlinkHref;
  if (!value) throw new Error('Malformed SVG <use> missing href');
  if (href && xlinkHref && href !== xlinkHref) throw new Error('Malformed SVG <use> href mismatch');
  if (!/^#[^#\s]+$/.test(value)) throw new Error(`Malformed SVG <use> href must be local #id: ${value}`);
  return value.slice(1);
};

const validateVisibleLeaf = (tag: string, attrs: Map<string, string>) => {
  switch (tag) {
    case 'path':
      requiredAttr(tag, attrs, 'd');
      return;
    case 'circle':
      requiredAttr(tag, attrs, 'cx');
      requiredAttr(tag, attrs, 'cy');
      requiredAttr(tag, attrs, 'r');
      return;
    case 'ellipse':
      requiredAttr(tag, attrs, 'cx');
      requiredAttr(tag, attrs, 'cy');
      requiredAttr(tag, attrs, 'rx');
      requiredAttr(tag, attrs, 'ry');
      return;
    case 'rect':
      requiredAttr(tag, attrs, 'width');
      requiredAttr(tag, attrs, 'height');
      return;
    case 'line':
      requiredAttr(tag, attrs, 'x1');
      requiredAttr(tag, attrs, 'y1');
      requiredAttr(tag, attrs, 'x2');
      requiredAttr(tag, attrs, 'y2');
      return;
    case 'polyline':
    case 'polygon':
      requiredAttr(tag, attrs, 'points');
      return;
    case 'use':
      resolveUseRef(attrs);
      return;
    case 'style':
    case 'text':
      return;
    default:
      throw new Error(`Unsupported SVG tag <${tag}>`);
  }
};

const normalizedAttrs = (tag: string, attrs: Map<string, string>) => {
  const kept: string[] = [];
  for (const [name, value] of attrs) {
    if (IGNORED_ATTRS.has(name)) continue;
    let normalized = value.trim().replace(/\s+/g, ' ');
    if (name === 'style') {
      normalized = normalizeStyle(value);
    } else if (GEOMETRY_ATTRS.has(name) || NUMERIC_ATTRS.has(name) || name.startsWith('data-')) {
      normalized = normalizeAttrValue(name, value);
    }
    kept.push(`${name}=${JSON.stringify(normalized)}`);
  }
  kept.sort();
  if (tag === 'svg' && (!attrs.has('viewBox') || !attrs.has('width') || !attrs.has('height'))) {
    throw new Error('Missing svg root dimensions or viewBox');
  }
  return kept.join('|');
};

const normalizeText = (value: string) => decodeEntities(value).replace(/\s+/g, ' ').trim();

export const svgContourSignature = (svg: string): SvgContourSignature => {
  const records: string[] = [];
  const stack: string[] = [];
  const nodeStack: number[] = [];
  const nodes: Array<{ tag: string; id?: string; children: number[]; directVisible: boolean; inDefs: boolean; useRef?: string }> = [];
  const ids = new Map<string, number>();
  const cleaned = svg.replace(/^\uFEFF/, '').replace(/^\s*<\?xml[\s\S]*?\?>\s*/i, '');
  const tokenRe = /<!--([\s\S]*?)-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\/?[A-Za-z][^>]*>|[^<]+/gy;
  let rootSeen = false;
  let ignoredDepth = 0;
  let styleDepth = 0;
  let styleText = '';
  let textDepth = 0;
  let visibleText = '';

  let cursor = 0;
  let rootClosed = false;
  while (cursor < cleaned.length) {
    tokenRe.lastIndex = cursor;
    const match = tokenRe.exec(cleaned);
    if (!match || match.index !== cursor) throw new Error(`Malformed SVG token near: ${cleaned.slice(cursor, cursor + 40)}`);
    cursor = tokenRe.lastIndex;
    const token = match[0];
    if (token.startsWith('<!--')) continue;
    if (!token.startsWith('<')) {
      if (styleDepth) styleText += token;
      else if (textDepth && !ignoredDepth) visibleText += token;
      else if (rootClosed && token.trim()) throw new Error(`Unexpected content after svg root: ${token.trim().slice(0, 40)}`);
      else if (!ignoredDepth && token.trim()) throw new Error(`Unexpected visible SVG text: ${token.trim().slice(0, 40)}`);
      continue;
    }
    if (token.startsWith('<!')) throw new Error(`Unsupported SVG declaration: ${token.slice(0, 30)}`);

    const close = /^<\s*\/\s*([A-Za-z][\w:-]*)\s*>$/.exec(token);
    if (close) {
      const tag = close[1];
      if (ignoredDepth) {
        if (IGNORED_TAGS.has(tag)) ignoredDepth -= 1;
        continue;
      }
      if (tag === 'style') {
        records.push(`style:${normalizeStyleElement(styleText)}`);
        styleDepth = 0;
        styleText = '';
      } else if (tag === 'text') {
        const normalized = normalizeText(visibleText);
        if (!normalized) throw new Error('Malformed SVG <text> missing content');
        records.push(`text-value:${JSON.stringify(normalized)}`);
        const nodeIndex = nodeStack[nodeStack.length - 1];
        if (nodeIndex !== undefined) nodes[nodeIndex].directVisible = true;
        textDepth = 0;
        visibleText = '';
      } else if (CONTAINER_TAGS.has(tag)) {
        records.push(`/${tag}`);
      } else if (!LEAF_TAGS.has(tag)) {
        throw new Error(`Unsupported SVG tag </${tag}>`);
      }
      const expected = stack.pop();
      const closedNodeIndex = nodeStack.pop();
      if (expected !== tag) throw new Error(`Malformed SVG nesting: expected </${expected ?? 'none'}>, got </${tag}>`);
      if (closedNodeIndex === undefined) throw new Error(`Malformed SVG nesting: missing node for </${tag}>`);
      if (tag === 'svg') rootClosed = true;
      continue;
    }

    const open = /^<\s*([A-Za-z][\w:-]*)([\s\S]*?)(\/)?>$/.exec(token);
    if (!open) throw new Error(`Malformed SVG token: ${token.slice(0, 40)}`);
    const tag = open[1];
    const selfClosing = Boolean(open[3]) || /\/$/.test(open[2].trim());
    const attrSource = open[2].replace(/\/\s*$/, '');

    if (ignoredDepth) {
      if (IGNORED_TAGS.has(tag) && !selfClosing) ignoredDepth += 1;
      continue;
    }
    if (IGNORED_TAGS.has(tag)) {
      if (!selfClosing) ignoredDepth = 1;
      continue;
    }
    if (rootClosed) throw new Error(`Unexpected content after svg root: <${tag}>`);
    if (!CONTAINER_TAGS.has(tag) && !LEAF_TAGS.has(tag)) throw new Error(`Unsupported SVG tag <${tag}>`);
    if (!rootSeen && tag !== 'svg') throw new Error('Missing svg root');
    if (tag === 'svg') {
      if (rootSeen) throw new Error('Duplicate svg root');
      rootSeen = true;
    }

    const attrs = parseAttrs(attrSource);
    if (LEAF_TAGS.has(tag)) validateVisibleLeaf(tag, attrs);
    if (tag === 'text' && selfClosing) throw new Error('Malformed SVG <text> missing content');
    const id = attrs.get('id')?.trim();
    if (id) {
      if (ids.has(id)) throw new Error(`Duplicate SVG id ${id}`);
    }
    const nodeIndex = nodes.length;
    nodes.push({
      tag,
      id,
      children: [],
      directVisible: VISIBLE_GEOMETRY_TAGS.has(tag) && tag !== 'text',
      inDefs: false,
      useRef: tag === 'use' ? resolveUseRef(attrs) : undefined,
    });
    if (id) ids.set(id, nodeIndex);
    const parentIndex = nodeStack[nodeStack.length - 1];
    if (parentIndex !== undefined) nodes[parentIndex].children.push(nodeIndex);
    nodes[nodeIndex].inDefs = tag === 'defs' || (parentIndex !== undefined && nodes[parentIndex].inDefs);
    records.push(`${tag}:${normalizedAttrs(tag, attrs)}`);
    if (!selfClosing) {
      stack.push(tag);
      nodeStack.push(nodeIndex);
      if (tag === 'style') styleDepth = 1;
      if (tag === 'text') textDepth = 1;
    }
  }

  if (!rootSeen) throw new Error('Missing svg root');
  if (!rootClosed) throw new Error('Malformed SVG nesting: unclosed <svg>');
  if (stack.length) throw new Error(`Malformed SVG nesting: unclosed <${stack[stack.length - 1]}>`);

  const isVisible = (nodeIndex: number, seen = new Set<number>()): boolean => {
    if (seen.has(nodeIndex)) throw new Error('Malformed SVG <use> reference cycle');
    seen.add(nodeIndex);
    const node = nodes[nodeIndex];
    if (node.directVisible) return true;
    if (node.useRef) {
      const targetIndex = ids.get(node.useRef);
      if (targetIndex === undefined) throw new Error(`Malformed SVG <use> missing target #${node.useRef}`);
      if (!isVisible(targetIndex, seen)) throw new Error(`Malformed SVG <use> target #${node.useRef} has no visible geometry`);
      return true;
    }
    return node.children.some((childIndex) => isVisible(childIndex, new Set(seen)));
  };

  nodes.forEach((node, index) => {
    if (node.useRef) isVisible(index);
  });
  if (!nodes.some((node, index) => !node.inDefs && (node.directVisible || (node.useRef && isVisible(index))))) throw new Error('Missing visible SVG geometry');
  return { records, signature: records.join('\n') };
};

export const compareSvgContours = (leftSvg: string, rightSvg: string): SvgContourCompareResult => {
  const left = svgContourSignature(leftSvg);
  const right = svgContourSignature(rightSvg);
  if (left.signature === right.signature) return { equal: true, left, right };
  const length = Math.max(left.records.length, right.records.length);
  for (let index = 0; index < length; index += 1) {
    if (left.records[index] !== right.records[index]) {
      return {
        equal: false,
        left,
        right,
        firstMismatch: `record ${index}: left=${left.records[index] ?? '<missing>'} right=${right.records[index] ?? '<missing>'}`,
      };
    }
  }
  return { equal: false, left, right, firstMismatch: 'signature mismatch' };
};
