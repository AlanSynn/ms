import type { MechanismConfig, MechanismType } from '../types';
import { REFERENCE_AUTHORABLE_TYPES, REFERENCE_FOUNDRY_TYPES, referenceRecipeForType } from './mechanismReference';

export interface MechanismTemplateMetadata {
    label: string;
    sense: string;
    goodFor: string;
    constraint: string;
    authorable: boolean;
}

export const ALL_MECHANISM_TYPES: readonly MechanismType[] = [
    'crank',
    '4bar',
    'piston',
    'yoke',
    'quick-return',
    '5bar',
    '6bar',
    'cam',
    'rack-pinion',
    'gear',
    'gear_linkage',
    'planetary_gear'
] as const;

export const AUTHORABLE_MECHANISM_TYPES: readonly MechanismType[] = REFERENCE_AUTHORABLE_TYPES;
export const FOUNDRY_MECHANISM_TYPES: readonly MechanismType[] = REFERENCE_FOUNDRY_TYPES;

export const MECHANISM_TEMPLATE_LIBRARY: Record<MechanismType, MechanismTemplateMetadata> = {
    crank: {
        label: 'Crank driver',
        sense: 'single rotating input sets phase for simple cyclic motion',
        goodFor: 'baseline timing checks and downstream driver primitives',
        constraint: 'use as low-level driver metadata; novice authoring should choose a full linkage template',
        authorable: false
    },
    '4bar': {
        label: 'Four-bar linkage',
        sense: 'crank, coupler, and rocker turn rotation into an arcing output point',
        goodFor: 'limb swings and repeatable character gestures',
        constraint: 'show sampled safe angle range; partial rotation is acceptable when warned',
        authorable: true
    },
    piston: {
        label: 'Slider piston',
        sense: 'rotation pushes a rod along one linear slide',
        goodFor: 'push-pull limbs, doors, and props',
        constraint: 'maps to the reference slider_crank recipe; guide is fixed, slider is moving',
        authorable: true
    },
    yoke: {
        label: 'Scotch yoke (simulation)',
        sense: 'pin-in-slot motion converts rotation to straight reciprocation',
        goodFor: 'compact back-and-forth travel',
        constraint: 'simulation only until a mechanism-reference recipe exists',
        authorable: false
    },
    'quick-return': {
        label: 'Quick-return (simulation)',
        sense: 'uneven timing makes one stroke faster than the return stroke',
        goodFor: 'snappy mechanical accents',
        constraint: 'simulation only until a mechanism-reference recipe exists',
        authorable: false
    },
    '5bar': {
        label: 'Five-bar (simulation)',
        sense: 'two cranks combine phases for wider two-arm tracing',
        goodFor: 'complex foot or hand trajectories',
        constraint: 'content/simulation only; no fabrication-ready recipe yet',
        authorable: false
    },
    '6bar': {
        label: 'Six-bar (simulation)',
        sense: 'a four-bar base drives a second dyad so a follower point traces richer compound arcs',
        goodFor: 'hands, feet, and character parts that need more nuanced paths than a simple four-bar',
        constraint: 'content/simulation only; no fabrication-ready recipe yet',
        authorable: false
    },
    cam: {
        label: 'Cam follower',
        sense: 'cam radius lifts a follower from a rotating disk profile',
        goodFor: 'timed bumps and repeated lifts',
        constraint: 'follower guide and cam disk must stay aligned',
        authorable: true
    },
    'rack-pinion': {
        label: 'Rack and pinion (unsupported)',
        sense: 'a rotating pinion walks a toothed rack along a straight guide',
        goodFor: 'PaperMech-style up-down or open-close linear travel',
        constraint: 'unsupported until a rack/pinion kit contract is added to mechanism-reference',
        authorable: false
    },
    gear: {
        label: 'Gear train',
        sense: 'paired gears transfer rotation through a fixed ratio',
        goodFor: 'reversing or scaling rotation',
        constraint: 'ratio sign and gear size decide output direction',
        authorable: true
    },
    gear_linkage: {
        label: 'Gear linkage',
        sense: 'paired G3 gears drive an off-center L4 crank linkage from the output gear',
        goodFor: 'gear-driven waving arms and rotary-to-orbiting linkage handles',
        constraint: 'output linkage attaches to the gear handle hole only, never to the board',
        authorable: true
    },
    planetary_gear: {
        label: 'Planetary gear',
        sense: 'sun and planet gears compound rotation in a small footprint',
        goodFor: 'dense rotary assemblies',
        constraint: 'extra gears need spacing and clear labels in the recipe',
        authorable: true
    }
};

export const FOUNDRY_PRESETS: Record<string, Partial<MechanismConfig> & { label: string; recommendation: string }> = {
    balanced: { label: 'Balanced recommendation', recommendation: 'general purpose linkage with printable proportions' },
    compact: {
        label: 'Compact',
        recommendation: 'smaller footprint for tight board placement',
        groundLength: 120,
        couplerLength: 120,
        rockerLength: 80
    },
    broad: {
        label: 'Broad sweep',
        recommendation: 'larger output sweep when board space allows',
        groundLength: 220,
        couplerLength: 210,
        rockerLength: 150
    }
};

export const mechanismTemplateLabel = (type: MechanismType): string =>
    MECHANISM_TEMPLATE_LIBRARY[type]?.label ?? type;

export const mechanismTemplateOptionLabel = (type: MechanismType): string => {
    const recipe = referenceRecipeForType(type);
    return recipe.exportReady ? `${mechanismTemplateLabel(type)} · ${recipe.canonicalKey}` : `${mechanismTemplateLabel(type)} · ${recipe.support}`;
};
