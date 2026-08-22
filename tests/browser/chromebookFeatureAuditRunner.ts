import {
  expect,
  type Browser,
  type CDPSession,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";

import { CHROMEBOOK_AUDIT_ENVIRONMENT } from "./chromebookAuditReport";
import { CHROMEBOOK_AUDIT_PROFILE } from "./chromebookAuditProfiles";
import {
  type ChromebookFeatureAuditReport,
  type ChromebookFeatureName,
  type FeatureAudit,
} from "./chromebookFeatureAuditReport";
import {
  applyChromebookEmulation,
  collectChromebookRuntimeEnvironment,
  installChromebookAuditInstrumentation,
  installChromebookAuditIsolation,
} from "./chromebookAuditHarness";
import { collectChromebookAuditProvenance } from "./chromebookAuditProvenance";

const ENFORCE = process.env.CHROMEBOOK_AUDIT_ENFORCE !== "0";
const OUTPUT = process.env.CHROMEBOOK_FEATURE_AUDIT_OUTPUT
  ?? join(process.cwd(), "artifacts/chromebook-audit/features");

type RunChromebookFeatureAuditOptions = {
  browser: Browser;
  testInfo: TestInfo;
  name: ChromebookFeatureName;
  setup?: (page: Page) => Promise<void>;
  prepare?: (page: Page) => Promise<void>;
  workload?: ChromebookFeatureAuditReport["workload"];
  audit: (page: Page, client: CDPSession) => Promise<FeatureAudit>;
};

const externalOutputPath = (
  name: ChromebookFeatureName,
  repeatEachIndex: number,
) => {
  const templated = OUTPUT
    .replace("{feature}", name)
    .replace("{repeat}", String(repeatEachIndex));
  if (templated !== OUTPUT) return templated;
  if (extname(OUTPUT).toLowerCase() === ".json") {
    return `${OUTPUT.slice(0, -5)}-${name}.json`;
  }
  return join(OUTPUT, `chromebook-feature-${name}-audit.json`);
};

const writeReport = async (
  report: ChromebookFeatureAuditReport,
  testInfo: TestInfo,
) => {
  const json = `${JSON.stringify(report, null, 2)}\n`;
  const testOutput = testInfo.outputPath(
    `chromebook-feature-${report.feature.name}-audit.json`,
  );
  await mkdir(dirname(testOutput), { recursive: true });
  await writeFile(testOutput, json, "utf8");
  await testInfo.attach(`chromebook-feature-${report.feature.name}-audit`, {
    path: testOutput,
    contentType: "application/json",
  });
  const externalOutput = externalOutputPath(
    report.feature.name,
    testInfo.repeatEachIndex,
  );
  await mkdir(dirname(externalOutput), { recursive: true });
  await writeFile(externalOutput, json, "utf8");
};

export const runChromebookFeatureAudit = async ({
  browser,
  testInfo,
  name,
  setup,
  prepare,
  workload = "production-feature",
  audit,
}: RunChromebookFeatureAuditOptions) => {
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Chromebook feature audit requires a preview base URL");
  }
  const auditBrowser = await browser.browserType().launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-precise-memory-info"],
  });
  const context = await auditBrowser.newContext({
    baseURL,
    acceptDownloads: true,
    viewport: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
    screen: CHROMEBOOK_AUDIT_ENVIRONMENT.viewport,
    deviceScaleFactor: CHROMEBOOK_AUDIT_ENVIRONMENT.deviceScaleFactor,
  });
  await installChromebookAuditInstrumentation(context);
  const page = await context.newPage();
  const client = await installChromebookAuditIsolation(page);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    await setup?.(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#boot-loader")).toHaveCount(0, {
      timeout: 180_000,
    });
    expect(
      await page.locator('script[src*="/@vite/client"]').count(),
      "feature audit runs the production preview",
    ).toBe(0);
    await prepare?.(page);
    await applyChromebookEmulation(page, client);

    try {
      const feature = await audit(page, client);
      expect(feature.name).toBe(name);
      const passed = feature.acceptance.passed.passed;
      const report: ChromebookFeatureAuditReport = {
        schemaVersion: 3,
        generatedAt: new Date().toISOString(),
        profile: CHROMEBOOK_AUDIT_PROFILE.name,
        resultLabel: CHROMEBOOK_AUDIT_PROFILE.resultLabel,
        productionBuild: true,
        actualChromebookTested: false,
        provenance: await collectChromebookAuditProvenance(baseURL),
        runtimeProbe: "browser-api-ownership-v1",
        workload,
        environment: await collectChromebookRuntimeEnvironment(
          page,
          auditBrowser.version(),
          "feature-action",
        ),
        feature,
        acceptance: {
          passed: { passed, observed: passed, limit: true },
        },
      };
      await writeReport(report, testInfo);

      expect(pageErrors, "feature audit has no uncaught page errors").toEqual([]);
      if (ENFORCE) {
        for (const [checkName, check] of Object.entries(feature.acceptance)) {
          expect(
            check.passed,
            `${feature.name}.${checkName}: observed ${check.observed}, limit ${check.limit}`,
          ).toBe(true);
        }
      }
      return report;
    } finally {
      await client.detach().catch(() => undefined);
    }
  } finally {
    await context.close().catch(() => undefined);
    await auditBrowser.close().catch(() => undefined);
  }
};
