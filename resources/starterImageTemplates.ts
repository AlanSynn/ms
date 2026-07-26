import type { StarterImageTemplate } from "../components/AppShell";
import girlStarterThumbUrl from "./examples/thumbs/girl-thumb.png?url";
import boyStarterThumbUrl from "./examples/thumbs/boy-thumb.png?url";
import girlStarterPackageUrl from "./examples/packages/girl.motionsmith.json?url";
import boyStarterPackageUrl from "./examples/packages/boy.motionsmith.json?url";

export const STARTER_IMAGE_TEMPLATES: StarterImageTemplate[] = [
  {
    id: "girl",
    label: "Girl",
    fileName: "girl.png",
    thumbUrl: girlStarterThumbUrl,
    packageUrl: girlStarterPackageUrl,
  },
  {
    id: "boy",
    label: "Boy",
    fileName: "boy.PNG",
    thumbUrl: boyStarterThumbUrl,
    packageUrl: boyStarterPackageUrl,
  },
];
