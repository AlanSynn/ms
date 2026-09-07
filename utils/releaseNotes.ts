import type { FeatureId } from './featureDestinations';

export type ReleaseHighlight = {
  title: string;
  text: string;
  destination?: FeatureId;
  // New highlights require focused runtime screenshots. Optional only for the
  // four archived text-only exceptions pinned by the support contract test.
  image?: { path: string; alt: string };
};
export type ReleaseNote = {
  id: string;
  version: string;
  highlights: readonly ReleaseHighlight[];
};

// Append new entries; preserve published IDs, content, and assets unless the
// owner explicitly requests removal. Older releases remain bundled and readable.
// Versions record when an update shipped, not which build may display it.
export const RELEASE_NOTES: readonly ReleaseNote[] = [{
  id: 'release-history-v1',
  version: '0.0.15',
  highlights: [{
    title: 'Earlier updates',
    text: "Open What's new any time to read earlier updates.",
  }],
}, {
  id: 'classroom-return-v1',
  version: '0.0.15',
  highlights: [{
    title: 'Open your project',
    text: 'Choose your saved .motionsmith file for the next class.',
    destination: 'project.open',
  }, {
    title: 'Your working view',
    text: 'See your character, paths, and mechanism together in Project.',
    destination: 'stage.project',
    image: {
      path: 'release-notes/project-working-view-v1.png',
      alt: 'Project view showing the character, its motion path, and the mechanism together.',
    },
  }, {
    title: 'Two paths',
    text: 'Use Add path to choose another body part, then play both paths.',
    destination: 'path.addMotion',
  }],
}, {
  id: 'student-support-v1',
  version: '0.0.15',
  highlights: [{
    title: 'Find a feature',
    text: 'Search in your own words and jump to the control you need.',
    destination: 'path.target',
    image: {
      path: 'release-notes/find-feature-v1.png',
      alt: 'Find a feature showing motion controls for another arm.',
    },
  }, {
    title: 'Share a problem or idea',
    text: 'Write feedback here and preview a screenshot before sending.',
    destination: 'help.feedback',
  }],
}];

const versionParts = (version: string) => {
  if (!/^[0-9]+[.][0-9]+[.][0-9]+$/.test(version)) return undefined;
  const parts = version.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
};

const compareVersions = (left: number[], right: number[]) =>
  left[0] - right[0] || left[1] - right[1] || left[2] - right[2];

/** All bundled stable releases available in this build, newest first. */
export const releaseNotesForVersion = (
  version: string,
  entries: readonly ReleaseNote[] = RELEASE_NOTES,
): readonly ReleaseNote[] => {
  const current = versionParts(version);
  if (!current) return [];
  return entries
    .map(entry => ({ entry, parts: versionParts(entry.version) }))
    .filter((item): item is { entry: ReleaseNote; parts: number[] } =>
      !!item.parts && compareVersions(item.parts, current) <= 0)
    .sort((left, right) => compareVersions(right.parts, left.parts))
    .map(({ entry }) => entry);
};

export const releaseNoteForVersion = (
  version: string,
  entries: readonly ReleaseNote[] = RELEASE_NOTES,
) => releaseNotesForVersion(version, entries)[0];

export const releaseImageUrl = (path: string, base: string) => `${base}${path}`;
