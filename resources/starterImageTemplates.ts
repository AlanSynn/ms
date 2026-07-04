import type { StarterImageTemplate } from "../components/AppShell";
import girlStarterUrl from "./examples/raw/girl.png?url";
import boyStarterUrl from "./examples/raw/boy.PNG?url";
import girlStarterThumbUrl from "./examples/thumbs/girl-thumb.png?url";
import boyStarterThumbUrl from "./examples/thumbs/boy-thumb.png?url";

export const STARTER_IMAGE_TEMPLATES: StarterImageTemplate[] = [
  {
    id: "girl",
    label: "Girl",
    fileName: "girl.png",
    url: girlStarterUrl,
    thumbUrl: girlStarterThumbUrl,
  },
  {
    id: "boy",
    label: "Boy",
    fileName: "boy.PNG",
    url: boyStarterUrl,
    thumbUrl: boyStarterThumbUrl,
  },
];
