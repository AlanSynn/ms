import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { APP_COMMANDS, commandById } from '../utils/appCommands';
import { createEmptyProject, createSampleProject } from '../utils/project';
import { FEATURE_DESTINATIONS, featureDestinationById, planFeatureReveal, resolveFeatureDestination, validateFeatureDestinations, type FeatureId } from '../utils/featureDestinations';
import { normalizeFeatureQuery, searchFeatures } from '../utils/featureSearch';
import { beginFeatureReveal, type FeatureRevealOptions } from '../hooks/useFeatureReveal';

// Representative queries are deliberately broader than exact labels/aliases.
export const FEATURE_QUERY_CASES: readonly [string, readonly FeatureId[]][] = [
  ['save my work', ['project.save']],
  ['keep for tomorrow', ['project.save']],
  ['save this for tomorrow', ['project.save']],
  ['could I keep my project for next class', ['project.save']],
  ['downlod proj', ['project.save']],
  ['sav', ['project.save']],
  ['open my saved project', ['project.open']],
  ['continue yesterday’s work', ['project.open']],
  ['reopn', ['project.open']],
  ['load my project', ['project.open']],
  ['print body', ['blueprint.customParts']],
  ['paper body pieces', ['blueprint.customParts']],
  ['cut out my person', ['blueprint.customParts']],
  ['body template', ['blueprint.customParts']],
  ['PDF', ['blueprint.pdf', 'blueprint.customParts']],
  ['print', ['blueprint.pdf', 'blueprint.customParts']],
  ['build instructions', ['assembly.steps']],
  ['put the parts together', ['assembly.steps']],
  ['assembel', ['assembly.steps']],
  ['assem', ['stage.assembly', 'assembly.steps']],
  ['draw arm movement', ['path.draw']],
  ['make the hand move', ['path.draw']],
  ['make my character wave', ['path.draw']],
  ['pathw', ['path.draw']],
  ['other arm', ['path.target']],
  ['move another body part', ['path.target']],
  ['second motion', ['path.addMotion']],
  ['add another path', ['path.addMotion']],
  ['switch the line I made', ['path.switchMotion']],
  ['switch existing path', ['path.switchMotion']],
  ['reverse my last change', ['edit.undo']],
  ['undoo', ['edit.undo']],
  ['watch it move', ['playback.play']],
  ['pause animation', ['playback.play']],
  ['slow the animation', ['options.animationSpeed']],
  ['animation spee', ['options.animationSpeed']],
  ['match this curve', ['foundry.fitPath']],
  ['fit my motion', ['foundry.fitPath']],
  ['fit', ['view.fit', 'foundry.fitPath']],
  ['choose a machine', ['foundry.templates']],
  ['machanism choises', ['foundry.templates']],
  ['foundry templates', ['foundry.templates']],
  ['something broke', ['help.feedback']],
  ['suggest an improvement', ['help.feedback']],
  ['what changed', ['help.whatsNew']],
  ['WHAT’S NEW?!', ['help.whatsNew']],
  ['weather tomorrow', []],
  ['pizza oven', []],
  ['save my pizza', []],
  ['cloud sync account', []],
  ['xyzqv', []],
  ['', []],
  ['  ', []],
  ['please can I', []],
];

for (const [query, acceptable] of FEATURE_QUERY_CASES) {
  const found = searchFeatures(query).map(feature => feature.id);
  assert(found.length <= 5, `${query}: results stay compact`);
  if (!acceptable.length) assert.deepEqual(found, [], `${query}: no invented feature`);
  else assert(acceptable.every(id => found.slice(0, 3).includes(id)), `${query}: expected ${acceptable} among first three, got ${found}`);
  assert.deepEqual(searchFeatures(query), searchFeatures(query), `${query}: ranking is deterministic`);
}

