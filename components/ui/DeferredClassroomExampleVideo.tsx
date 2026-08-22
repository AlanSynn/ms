import { lazy, Suspense } from "react";

import type { ClassroomMechanismUseExample } from "../../utils/classroomContent";

const LazyClassroomExampleVideo = lazy(async () => ({
  default: (await import("./ClassroomExampleVideo")).ClassroomExampleVideo,
}));

export const DeferredClassroomExampleVideo = ({
  example,
}: {
  example?: ClassroomMechanismUseExample;
}) => (
  <Suspense fallback={null}>
    <LazyClassroomExampleVideo example={example} />
  </Suspense>
);
