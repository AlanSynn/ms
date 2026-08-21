import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const emittedStaticSpecifier = /(?:\bfrom\s*|\bimport\s*)(["'])(\.\/[^"']+)\1/g;

export const staticImportSpecifiers = (source) => [
  ...source.matchAll(emittedStaticSpecifier),
].map((match) => match[2]);

export const collectStaticImportClosure = async (entryFiles) => {
  const pending = [...entryFiles.map((file) => resolve(file))];
  const closure = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (!file || closure.has(file)) continue;
    closure.add(file);
    if (!file.endsWith('.js')) continue;
    const source = await readFile(file, 'utf8');
    for (const specifier of staticImportSpecifiers(source)) {
      const dependency = resolve(dirname(file), specifier);
      if (!closure.has(dependency)) pending.push(dependency);
    }
  }
  return [...closure].sort();
};
