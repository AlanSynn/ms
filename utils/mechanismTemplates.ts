import type { MechanismConfig, MechanismType } from '../types';
import { REFERENCE_FOUNDRY_TYPES } from './mechanismReference';

export interface MechanismTemplateMetadata {
    label: string;
    sense: string;
    goodFor: string;
    constraint: string;
    authorable: boolean;
    classroomSensemaking: {
        directTranslation: string;
        applicationCue: string;
        tryThis: string;
        commonHint: string;
        teacherTakeaway: string;
        studentCheck: string;
        expectedAnswer: string;
        evidenceCue: string;
        clipSlot: 'generated-loop' | 'local-asset' | 'optional-url';
    };
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

export const AUTHORABLE_MECHANISM_TYPES: readonly MechanismType[] = ALL_MECHANISM_TYPES.filter(type => type !== 'crank');
export const FOUNDRY_MECHANISM_TYPES: readonly MechanismType[] = REFERENCE_FOUNDRY_TYPES.filter(type => type !== 'crank');

export const MECHANISM_TEMPLATE_LIBRARY: Record<MechanismType, MechanismTemplateMetadata> = {
    crank: {
        label: 'Crank driver',
        sense: 'single rotating input sets phase for simple cyclic motion',
        goodFor: 'Timing',
        constraint: 'use as low-level driver metadata; novice authoring should choose a full linkage template',
        authorable: false,
        classroomSensemaking: {
            directTranslation: 'Driver turns -> phase advances',
            applicationCue: 'Timing',
            tryThis: 'Spin the input',
            commonHint: 'No output -> choose a full mechanism',
            teacherTakeaway: 'A driver sets timing for another mechanism.',
            studentCheck: 'Point to the input',
            expectedAnswer: 'The rotating input driver',
            evidenceCue: 'phase marker moves first',
            clipSlot: 'generated-loop'
        }
    },
    '4bar': {
        label: 'Four-bar linkage',
        sense: 'crank, coupler, and rocker turn rotation into an arcing output point',
        goodFor: 'Swing',
        constraint: 'Show range',
        authorable: true,
        classroomSensemaking: {
            directTranslation: 'Crank turns -> rocker swings',
            applicationCue: 'Waving arm',
            tryThis: 'Drag the output joint',
            commonHint: 'Link cannot close -> fit path',
            teacherTakeaway: 'Rotary motion can become swinging motion.',
            studentCheck: 'Which pivot stays fixed?',
            expectedAnswer: 'The board pivots stay fixed',
            evidenceCue: 'driver crank turns and rocker swings',
            clipSlot: 'generated-loop'
        }
    },
    piston: {
        label: 'Slider piston',
        sense: 'rotation pushes a rod along one linear slide',
        goodFor: 'Push-pull',
        constraint: 'maps to the reference slider_crank recipe; guide is fixed, slider is moving',
        authorable: true,
        classroomSensemaking: {
            directTranslation: 'Crank turns -> slider pushes',
            applicationCue: 'Pump',
            tryThis: 'Watch the slider line',
            commonHint: 'Slider off guide -> snap guide to path',
            teacherTakeaway: 'Rotation can make straight-line motion.',
            studentCheck: 'Which part moves straight?',
            expectedAnswer: 'The slider moves straight',
            evidenceCue: 'slider follows the guide',
            clipSlot: 'generated-loop'
        }
    },
    yoke: {
        label: 'Scotch yoke',
        sense: 'pin-in-slot motion converts rotation to straight reciprocation',
        goodFor: 'Back-forth',
        constraint: 'simulation placeholder',
        authorable: false,
        classroomSensemaking: {
            directTranslation: 'Pin in slot -> straight back-forth',
            applicationCue: 'Reciprocating slider',
            tryThis: 'Find the slot',
            commonHint: 'Pin outside slot -> reset slot',
            teacherTakeaway: 'A slot can constrain circular motion into a line.',
            studentCheck: 'Where is the slot?',
            expectedAnswer: 'The pin rides inside the slot',
            evidenceCue: 'pin-in-slot stays constrained',
            clipSlot: 'generated-loop'
        }
    },
    'quick-return': {
        label: 'Quick-return',
        sense: 'uneven timing makes one stroke faster than the return stroke',
        goodFor: 'Snap',
        constraint: 'simulation placeholder',
        authorable: false,
        classroomSensemaking: {
            directTranslation: 'Offset link -> fast return',
            applicationCue: 'Tool stroke',
            tryThis: 'Compare both strokes',
            commonHint: 'No rotation possible -> reset range',
            teacherTakeaway: 'Link placement can change timing.',
            studentCheck: 'Which stroke is faster?',
            expectedAnswer: 'The return stroke is faster',
            evidenceCue: 'output changes speed by direction',
            clipSlot: 'generated-loop'
        }
    },
    '5bar': {
        label: 'Five-bar',
        sense: 'two cranks combine phases for wider two-arm tracing',
        goodFor: 'Complex path',
        constraint: 'simulation only',
        authorable: false,
        classroomSensemaking: {
            directTranslation: 'Two cranks -> one trace point',
            applicationCue: 'Advanced path',
            tryThis: 'Move either driver',
            commonHint: 'Trace breaks -> reset phase pair',
            teacherTakeaway: 'Two inputs can control one point.',
            studentCheck: 'Which two inputs drive it?',
            expectedAnswer: 'Both fixed cranks drive the trace point',
            evidenceCue: 'two drivers shape one path',
            clipSlot: 'generated-loop'
        }
    },
    '6bar': {
        label: 'Six-bar',
        sense: 'a four-bar base drives a second dyad so a follower point traces richer compound arcs',
        goodFor: 'Compound path',
        constraint: 'simulation only',
        authorable: false,
        classroomSensemaking: {
            directTranslation: 'Four-bar plus dyad -> richer arc',
            applicationCue: 'Puppet motion',
            tryThis: 'Follow the second link',
            commonHint: 'Dyad overextends -> reset preset',
            teacherTakeaway: 'Adding links changes the output path.',
            studentCheck: 'Which link follows the base?',
            expectedAnswer: 'The dyad follows the four-bar base',
            evidenceCue: 'base linkage drives the extra link',
            clipSlot: 'generated-loop'
        }
    },
    cam: {
        label: 'Cam follower',
        sense: 'cam radius lifts a follower from a rotating disk profile',
        goodFor: 'Lift',
        constraint: 'follower guide and cam disk must stay aligned',
        authorable: true,
        classroomSensemaking: {
            directTranslation: 'Cam shape -> follower lifts',
            applicationCue: 'Bobbing head',
            tryThis: 'Change the cam height',
            commonHint: 'Follower floats -> slide guide to cam',
            teacherTakeaway: 'A shaped wheel can time a lift.',
            studentCheck: 'Where does the follower touch?',
            expectedAnswer: 'The follower touches the cam edge',
            evidenceCue: 'roller stays on the cam profile',
            clipSlot: 'generated-loop'
        }
    },
    'rack-pinion': {
        label: 'Rack and pinion',
        sense: 'a rotating pinion walks a toothed rack along a straight guide',
        goodFor: 'Linear travel',
        constraint: 'unsupported in v1',
        authorable: false,
        classroomSensemaking: {
            directTranslation: 'Gear teeth -> rack slides',
            applicationCue: 'Steering rack',
            tryThis: 'Look for the straight rack',
            commonHint: 'Rack not tangent -> align pinion',
            teacherTakeaway: 'Gear teeth can push a straight rail.',
            studentCheck: 'Which part is linear?',
            expectedAnswer: 'The rack slides in a line',
            evidenceCue: 'pinion rotation pushes the rack',
            clipSlot: 'generated-loop'
        }
    },
    gear: {
        label: 'Gear train',
        sense: 'paired gears transfer rotation through a fixed ratio',
        goodFor: 'Reverse/scale',
        constraint: 'Mesh ratio',
        authorable: true,
        classroomSensemaking: {
            directTranslation: 'Touching teeth -> spin transfers',
            applicationCue: 'Speed change',
            tryThis: 'Add an idler gear',
            commonHint: 'Teeth overlap -> snap axle',
            teacherTakeaway: 'Meshed gears reverse and scale rotation.',
            studentCheck: 'Which gear turns opposite?',
            expectedAnswer: 'The meshed output gear turns opposite',
            evidenceCue: 'touching teeth reverse spin',
            clipSlot: 'generated-loop'
        }
    },
    gear_linkage: {
        label: 'Gear linkage',
        sense: 'paired G3 gears drive two L4 crank links that meet at one moving point',
        goodFor: 'Gear crank',
        constraint: 'both linkages attach to off-center gear handle holes and share one floating output point',
        authorable: true,
        classroomSensemaking: {
            directTranslation: 'Two driven gears -> linked point moves',
            applicationCue: 'Coordinated arms',
            tryThis: 'Watch both crank holes',
            commonHint: 'Link holes miss -> use matched length',
            teacherTakeaway: 'Two rotary drivers can guide one point.',
            studentCheck: 'Which gears are drivers?',
            expectedAnswer: 'Both separated gears drive linkage holes',
            evidenceCue: 'two gear cranks move one coupler point',
            clipSlot: 'generated-loop'
        }
    },
    planetary_gear: {
        label: 'Planetary gear',
        sense: 'sun and planet gears compound rotation in a small footprint',
        goodFor: 'Compact rotary',
        constraint: 'extra gears need spacing and clear labels in the recipe',
        authorable: true,
        classroomSensemaking: {
            directTranslation: 'Sun, planets, ring -> compact rotation',
            applicationCue: 'Compact spinner',
            tryThis: 'Hold the ring fixed',
            commonHint: 'Planet off ring -> reset kit',
            teacherTakeaway: 'Planet gears combine multiple rotations.',
            studentCheck: 'Which part is fixed?',
            expectedAnswer: 'The ring is fixed in this preset',
            evidenceCue: 'planets roll between sun and ring',
            clipSlot: 'generated-loop'
        }
    }
};

export const FOUNDRY_PRESETS: Record<string, Partial<MechanismConfig> & { label: string; recommendation: string }> = {
    balanced: {
        label: 'Balanced',
        recommendation: 'Balanced',
        groundLength: 160,
        crankLength: 80,
        couplerLength: 160,
        rockerLength: 160
    },
    compact: {
        label: 'Compact',
        recommendation: 'Compact',
        groundLength: 120,
        crankLength: 80,
        couplerLength: 160,
        rockerLength: 160
    },
    broad: {
        label: 'Broad sweep',
        recommendation: 'Broad',
        groundLength: 240,
        crankLength: 80,
        couplerLength: 240,
        rockerLength: 160
    }
};

export const mechanismTemplateLabel = (type: MechanismType): string =>
    MECHANISM_TEMPLATE_LIBRARY[type]?.label ?? type;

export const mechanismTemplateOptionLabel = (type: MechanismType): string => {
    return type === 'crank' ? `${mechanismTemplateLabel(type)} · driver` : `${mechanismTemplateLabel(type)} · graph`;
};
