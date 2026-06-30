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
        goodFor: 'Timing',
        constraint: 'use as low-level driver metadata; novice authoring should choose a full linkage template',
        authorable: false
    },
    '4bar': {
        label: 'Four-bar linkage',
        sense: 'crank, coupler, and rocker turn rotation into an arcing output point',
        goodFor: 'Swing',
        constraint: 'Show range',
        authorable: true
    },
    piston: {
        label: 'Slider piston',
        sense: 'rotation pushes a rod along one linear slide',
        goodFor: 'Push-pull',
        constraint: 'maps to the reference slider_crank recipe; guide is fixed, slider is moving',
        authorable: true
    },
    yoke: {
        label: 'Scotch yoke',
        sense: 'pin-in-slot motion converts rotation to straight reciprocation',
        goodFor: 'Back-forth',
        constraint: 'simulation placeholder',
        authorable: false
    },
    'quick-return': {
        label: 'Quick-return',
        sense: 'uneven timing makes one stroke faster than the return stroke',
        goodFor: 'Snap',
        constraint: 'simulation placeholder',
        authorable: false
    },
    '5bar': {
        label: 'Five-bar',
        sense: 'two cranks combine phases for wider two-arm tracing',
        goodFor: 'Complex path',
        constraint: 'simulation only',
        authorable: false
    },
    '6bar': {
        label: 'Six-bar',
        sense: 'a four-bar base drives a second dyad so a follower point traces richer compound arcs',
        goodFor: 'Compound path',
        constraint: 'simulation only',
        authorable: false
    },
    cam: {
        label: 'Cam follower',
        sense: 'cam radius lifts a follower from a rotating disk profile',
        goodFor: 'Lift',
        constraint: 'follower guide and cam disk must stay aligned',
        authorable: true
    },
    'rack-pinion': {
        label: 'Rack and pinion',
        sense: 'a rotating pinion walks a toothed rack along a straight guide',
        goodFor: 'Linear travel',
        constraint: 'unsupported in v1',
        authorable: false
    },
    gear: {
        label: 'Gear train',
        sense: 'paired gears transfer rotation through a fixed ratio',
        goodFor: 'Reverse/scale',
        constraint: 'Mesh ratio',
        authorable: true
    },
    gear_linkage: {
        label: 'Gear linkage',
        sense: 'paired G3 gears drive an off-center L4 crank linkage from the output gear',
        goodFor: 'Gear crank',
        constraint: 'output linkage attaches to the gear handle hole only, never to the board',
        authorable: true
    },
    planetary_gear: {
        label: 'Planetary gear',
        sense: 'sun and planet gears compound rotation in a small footprint',
        goodFor: 'Compact rotary',
        constraint: 'extra gears need spacing and clear labels in the recipe',
        authorable: true
    }
};

export const FOUNDRY_PRESETS: Record<string, Partial<MechanismConfig> & { label: string; recommendation: string }> = {
    balanced: { label: 'Balanced', recommendation: 'Balanced' },
    compact: {
        label: 'Compact',
        recommendation: 'Compact',
        groundLength: 120,
        couplerLength: 120,
        rockerLength: 80
    },
    broad: {
        label: 'Broad sweep',
        recommendation: 'Broad',
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
