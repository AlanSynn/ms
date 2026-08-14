import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createFabricationPackage, makeBlueprintPreviewSvg } from "../utils/fabrication";
import { createSampleProject } from "../utils/project";

const artifactEvidence = (value: string) => ({
  bytes: Buffer.byteLength(value, "utf8"),
  sha256: createHash("sha256").update(value).digest("hex"),
});

const project = createSampleProject({ includeMechanism: true });
const fabricationPackage = createFabricationPackage(project);

assert.deepEqual(
  {
    mechanismSvg: artifactEvidence(fabricationPackage.svg),
    mechanismPdf: artifactEvidence(fabricationPackage.cutSheetPdf),
    characterSvg: artifactEvidence(fabricationPackage.customPartsSvg),
    characterPdf: artifactEvidence(fabricationPackage.customPartsPdf),
    assemblyHtml: artifactEvidence(fabricationPackage.assemblyGuideHtml),
    assemblyPdf: artifactEvidence(fabricationPackage.assemblyGuidePdf),
    blueprintPreviewSvg: artifactEvidence(
      makeBlueprintPreviewSvg(project, fabricationPackage.recipes),
    ),
  },
  {
    mechanismSvg: {
      bytes: 58_436,
      sha256: "7243766be8e89c3649d798140a3ac67f813265ad804ca95c6ef2370dd17060de",
    },
    mechanismPdf: {
      bytes: 51_021,
      sha256: "04845047e39784c611fd5be62def4473d49feb19b2649590cff6d026bcbec538",
    },
    characterSvg: {
      bytes: 12_152,
      sha256: "8c182d776a3e6c0060c6fa66f3a4a44e729fec65b4d7201bb1cabd567a0bf091",
    },
    characterPdf: {
      bytes: 12_268,
      sha256: "e00dab4eca440e53dca3f4734a4a405bde06c293a06de2ecf9bb4a55460211e4",
    },
    assemblyHtml: {
      bytes: 11_267,
      sha256: "54f2eddbd5bc52e38548b062ac912024f285101a4d3603a966bfc3be5d785117",
    },
    assemblyPdf: {
      bytes: 1_758,
      sha256: "25afe26df5f4f801ee324ead79a3f9d2d5a435f2a123f179eef2349e45241b87",
    },
    blueprintPreviewSvg: {
      bytes: 69_291,
      sha256: "4b3c0e5bc487eec0467fdc2fe15724a7e5e0a8c5c08e48d3bf243b0e4763a655",
    },
  },
  "the unified live-workbench cutover must not change canonical fabrication or proof bytes",
);

console.log("unified Three export byte golden passed");
