import type { AppStage } from '../types';
import { contextHelpFor } from './contextHelp';
import { FEATURE_DESTINATIONS, resolveFeatureDestination, type FeatureDestination } from './featureDestinations';

export const normalizeFeatureQuery = (value: string) => value
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');

const STOP_WORDS = new Set(['a', 'an', 'and', 'are', 'can', 'could', 'do', 'does', 'for', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'please', 'some', 'that', 'the', 'there', 'this', 'to', 'want', 'way', 'we', 'where', 'with', 'would', 'you', 'your']);
const tokens = (value: string) => normalizeFeatureQuery(value).split(' ').filter(token => token && !STOP_WORDS.has(token));

/** One insertion, deletion, substitution, or adjacent transposition. */
const isOneTypo = (left: string, right: string) => {
  if (Math.min(left.length, right.length) < 4 || Math.abs(left.length - right.length) > 1) return false;
  if (left === right) return false;
  if (left.length === right.length) {
    const mismatches: number[] = [];
    for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) mismatches.push(i);
    if (mismatches.length === 1) return true;
    const [first, second] = mismatches;
    return mismatches.length === 2 && second === first + 1 && left[first] === right[second] && left[second] === right[first];
  }
  const shorter = left.length < right.length ? left : right;
  const longer = left.length < right.length ? right : left;
  let index = 0;
  while (index < shorter.length && shorter[index] === longer[index]) index += 1;
  return shorter.slice(index) === longer.slice(index + 1);
};

const tokenScore = (query: string, candidate: string) => {
  if (query === candidate) return 10;
  if (query.length >= 3 && candidate.startsWith(query)) return 7;
  return isOneTypo(query, candidate) ? 4 : 0;
};

const phraseScore = (query: string, queryTokens: string[], phrase: string, label: boolean) => {
  const normalized = normalizeFeatureQuery(phrase);
  if (query === normalized) return label ? 1200 : 1100;
  const phraseTokens = tokens(phrase);
  if (!phraseTokens.length) return 0;
  const scores = queryTokens.map(token => Math.max(0, ...phraseTokens.map(candidate => tokenScore(token, candidate))));
  // All meaningful query words must be explained by a phrase; avoid one broad word
  // making an unrelated sentence appear to match a feature.
  if (!scores.length || scores.some(score => score === 0)) return 0;
  const exact = scores.filter(score => score === 10).length;
  const prefix = normalized.startsWith(query) && query.length >= 3;
  const phraseExact = queryTokens.join(' ') === phraseTokens.join(' ');
  const average = scores.reduce((total, value) => total + value, 0) / scores.length;
  return (phraseExact ? 850 : prefix ? 700 : 400) + average * 20 + exact * 4 + (label ? 30 : 0)
    - Math.max(0, phraseTokens.length - queryTokens.length) * 2;
};

const scoreFeature = (query: string, queryTokens: string[], feature: FeatureDestination) => {
  const labelScore = phraseScore(query, queryTokens, feature.label, true);
  const aliasScore = Math.max(0, ...feature.aliases.map(alias => phraseScore(query, queryTokens, alias, false)));
  const help = feature.helpId ? contextHelpFor(feature.helpId) : undefined;
  const helpScore = help ? Math.max(phraseScore(query, queryTokens, help.title, false), phraseScore(query, queryTokens, help.body, false)) * 0.65 : 0;
  const descriptionScore = phraseScore(query, queryTokens, feature.description, false) * 0.55;
  // Mix vocabulary from curated phrases for new wording such as "save for
  // tomorrow" or "slow the animation", below any strong phrase match.
  const vocabulary = tokens([feature.label, ...feature.aliases, feature.stage ?? ''].join(' '));
  const coverage = queryTokens.map(token => Math.max(0, ...vocabulary.map(candidate => tokenScore(token, candidate))));
  const combinedScore = coverage.every(score => score > 0)
    ? 400 + coverage.reduce((sum, score) => sum + score, 0) / coverage.length * 7 : 0;
  return Math.max(labelScore, aliasScore, helpScore, descriptionScore, combinedScore);
};

export type FeatureSearchResult = ReturnType<typeof resolveFeatureDestination> & { score: number };

export const searchFeatures = (input: string, stage: AppStage = 'character'): FeatureSearchResult[] => {
  const query = normalizeFeatureQuery(input).slice(0, 160);
  const queryTokens = tokens(query);
  if (query.length < 2 || !queryTokens.length) return [];
  return FEATURE_DESTINATIONS
    .map(feature => ({ ...resolveFeatureDestination(feature, stage), score: scoreFeature(query, queryTokens, feature) }))
    .filter(result => result.score >= 400)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .slice(0, 5);
};
