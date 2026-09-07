import type { FeatureId } from './featureDestinations';

export type ReleaseHighlight = {
  title: string;
  text: string;
  destination?: FeatureId;
  image?: { path: string; alt: string };
};
export type ReleaseNote = {
  id: string;
  version: string;
  highlights: readonly ReleaseHighlight[];
};

// Keep IDs stable through rebuilds and copy corrections. Versions select the
// notes shipped with this build; no runtime changelog request is made.
export const RELEASE_NOTES: readonly ReleaseNote[] = [{
  id: 'classroom-return-v1',
  version: '0.0.14',
  highlights: [{
    title: 'Open your project',
    text: 'Choose your saved .motionsmith file for the next class.',
    destination: 'project.open',
  }, {
    title: 'Your working view',
    text: 'See your character, paths, and mechanism together in Project.',
    destination: 'stage.project',
    image: {
      path: 'release-notes/classroom-return-v1.png',
      alt: 'Project showing an edited character, two paths, a star, and its four-bar mechanism.',
    },
  }, {
    title: 'Two paths',
    text: 'Use Add path to choose another body part, then play both paths.',
    destination: 'path.addMotion',
  }],
}, {
  id: 'student-support-v1',
  version: '0.0.14',
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

export const releaseNoteForVersion = (
  version: string,
  entries: readonly ReleaseNote[] = RELEASE_NOTES,
) => entries.find(entry => entry.version === version);

export const releaseImageUrl = (path: string, base: string) => `${base}${path}`;
