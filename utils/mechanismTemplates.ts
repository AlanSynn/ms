import type { MechanismConfig, MechanismType } from '../types';

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
    'cam',
    'gear',
    'planetary_gear'
] as const;

export const AUTHORABLE_MECHANISM_TYPES: readonly MechanismType[] = ALL_MECHANISM_TYPES
    .filter(type => type !== 'crank');

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
        constraint: 'rod length and slider offset must keep the guide printable',
        authorable: true
    },
    yoke: {
        label: 'Scotch yoke',
        sense: 'pin-in-slot motion converts rotation to straight reciprocation',
        goodFor: 'compact back-and-forth travel',
        constraint: 'slot stroke must stay inside the board profile',
        authorable: true
    },
    'quick-return': {
        label: 'Quick-return linkage',
        sense: 'uneven timing makes one stroke faster than the return stroke',
        goodFor: 'snappy mechanical accents',
        constraint: 'review partial range before export',
        authorable: true
    },
    '5bar': {
        label: 'Five-bar linkage',
        sense: 'two cranks combine phases for wider two-arm tracing',
        goodFor: 'complex foot or hand trajectories',
        constraint: 'phase and second speed decide path shape and collision risk',
        authorable: true
    },
    cam: {
        label: 'Cam follower',
        sense: 'cam radius lifts a follower from a rotating disk profile',
        goodFor: 'timed bumps and repeated lifts',
        constraint: 'follower guide and cam disk must stay aligned',
        authorable: true
    },
    gear: {
        label: 'Gear train',
        sense: 'paired gears transfer rotation through a fixed ratio',
        goodFor: 'reversing or scaling rotation',
        constraint: 'ratio sign and gear size decide output direction',
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

export const mechanismTemplateOptionLabel = (type: MechanismType): string =>
    `${mechanismTemplateLabel(type)} · ${type}`;
