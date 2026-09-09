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
  id: 'classroom-motion-cues-v1',
  version: '0.0.17',
  highlights: [{
    title: 'Compare recommendation scores',
    text: 'Open ? beside Recommendation score to see how to compare motions without treating the number as a grade.',
    destination: 'stage.design',
    image: { path: 'release-notes/recommendation-score-v1.png', alt: 'Recommendation score 81 beside its question-mark help control.' },
  }, {
    title: 'Draw a motion path',
    text: 'In Draw mode, a cue reminds you to draw where the selected part should move.',
    destination: 'path.draw',
    image: { path: 'release-notes/path-drawing-cue-v1.png', alt: 'The Drawing control with the cue: Draw where the selected part should move, not the shape of the part.' },
  }, {
    title: 'Read the motion',
    text: 'Each recommended mechanism now names its input and output motion directly beneath its name.',
    destination: 'stage.design',
    image: { path: 'release-notes/recommendation-motion-v1.png', alt: 'Gear linkage recommendation with Two driven gears -> linked point moves beneath its name.' },
  }],
}, {
  id: 'paint-and-draw-v1',
  version: '0.0.16',
  highlights: [{
    title: 'Paint your character',
    text: 'Use Draw & paint to add faces and details that appear in Assembly and Download Build PDF.',
    destination: 'character.drawPaint',
    image: { path: 'release-notes/paint-character-v1.png', alt: 'A painted face with a red band, green center, dark eyes and smile, and one attachment hole.' },
  }, {
    title: 'Draw your own prop',
    text: 'Choose Draw object, paint a prop, and use Change shape to edit its cut outline.',
    destination: 'character.drawObject',
    image: { path: 'release-notes/draw-object-v1.png', alt: 'A blue rocket with a yellow window, red stripe, and a custom physical outline.' },
  }],
}, {
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
