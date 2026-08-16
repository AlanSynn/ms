import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ENABLED = process.env.B695_PERF_PROXY === '1';
const SOAK_MS = Number(process.env.B695_PERF_PROXY_SOAK_MS ?? 5 * 60 * 1000);
const RATES = [4, 6] as const;
const OUTPUT = join(process.cwd(), 'artifacts/b695-visual-lock/final-fixed/performance-proxy.json');

type ProxyResult = {
  cpuRate: number;
  durationMs: number;
  frameCount: number;
  frameIntervalMs: { p50: number; p95: number; p99: number };
  longFrames: number;
  reactAnimationCommits: number;
  diagnosticAttributeWrites: number;
  heap: {
    samples: number;
    firstBytes: number;
    lastBytes: number;
    lastWindowRangeBytes: number;
    plateau: boolean;
  };
};

const openFoundry = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await expect(page.getByTestId('shared-workbench')).toBeVisible();
  await expect(page.locator('#boot-loader')).toHaveCount(0, { timeout: 180_000 });
  const dialog = page.getByTestId('getting-started-dialog');
  if (await dialog.count()) {
    let starter = dialog.getByRole('button', { name: /Open starter rig/i });
    if (!(await starter.count())) {
      const starters = dialog.getByRole('button', { name: 'Starters', exact: true });
      if (await starters.count()) await starters.click();
      starter = dialog.getByRole('button', { name: /Open starter rig/i });
    }
    await starter.click();
  }
  await page.getByTestId('workspace-steps').getByRole('button', { name: /Foundry/i }).click();
  await expect(page.getByTestId('foundry-canvas-pane')).toBeVisible();
};

const collectSoak = async (page: import('@playwright/test').Page, durationMs: number) =>
  page.evaluate(async (duration) => {
    const diagnosticAttributes = new Set([
      'data-three-scene-object-screen-targets',
      'data-three-part-screen-targets',
      'data-three-mechanism-screen-targets',
      'data-three-scene-object-count',
      'data-three-frame-state',
    ]);
    let diagnosticAttributeWrites = 0;
    const observer = new MutationObserver((records) => {
      diagnosticAttributeWrites += records.filter((record) =>
        record.type === 'attributes' && diagnosticAttributes.has(record.attributeName ?? ''),
      ).length;
    });
    observer.observe(document.documentElement, { attributes: true, subtree: true });
    const intervals: number[] = [];
    const heap: number[] = [];
    const start = performance.now();
    let previous = start;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    const heapTimer = window.setInterval(() => {
      if (memory) heap.push(memory.usedJSHeapSize);
    }, 5000);
    await new Promise<void>((resolve) => {
      const tick = (time: number) => {
        intervals.push(time - previous);
        previous = time;
        if (time - start >= duration) resolve();
        else window.requestAnimationFrame(tick);
      };
      window.requestAnimationFrame(tick);
    });
    window.clearInterval(heapTimer);
    observer.disconnect();
    const validIntervals = intervals.filter((value) => value > 0 && value < 2000);
    const quantile = (values: number[], fraction: number) => {
      if (!values.length) return 0;
      const sorted = values.slice().sort((left, right) => left - right);
      return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0;
    };
    const tail = heap.slice(Math.max(0, Math.floor(heap.length * 0.8)));
    const lastMin = tail.length ? Math.min(...tail) : 0;
    const lastMax = tail.length ? Math.max(...tail) : 0;
    const firstBytes = heap[0] ?? 0;
    const lastBytes = heap.at(-1) ?? firstBytes;
    return {
      durationMs: performance.now() - start,
      frameCount: validIntervals.length,
      frameIntervalMs: {
        p50: quantile(validIntervals, 0.5),
        p95: quantile(validIntervals, 0.95),
        p99: quantile(validIntervals, 0.99),
      },
      longFrames: validIntervals.filter((value) => value > 50).length,
      reactAnimationCommits: Math.max(
        0,
        Number((window as Window & { __MOTIONSMITH_REACT_COMMITS__?: number }).__MOTIONSMITH_REACT_COMMITS__ ?? 0) -
          Number((window as Window & { __MOTIONSMITH_REACT_COMMITS_BEFORE__?: number }).__MOTIONSMITH_REACT_COMMITS_BEFORE__ ?? 0),
      ),
      diagnosticAttributeWrites,
      heap: {
        samples: heap.length,
        firstBytes,
        lastBytes,
        lastWindowRangeBytes: lastMax - lastMin,
        plateau: tail.length >= 2 && lastMax - lastMin < Math.max(8 * 1024 * 1024, firstBytes * 0.15),
      },
    };
  }, durationMs);

test.describe('b695 production CPU proxy', () => {
  test.skip(!ENABLED, 'run with B695_PERF_PROXY=1 to run the five-minute production proxy');
  test('4x and 6x throttled Foundry playback stays bounded', async ({ browser }) => {
    test.setTimeout(0);
    await mkdir(join(process.cwd(), 'artifacts/b695-visual-lock/final-fixed'), { recursive: true });
    const results: ProxyResult[] = [];
    for (const cpuRate of RATES) {
      const context = await browser.newContext();
      await context.addInitScript(() => {
        const target = window as Window & { __MOTIONSMITH_REACT_COMMITS__?: number };
        target.__MOTIONSMITH_REACT_COMMITS__ = 0;
        Object.defineProperty(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
          configurable: true,
          value: {
            supportsFiber: true,
            renderers: new Map(),
            inject: () => 1,
            onCommitFiberRoot: () => {
              target.__MOTIONSMITH_REACT_COMMITS__ = (target.__MOTIONSMITH_REACT_COMMITS__ ?? 0) + 1;
            },
            onCommitFiberUnmount: () => undefined,
          },
        });
      });
      const page = await context.newPage();
      const client = await context.newCDPSession(page);
      await client.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
      await openFoundry(page);
      await page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Play' }).click();
      await page.evaluate(() => {
        const target = window as Window & {
          __MOTIONSMITH_REACT_COMMITS__?: number;
          __MOTIONSMITH_REACT_COMMITS_BEFORE__?: number;
        };
        target.__MOTIONSMITH_REACT_COMMITS_BEFORE__ = target.__MOTIONSMITH_REACT_COMMITS__ ?? 0;
      });
      const result = await collectSoak(page, SOAK_MS);
      await page.getByTestId('foundry-toolbar').getByRole('button', { name: 'Pause' }).click();
      results.push({ cpuRate, ...result });
      await context.close();
    }
    await writeFile(OUTPUT, `${JSON.stringify({
      productionBuild: true,
      actualChromebookTested: false,
      soakMs: SOAK_MS,
      results,
    }, null, 2)}\n`, 'utf8');
    expect(results).toHaveLength(RATES.length);
    for (const result of results) {
      expect(result.reactAnimationCommits, `${result.cpuRate}x React animation commits`).toBe(0);
      expect(result.diagnosticAttributeWrites, `${result.cpuRate}x diagnostic writes`).toBe(0);
      expect(result.heap.plateau, `${result.cpuRate}x heap plateau`).toBe(true);
    }
  });
});
