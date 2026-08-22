type MotionSmithPerformanceAudit = {
  foundryTopologyBuilds?: number;
  foundryGeometryCacheSize?: number;
  foundryMaterialCacheSize?: number;
  foundryGestureVisualEmissions?: number[];
  puppetTopologyDurations?: number[];
  projectActionCounts?: Record<string, number>;
};

export const recordPuppetTopologyBuild = (durationMs: number) => {
  const audit = activePerformanceAudit();
  if (!audit) return;
  audit.puppetTopologyDurations ??= [];
  audit.puppetTopologyDurations.push(durationMs);
};

const activePerformanceAudit = () =>
  (window as Window & {
    __MOTIONSMITH_CHROMEBOOK_AUDIT__?: MotionSmithPerformanceAudit;
  }).__MOTIONSMITH_CHROMEBOOK_AUDIT__;

export const recordFoundryTopologyBuild = (
  geometryCacheSize: number,
  materialCacheSize: number,
) => {
  const audit = activePerformanceAudit();
  if (!audit) return;
  audit.foundryTopologyBuilds = (audit.foundryTopologyBuilds ?? 0) + 1;
  audit.foundryGeometryCacheSize = geometryCacheSize;
  audit.foundryMaterialCacheSize = materialCacheSize;
};

export const recordFoundryGestureVisualEmission = () => {
  const audit = activePerformanceAudit();
  if (!audit) return;
  audit.foundryGestureVisualEmissions ??= [];
  audit.foundryGestureVisualEmissions.push(performance.now());
};

export const recordProjectAction = (type: string) => {
  const audit = activePerformanceAudit();
  if (!audit) return;
  audit.projectActionCounts ??= {};
  audit.projectActionCounts[type] = (audit.projectActionCounts[type] ?? 0) + 1;
};
