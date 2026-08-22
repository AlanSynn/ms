export const CHROMEBOOK_AUDIT_PROFILE_NAMES = [
  "regression-4x",
  "acceptance-6x",
] as const;

export type ChromebookAuditProfileName =
  (typeof CHROMEBOOK_AUDIT_PROFILE_NAMES)[number];

export type ChromebookAuditPurpose = "regression" | "acceptance";

export type ChromebookCpuThrottleDisclosure = {
  mechanism: "cdp-emulation-set-cpu-throttling-rate";
  requestedSlowdownRate: 4 | 6;
  pageTargetMainThread: "requested";
  dedicatedWorkerTargets: "not-attached-or-calibrated";
  calibration: {
    basis: "relative-to-current-host";
    physicalDeviceMatched: false;
    devtoolsCalibratedPreset: false;
  };
};

export type ChromebookAuditEnvironment = {
  profile: ChromebookAuditProfileName;
  purpose: ChromebookAuditPurpose;
  browser: "chrome";
  viewport: { width: 1366; height: 768 };
  deviceScaleFactor: 1 | 2;
  cpuThrottlingRate: 4 | 6;
  cpuThrottleDisclosure: ChromebookCpuThrottleDisclosure;
  network: {
    name: "bounded-classroom-wifi";
    latencyMs: 40;
    downloadBytesPerSecond: 1_310_720;
    uploadBytesPerSecond: 655_360;
  };
};

export type ChromebookAuditProfile = {
  name: ChromebookAuditProfileName;
  purpose: ChromebookAuditPurpose;
  resultLabel: "4x CPU regression emulation" | "6x CPU acceptance emulation";
  officialAcceptance: boolean;
  environment: ChromebookAuditEnvironment;
};

const sharedEnvironment = {
  browser: "chrome",
  viewport: { width: 1366, height: 768 },
  deviceScaleFactor: 1,
  network: {
    name: "bounded-classroom-wifi",
    latencyMs: 40,
    downloadBytesPerSecond: 1_310_720,
    uploadBytesPerSecond: 655_360,
  },
} as const;

const profile = (
  name: ChromebookAuditProfileName,
  purpose: ChromebookAuditPurpose,
  rate: 4 | 6,
  resultLabel: ChromebookAuditProfile["resultLabel"],
): ChromebookAuditProfile => ({
  name,
  purpose,
  resultLabel,
  officialAcceptance: purpose === "acceptance",
  environment: {
    ...sharedEnvironment,
    profile: name,
    purpose,
    cpuThrottlingRate: rate,
    cpuThrottleDisclosure: {
      mechanism: "cdp-emulation-set-cpu-throttling-rate",
      requestedSlowdownRate: rate,
      pageTargetMainThread: "requested",
      dedicatedWorkerTargets: "not-attached-or-calibrated",
      calibration: {
        basis: "relative-to-current-host",
        physicalDeviceMatched: false,
        devtoolsCalibratedPreset: false,
      },
    },
  },
});

export const CHROMEBOOK_AUDIT_PROFILES = {
  "regression-4x": profile(
    "regression-4x",
    "regression",
    4,
    "4x CPU regression emulation",
  ),
  "acceptance-6x": profile(
    "acceptance-6x",
    "acceptance",
    6,
    "6x CPU acceptance emulation",
  ),
} as const satisfies Record<ChromebookAuditProfileName, ChromebookAuditProfile>;

export const resolveChromebookAuditProfile = (
  value = process.env.CHROMEBOOK_AUDIT_PROFILE,
): ChromebookAuditProfile => {
  const name = value ?? "acceptance-6x";
  if (!CHROMEBOOK_AUDIT_PROFILE_NAMES.includes(
    name as ChromebookAuditProfileName,
  )) {
    throw new Error(
      `CHROMEBOOK_AUDIT_PROFILE must be one of ${CHROMEBOOK_AUDIT_PROFILE_NAMES.join(
        ", ",
      )}; received ${JSON.stringify(name)}`,
    );
  }
  return CHROMEBOOK_AUDIT_PROFILES[name as ChromebookAuditProfileName];
};

export const CHROMEBOOK_AUDIT_PROFILE = resolveChromebookAuditProfile();
