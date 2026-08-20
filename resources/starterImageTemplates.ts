import type { StarterImageTemplate } from "../components/AppShell";
import girlStarterUrl from "./examples/raw/girl.png?url";
import boyStarterUrl from "./examples/raw/boy.png?url";

export const STARTER_IMAGE_TEMPLATES: StarterImageTemplate[] = [
  {
    id: "girl",
    label: "Girl",
    fileName: "girl.png",
    url: girlStarterUrl,
    thumbUrl: girlStarterUrl,
  },
  {
    id: "boy",
    label: "Boy",
    fileName: "boy.png",
    url: boyStarterUrl,
    thumbUrl: boyStarterUrl,
  },
];
