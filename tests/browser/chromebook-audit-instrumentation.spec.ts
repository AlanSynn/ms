import { expect, test } from "@playwright/test";

import {
  collectPlaybackAudit,
  installChromebookAuditInstrumentation,
} from "./chromebookAuditHarness";
import { evaluateChromebookPlaybackAcceptance } from "./chromebookAuditReport";

test("Chromebook WebGL probe tracks identities and real GL submissions", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await installChromebookAuditInstrumentation(context);
  const page = await context.newPage();

  try {
    await page.goto("data:text/html,<canvas id='probe'></canvas>");
    const result = await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
      if (!gl) throw new Error("WebGL is required for the audit probe contract");

      const first = gl.createTexture();
      const second = gl.createTexture();
      if (!first || !second) throw new Error("WebGL texture creation failed");
      gl.bindTexture(gl.TEXTURE_2D, first);
      gl.bindTexture(gl.TEXTURE_2D, second);
      gl.deleteTexture(first);
      gl.deleteTexture(first);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.clear(gl.COLOR_BUFFER_BIT);
      canvas?.dispatchEvent(new Event("webglcontextlost"));
      canvas?.dispatchEvent(new Event("webglcontextrestored"));

      const audit = (window as Window & {
        __MOTIONSMITH_CHROMEBOOK_AUDIT__?: {
          webglFrameSubmissions: number[];
          webgl: {
            contextsLost: number;
            contextsRestored: number;
            resources: Record<
              string,
              { created: number; deleted: number; live: number; peakLive: number }
            >;
          };
        };
      }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;
      return {
        texture: audit?.webgl.resources.texture,
        submissions: audit?.webglFrameSubmissions.length ?? 0,
        contextsLost: audit?.webgl.contextsLost ?? 0,
        contextsRestored: audit?.webgl.contextsRestored ?? 0,
        secondTextureStillLive: gl.isTexture(second),
      };
    });

    expect(result.texture).toEqual({
      created: 2,
      deleted: 1,
      live: 1,
      peakLive: 2,
    });
    expect(result.secondTextureStillLive).toBe(true);
    expect(result.submissions).toBe(2);
    expect(result.contextsLost).toBe(1);
    expect(result.contextsRestored).toBe(1);
  } finally {
    await context.close();
  }
});

test("a frozen renderer cannot pass on a healthy host rAF loop", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await installChromebookAuditInstrumentation(context);
  const page = await context.newPage();

  try {
    await page.goto("data:text/html,<canvas id='probe'></canvas>");
    await page.evaluate(() => {
      const canvas = document.querySelector("canvas");
      const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl");
      if (!gl) throw new Error("WebGL is required for the frozen renderer contract");
    });
    const playback = await collectPlaybackAudit(page, 100);
    const acceptance = evaluateChromebookPlaybackAcceptance(
      playback,
      { p50: 0, p95: 0, p99: 0 },
    );

    expect(playback.eventLoopRaf.sampleCount).toBeGreaterThan(0);
    expect(playback.frameCount).toBe(0);
    expect(acceptance.renderSubmissionsObserved.passed).toBe(false);
    expect(acceptance.passed.passed).toBe(false);
  } finally {
    await context.close();
  }
});
