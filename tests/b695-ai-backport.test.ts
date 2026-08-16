import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const hook = readFileSync('hooks/useAppOnnxBootstrap.ts', 'utf8');
const pill = readFileSync('components/shell/OnnxCacheStatusPill.tsx', 'utf8');
const effect = hook.slice(hook.indexOf('useEffect(() => {'), hook.indexOf('}, []);', hook.indexOf('useEffect(() => {')));

assert(!effect.includes('warmWebOnnxCache'), 'boot effect does not warm the ONNX model');
assert(!effect.includes('new Worker'), 'boot effect does not create an AI worker');
assert(hook.includes('stage: "available"') && effect.includes('setOnnxCacheStatus(initialOnnxCacheStatus)'), 'boot publishes lazy-ready status without claiming a cache read');
assert(hook.includes('warmWebOnnxCache(setOnnxCacheStatus)'), 'explicit cache action still warms the model');
assert(pill.includes("status.stage === 'cached' || status.stage === 'available'") && pill.includes("ready ? 'cached' : status.stage"), 'lazy-ready status preserves the cached visual and disabled interaction');

console.log('b695 AI backport contract ok');
