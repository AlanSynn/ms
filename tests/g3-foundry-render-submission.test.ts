import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../components/stages/foundry/ThreeFoundryPreview.tsx",
    import.meta.url,
  ),
  "utf8",
);

assert.equal(
  source.match(/\.render\(/g)?.length,
  1,
  "Foundry has one renderer submission site",
);
assert.match(
  source,
  /const renderCamera = \([\s\S]*?queueFrameRender\(screenTargetOverride\);\n  };/,
  "camera changes enter the shared frame queue",
);
assert.match(
  source,
  /queuedRenderer\.render\(queuedScene, queuedCamera\);[\s\S]*?if \(queuedBindingTable\)/,
  "the queued submission writes retained-frame diagnostics after rendering",
);

console.log("G3 Foundry render submission contract passed");
