import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const hook = readFileSync('hooks/useAppOnnxBootstrap.ts', 'utf8');
const pill = readFileSync('components/shell/OnnxCacheStatusPill.tsx', 'utf8');
const worker = readFileSync('workers/webOnnxCacheWorker.ts', 'utf8');
assert(hook.includes('stage: "missing"'), 'boot starts with an explicit unloaded AI status');
assert(!hook.includes('useEffect') && !hook.includes('requestIdleCallback') && !hook.includes('setTimeout('), 'boot does not schedule an AI cache request');
assert(hook.includes('prepareModel') && hook.includes('warmWebOnnxCacheInWorker(setOnnxCacheStatus)'), 'explicit AI preparation uses the worker cache seam');
assert(worker.includes('worker.onmessage') && worker.includes('cache.put') && worker.includes('download disconnected after'), 'AI cache preparation validates and stores bytes off the main thread');
assert(hook.includes('const cacheOnnxModel') && hook.includes('const result = await prepareModel()'), 'the cache button is the explicit AI preparation action');
assert(pill.includes("status.stage === 'cached' || status.stage === 'available'") && pill.includes("status.stage === 'checking'") && pill.includes("'AI preparing…'") && pill.includes("ready ? 'cached' : status.stage"), 'explicit preparation keeps a compact cache status');

console.log('b695 AI on-demand contract ok');
