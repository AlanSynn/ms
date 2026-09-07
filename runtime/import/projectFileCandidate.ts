import type { ProjectState } from "../../types";
import { loadProjectSnapshot } from "../../utils/project";
import { APP_STATE_VERSION, projectStateFromPortableDocument } from "../../utils/projectSerialization";
import { validateProjectImportShape } from "./projectImportPolicy";
import { validateProjectRasterSources } from "./projectRasterImportPolicy";
import { characterFabricationHoles } from '../../utils/characterFabricationHoles';
import { validatePhysicalOutline } from '../../utils/shapeEditing';

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};

/** Required artwork must be in the file; migration must not hide a missing asset. */
const validateRequiredArtwork = (raw: Record<string, unknown>) => {
  for (const [group, entries] of [["Part", raw.parts], ["Scene object", raw.sceneObjects]] as const) {
    for (const [id, value] of Object.entries(record(entries))) {
      const source = record(value).textureUrl;
      if (source !== undefined && (typeof source !== "string" || !source.startsWith("data:image/"))) {
        throw new Error(`${group} ${id} artwork is missing from this project file.`);
      }
    }
  }
  const info = record(record(raw.characterPackage).partsInfo);
  const declaredParts = record(record(info.character).parts ?? info.parts);
  const parts = record(raw.parts);
  for (const [id, declaration] of Object.entries(declaredParts)) {
    const asset = record(declaration).texture_path ?? record(declaration).image_path;
    if (typeof asset === "string" && asset && parts[id] && !record(parts[id]).textureUrl) {
      throw new Error(`Part ${id} is missing required artwork ${asset.slice(0, 120)}.`);
    }
  }
};

/** File validity is independent of the smaller browser-backup capacity. */
export const readProjectFileCandidate = (document: unknown): ProjectState => {
  const raw = projectStateFromPortableDocument(document);
  validateProjectImportShape(raw);
  const data = record(raw);
  if (data.version !== undefined && data.version !== 1 && data.version !== APP_STATE_VERSION) {
    throw new Error("Unsupported project version. Open it with a compatible MotionSmith version.");
  }
  if (!data.metadata || !data.settings) {
    throw new Error("Choose a full MotionSmith project file.");
  }
  validateRequiredArtwork(data);
  // Validate before migration as well: normalization can discard unsafe sources.
  validateProjectRasterSources(raw);
  const project = loadProjectSnapshot(raw);
  validateProjectImportShape(project);
  validateProjectRasterSources(project);
  const authoredParts = Object.values(project.parts).filter(part => part.artwork && part.contourSource === 'user');
  if (authoredParts.length) {
    const holes = characterFabricationHoles(project);
    for (const part of authoredParts) {
      const result = validatePhysicalOutline(part.contourPoints, { attachments: holes.get(part.id) ?? [] });
      if (!result.ok) throw new Error(`${part.name}: ${result.blocker} The original project is unchanged.`);
    }
  }
  return project;
};
