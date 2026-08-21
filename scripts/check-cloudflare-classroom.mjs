import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const target = new URL(
  process.env.CLOUDFLARE_CLASSROOM_URL ?? "https://motionsmith.org/",
);
const expectedVersion = `v${packageJson.version}`;
const forbiddenRequest =
  /(?:cloudflareinsights|\/cdn-cgi\/rum|onnx|onnxruntime|ort(?:-|\.|\/)|image[-_]?recognition|\.wasm(?:\?|$))/i;

const browser = await chromium.launch({
  headless: true,
  args: ["--enable-unsafe-swiftshader"],
});

try {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    screen: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  const requestedUrls = [];
  const failedRequests = [];
  const pageErrors = [];
  page.on("request", (request) => requestedUrls.push(request.url()));
  page.on("requestfailed", (request) => {
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    });
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  const openClassroomPage = async (pathname) => {
    const url = new URL(pathname, target);
    url.searchParams.set("release-check", packageJson.version);
    const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
    assert(response, `${url.pathname} did not return a navigation response`);
    assert.equal(response.status(), 200, `${url.pathname} must return HTTP 200`);
    assert.match(
      response.headers()["content-type"] ?? "",
      /^text\/html\b/i,
      `${url.pathname} must resolve through the classroom SPA shell`,
    );
    await page.waitForFunction(() => document.body.classList.contains("app-ready"));
    await page.locator('[data-testid="getting-started-dialog"]').waitFor({ state: "visible" });
    assert(
      (await page.locator(".workflow-rail-version").allTextContents()).includes(expectedVersion),
      `${url.pathname} must boot the tagged ${expectedVersion} release`,
    );
    const html = await page.content();
    assert(
      !/(?:static\.cloudflareinsights\.com|data-cf-beacon|\/cdn-cgi\/rum)/i.test(html),
      `${url.pathname} must not contain an injected analytics beacon`,
    );
  };

  await openClassroomPage("/");
  await openClassroomPage("/path/editor");

  const externalRequests = [...new Set(requestedUrls)].filter((value) => {
    const url = new URL(value);
    return url.origin !== target.origin;
  });
  const forbiddenRequests = [...new Set(requestedUrls)].filter((value) =>
    forbiddenRequest.test(value)
  );
  const serviceWorkerCount = await page.evaluate(async () =>
    "serviceWorker" in navigator
      ? (await navigator.serviceWorker.getRegistrations()).length
      : 0
  );

  assert.deepEqual(externalRequests, [], "classroom boot must not depend on external origins");
  assert.deepEqual(
    forbiddenRequests,
    [],
    "classroom boot must not request analytics, image recognition, ONNX/ORT, or WASM",
  );
  assert.deepEqual(failedRequests, [], "classroom boot must not contain failed requests");
  assert.deepEqual(pageErrors, [], "classroom boot must not raise page errors");
  assert.equal(serviceWorkerCount, 0, "classroom boot must not register a service worker");

  process.stdout.write(`${JSON.stringify({
    target: target.origin,
    version: expectedVersion,
    navigations: ["/", "/path/editor"],
    requestCount: requestedUrls.length,
    externalRequestCount: externalRequests.length,
    forbiddenRequestCount: forbiddenRequests.length,
    serviceWorkerCount,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