assert.equal(normalizeFeatureQuery('  SAVE — my\tWORK?!  '), 'save my work');
assert.equal(searchFeatures('Save Project')[0].id, 'project.save', 'exact command label leads aliases');
assert.equal(searchFeatures('Fit')[0].id, 'view.fit', 'exact Fit label leads broader mechanism aliases');
assert.deepEqual(validateFeatureDestinations(), [], 'every registered destination is valid');
for (const command of APP_COMMANDS) {
  if (command.menuVisible === false || command.id === 'help.findFeature') {
    assert(!FEATURE_DESTINATIONS.some(feature => feature.id === command.id), `${command.id} stays out of student search`);
  }
}
for (const feature of FEATURE_DESTINATIONS) {
  if (feature.commandId) assert.equal(feature.label, commandById(feature.commandId).label, 'canonical command labels have one source');
  assert.notEqual(feature.helpId, 'options.devMode', 'developer help is not searchable');
  assert(featureDestinationById(feature.targetId), `${feature.id} references a registered target`);
}
assert.equal(searchFeatures('portable copy')[0].id, 'project.save', 'historical wording finds the supported Save action');
assert.deepEqual(searchFeatures('dev mode'), [], 'developer controls remain excluded');
assert.deepEqual(searchFeatures('image recognition'), [], 'excluded recognition is not resurrected');

const annotationFiles: Record<string, string> = {
  character: 'components/stages/character/CharacterImportControls.tsx',
  path: 'components/stages/path/PathWorkflowPanel.tsx',
  foundry: 'components/stages/foundry/FoundryWorkflowPanel.tsx',
  design: 'components/stages/mechanism/DesignWorkflowPanel.tsx',
  blueprint: 'components/stages/blueprint/BlueprintControlPanel.tsx',
  assembly: 'components/stages/assembly/AssemblyControlPanel.tsx',
  options: 'components/stages/options/Options.tsx',
  playback: 'components/shell/WorkspacePlayerDock.tsx',
};
for (const feature of FEATURE_DESTINATIONS.filter(feature => !feature.commandId)) {
  const source = readFileSync(annotationFiles[feature.stage!], 'utf8');
  assert(source.includes(`data-feature-id="${feature.id}"`) || source.includes(`featureId="${feature.id}"`), `${feature.id} is explicitly annotated in its stage's actual control source`);
}
const foundryChrome = readFileSync('components/stages/foundry/FoundryCanvasChrome.tsx', 'utf8');
assert(foundryChrome.includes('data-feature-id="playback.play"') && foundryChrome.includes('data-feature-id="playback.scrub"'), 'Foundry playback has the same reveal targets');

const sample = createSampleProject();
const before = JSON.stringify(sample);
for (const feature of FEATURE_DESTINATIONS) planFeatureReveal(feature.id, sample, 'character');
assert.equal(JSON.stringify(sample), before, 'planning every feature preserves the complete project');
const empty = createEmptyProject();
const emptyBefore = JSON.stringify(empty);
const blocked = planFeatureReveal('path.draw', empty, 'character');
assert.deepEqual(blocked, { ok: false, message: 'Load a character first.' });
assert.equal(JSON.stringify(empty), emptyBefore, 'blocked search does not write processing or create a character');
assert.equal(planFeatureReveal('blueprint.customParts', createSampleProject({ includeMechanism: false }), 'character').ok, true, 'printing a character does not invent a mechanism prerequisite');
assert.equal(planFeatureReveal('project.saveAs', sample, 'path').ok, false, 'hidden command cannot be revealed by forged id');
assert.equal(planFeatureReveal('not.a.feature' as FeatureId, sample, 'path').ok, false, 'unknown id has no destination');
for (const stage of ['path', 'design', 'foundry', 'assembly'] as const) {
  assert.equal(resolveFeatureDestination(featureDestinationById('playback.play')!, stage).stage, stage, 'playback stays on current playable stage');
}
assert.equal(resolveFeatureDestination(featureDestinationById('playback.play')!, 'character').stage, 'path');

const calls: string[] = [];
const options: FeatureRevealOptions = {
  rootRef: { current: null }, project: empty, stage: 'character',
  goStage: stage => calls.push(`stage:${stage}`),
  openMenu: menu => calls.push(`menu:${menu}`),
  openSupport: surface => calls.push(`support:${surface}`),
  onStatus: message => calls.push(message),
};
assert.equal(beginFeatureReveal(options, 'path.draw').accepted, false);
assert.deepEqual(calls, ['Load a character first.'], 'failed reveal only reports the prerequisite');
calls.length = 0;
assert.equal(beginFeatureReveal(options, 'help.feedback').accepted, true);
assert.deepEqual(calls, ['support:feedback'], 'feedback result opens the informational surface without any project command');
assert.equal(JSON.stringify(empty), emptyBefore, 'blocked and informational reveal preserve project');

console.log(`Feature search passed: ${FEATURE_QUERY_CASES.length} query cases, destination annotations, prerequisites, and safe planning.`);
