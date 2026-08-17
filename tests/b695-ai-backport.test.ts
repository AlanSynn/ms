import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const hook = readFileSync('hooks/useAppOnnxBootstrap.ts', 'utf8');
const pill = readFileSync('components/shell/OnnxCacheStatusPill.tsx', 'utf8');
const worker = readFileSync('workers/webOnnxCacheWorker.ts', 'utf8');
const effectStart = hook.indexOf('useEffect(() => {');
const effect = hook.slice(effectStart, hook.indexOf('  }, [warmInBackground]);', effectStart));

assert(effect.includes('warmInBackground') && effect.includes('requestIdleCallback'), 'AI cache preparation is scheduled after the workspace effect');
assert(!effect.includes('new Worker'), 'boot effect does not create an AI worker');
assert(hook.includes('stage: "available"') && effect.includes('setOnnxCacheStatus(initialOnnxCacheStatus)'), 'boot publishes an immediately usable status before background preparation');
assert(hook.includes('warmWebOnnxCacheInWorker(setOnnxCacheStatus)') && hook.includes('setTimeout(start, 700)'), 'background cache preparation uses a worker with a fallback idle schedule');
assert(worker.includes('worker.onmessage') && worker.includes('cache.put') && worker.includes('download disconnected after'), 'AI cache preparation validates and stores bytes off the main thread');
assert(hook.includes('warmInBackground()'), 'explicit cache action reuses background preparation');
assert(pill.includes("status.stage === 'cached' || status.stage === 'available'") && pill.includes("status.stage === 'checking'") && pill.includes("'AI preparing…'") && pill.includes("ready ? 'cached' : status.stage"), 'background preparation has an explicit non-blocking status');

console.log('b695 AI background-prep contract ok');
