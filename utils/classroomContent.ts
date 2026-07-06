import type { MechanismType } from '../types';
import { ALL_MECHANISM_TYPES } from './mechanismTemplates';

export const DEFAULT_CLASSROOM_ASSESSMENT_KEY = 'default';
export const CLASSROOM_ASSESSMENT_KEY_MAX_LENGTH = 64;

export type ClassroomAssessmentStage = 'foundry' | 'design' | 'assembly';
export type ClassroomAssessmentKind = 'prediction' | 'observation' | 'debugging' | 'comparison' | 'reflection';

export interface ClassroomAssessmentPrompt {
    id: string;
    stage: ClassroomAssessmentStage;
    kind: ClassroomAssessmentKind;
    prompt: string;
    expectedAnswer: string;
    evidenceCue: string;
}

export interface ClassroomAssessmentBundle {
    key: string;
    label: string;
    prompts: Partial<Record<MechanismType, ClassroomAssessmentPrompt[]>>;
}

export interface ResolvedClassroomAssessmentBundle {
    requestedKey: string;
    activeKey: string;
    isFallback: boolean;
    bundle: ClassroomAssessmentBundle;
}

export interface ClassroomMechanismUseExample {
    mechanismType: MechanismType;
    label: string;
    useCase: string;
    watchFor: string;
    studentQuestion: string;
    generatedSummary: string;
    clipSlot: 'generated-loop';
    optionalVideoSource?: 'youtube-nocookie';
    youtubeId?: string;
    reviewed: boolean;
}

export const CLASSROOM_COPY = {
    assessmentPrefix: 'Check',
    cueTitle: {
        foundry: 'Why it moves',
        design: 'Why it moves',
        assembly: 'Motion'
    },
    useExampleTitle: 'Use example',
    useExamplePrefix: 'Where',
    watchExample: 'Watch video',
    generatedLoopLabel: 'Generated loop',
    videoUnavailable: 'Video unavailable. Use the generated loop.',
    videoOptional: 'Optional video. Use the generated loop if it does not load.',
    assessmentActive: 'Assessment active',
    assessmentFallback: 'Using default prompts'
} as const;

export const classroomCueTitleFor = (stage: ClassroomAssessmentStage) => CLASSROOM_COPY.cueTitle[stage];

export const formatClassroomAssessmentPrompt = (assessment: ClassroomAssessmentPrompt) =>
    `${CLASSROOM_COPY.assessmentPrefix}: ${assessment.prompt}`;

export const formatClassroomUseExampleLabel = (example: ClassroomMechanismUseExample) =>
    `${CLASSROOM_COPY.useExamplePrefix}: ${example.useCase}`;

export const normalizeClassroomAssessmentKey = (
    value: unknown,
    fallback = DEFAULT_CLASSROOM_ASSESSMENT_KEY
): string => {
    if (typeof value !== 'string') return fallback;
    const normalized = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, CLASSROOM_ASSESSMENT_KEY_MAX_LENGTH)
        .replace(/-+$/g, '');
    return normalized || fallback;
};

export const classroomAssessmentKeyFromSearch = (search: string): string | undefined => {
    const query = search.startsWith('?') ? search.slice(1) : search;
    const params = new URLSearchParams(query);
    const key = params.get('assessment') ?? params.get('assessmentKey');
    return key === null ? undefined : normalizeClassroomAssessmentKey(key);
};

const prompt = (
    mechanismType: MechanismType,
    bundle: 'default' | 'motion-journal',
    stage: ClassroomAssessmentStage,
    kind: ClassroomAssessmentKind,
    text: string,
    expectedAnswer: string,
    evidenceCue: string
): ClassroomAssessmentPrompt => ({
    id: `${bundle}-${mechanismType}-${stage}`,
    stage,
    kind,
    prompt: text,
    expectedAnswer,
    evidenceCue
});

const defaultPromptFor = (type: MechanismType): ClassroomAssessmentPrompt[] => {
    const prompts: Record<MechanismType, [string, string, string]> = {
        crank: ['Which part turns all the way around?', 'The driver crank turns around the fixed board pin.', 'driver crank rotates around one fixed pin'],
        '4bar': ['Which two pivots stay fixed on the board?', 'The ground pivots stay fixed while the coupler and rocker move.', 'two board pivots stay still while the rocker swings'],
        piston: ['Which part moves in a straight line?', 'The slider or piston moves straight in the guide.', 'slider travels back and forth in one line'],
        yoke: ['Where does circular motion become side-to-side motion?', 'The pin pushes the yoke slot from side to side.', 'pin slides inside the slot while the yoke moves'],
        'quick-return': ['Which direction moves back faster?', 'The return stroke moves faster than the working stroke.', 'one stroke has a shorter quick return'],
        '5bar': ['Which two arms drive the point?', 'Both driver arms guide the same moving point.', 'two drivers meet at one follower point'],
        '6bar': ['Which extra link changes the path shape?', 'The added link bends the motion through another rocker.', 'extra rocker changes the output path'],
        cam: ['Where does the follower touch the cam?', 'The follower rides on the cam edge.', 'follower height follows the cam edge'],
        'rack-pinion': ['Which part moves straight when the gear turns?', 'The rack moves straight as the pinion rotates.', 'gear teeth push the rack along a line'],
        gear: ['Which gear turns the other way?', 'A meshed gear turns opposite the driver gear.', 'touching teeth rotate in opposite directions'],
        gear_linkage: ['What changes when gears drive the linkage?', 'The gears time the crank before the link swings.', 'gear rotation sets the linkage phase'],
        planetary_gear: ['Which part carries the planet gears?', 'The carrier moves the planet gears around the sun gear.', 'planets orbit around the center gear']
    };
    const [text, expectedAnswer, evidenceCue] = prompts[type];
    return [prompt(type, 'default', 'foundry', 'prediction', text, expectedAnswer, evidenceCue)];
};

const journalPromptFor = (type: MechanismType): ClassroomAssessmentPrompt[] => {
    const use = MECHANISM_USE_EXAMPLES[type].useCase.toLowerCase();
    return [
        prompt(
            type,
            'motion-journal',
            'foundry',
            'observation',
            `What changed in the ${use} motion?`,
            'Name one motion change and one visible cause.',
            MECHANISM_USE_EXAMPLES[type].generatedSummary
        ),
        prompt(
            type,
            'motion-journal',
            'assembly',
            'reflection',
            'What should move freely after this step?',
            'The moving link, gear, or follower should move without jamming.',
            'moving parts can be tested by hand after assembly'
        )
    ];
};

const buildPromptMap = (factory: (type: MechanismType) => ClassroomAssessmentPrompt[]) =>
    Object.fromEntries(ALL_MECHANISM_TYPES.map(type => [type, factory(type)])) as Record<MechanismType, ClassroomAssessmentPrompt[]>;

export const MECHANISM_USE_EXAMPLES: Record<MechanismType, ClassroomMechanismUseExample> = {
    crank: {
        mechanismType: 'crank',
        label: 'Crank',
        useCase: 'hand-crank toy',
        watchFor: 'one pin stays fixed while the handle turns around it',
        studentQuestion: 'What would the character do if the crank were longer?',
        generatedSummary: 'A crank is the simple handle that starts a repeating motion.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'i4nA_jRqb8c',
        reviewed: true
    },
    '4bar': {
        mechanismType: '4bar',
        label: 'Four-bar linkage',
        useCase: 'waving hand',
        watchFor: 'two board pivots stay still while the end swings',
        studentQuestion: 'Which two pivots are the anchors?',
        generatedSummary: 'Two fixed pivots guide a moving link through a smooth swing.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: '1Ty_1LF3Qv0',
        reviewed: true
    },
    piston: {
        mechanismType: 'piston',
        label: 'Slider crank',
        useCase: 'bicycle pump',
        watchFor: 'the slider cannot wander; it stays on one line',
        studentQuestion: 'Where does the circular motion become straight motion?',
        generatedSummary: 'A rotating crank pushes a slider back and forth in a guide.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'kfLg2EmP6mM',
        reviewed: true
    },
    yoke: {
        mechanismType: 'yoke',
        label: 'Scotch yoke',
        useCase: 'side-to-side shaker',
        watchFor: 'the pin slides inside the slot instead of pulling a link',
        studentQuestion: 'Which part forces the motion to stay side-to-side?',
        generatedSummary: 'A pin in a slot turns rotation into a short back-and-forth slide.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'QZ2XFTblrC8',
        reviewed: true
    },
    'quick-return': {
        mechanismType: 'quick-return',
        label: 'Quick return',
        useCase: 'shaping tool',
        watchFor: 'one direction takes more time than the return direction',
        studentQuestion: 'Which stroke is the slow working stroke?',
        generatedSummary: 'The link placement makes one stroke slow and the return stroke fast.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'yfmUSm4y43k',
        reviewed: true
    },
    '5bar': {
        mechanismType: '5bar',
        label: 'Five-bar linkage',
        useCase: 'drawing robot',
        watchFor: 'two driver arms meet at one moving point',
        studentQuestion: 'What happens if only one driver moves?',
        generatedSummary: 'Two arms cooperate to place one point on a larger path.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'T5bNC5dvRuU',
        reviewed: true
    },
    '6bar': {
        mechanismType: '6bar',
        label: 'Six-bar linkage',
        useCase: 'folding lift',
        watchFor: 'the extra link changes the shape of the final path',
        studentQuestion: 'Which added link changes the motion most?',
        generatedSummary: 'A second linkage layer reshapes a simple swing into a richer path.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'AQrbUvOpwCY',
        reviewed: true
    },
    cam: {
        mechanismType: 'cam',
        label: 'Cam follower',
        useCase: 'bobbing head',
        watchFor: 'the follower rises where the cam edge bulges out',
        studentQuestion: 'How would a taller cam bump change the motion?',
        generatedSummary: 'The shape of the cam edge decides when the follower lifts.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'HsXWewecMLE',
        reviewed: true
    },
    'rack-pinion': {
        mechanismType: 'rack-pinion',
        label: 'Rack and pinion',
        useCase: 'sliding door',
        watchFor: 'gear teeth push a straight rack instead of another wheel',
        studentQuestion: 'Which part moves straight?',
        generatedSummary: 'A gear turns, and its teeth push a straight rail forward or back.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'SwUqCod40jI',
        reviewed: true
    },
    gear: {
        mechanismType: 'gear',
        label: 'Gear train',
        useCase: 'toy gearbox',
        watchFor: 'touching gears spin in opposite directions',
        studentQuestion: 'What changes when the output gear is bigger?',
        generatedSummary: 'Meshed teeth pass rotation from one gear to the next.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: '4ROtKKuSaBI',
        reviewed: true
    },
    gear_linkage: {
        mechanismType: 'gear_linkage',
        label: 'Gear linkage',
        useCase: 'timed waving pair',
        watchFor: 'gear timing moves the linkage point at the right moment',
        studentQuestion: 'Which moving point is controlled by both gears?',
        generatedSummary: 'Gears keep timing while links turn that timing into a path.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'G8_vpKH0Wx0',
        reviewed: true
    },
    planetary_gear: {
        mechanismType: 'planetary_gear',
        label: 'Planetary gear',
        useCase: 'drill gearbox',
        watchFor: 'planet gears orbit around the center while they spin',
        studentQuestion: 'Which gear is fixed in this model?',
        generatedSummary: 'Several gears share one small space to change speed or direction.',
        clipSlot: 'generated-loop',
        optionalVideoSource: 'youtube-nocookie',
        youtubeId: 'ARd-Om2VyiE',
        reviewed: true
    }
};

export const CLASSROOM_ASSESSMENT_BUNDLES: Record<string, ClassroomAssessmentBundle> = {
    default: {
        key: 'default',
        label: 'Default check',
        prompts: buildPromptMap(defaultPromptFor)
    },
    'motion-journal': {
        key: 'motion-journal',
        label: 'Motion journal',
        prompts: buildPromptMap(journalPromptFor)
    }
};

export const CLASSROOM_ASSESSMENT_KEYS = Object.keys(CLASSROOM_ASSESSMENT_BUNDLES);

export const classroomAssessmentStatusText = (assessment: ResolvedClassroomAssessmentBundle) =>
    assessment.isFallback ? CLASSROOM_COPY.assessmentFallback : CLASSROOM_COPY.assessmentActive;

export const classroomAssessmentKeyHint = () => `Try: ${CLASSROOM_ASSESSMENT_KEYS.join(", ")}`;

export const resolveClassroomAssessmentBundle = (key: unknown): ResolvedClassroomAssessmentBundle => {
    const requestedKey = normalizeClassroomAssessmentKey(key);
    const bundle = CLASSROOM_ASSESSMENT_BUNDLES[requestedKey] ?? CLASSROOM_ASSESSMENT_BUNDLES[DEFAULT_CLASSROOM_ASSESSMENT_KEY];
    return {
        requestedKey,
        activeKey: bundle.key,
        isFallback: bundle.key !== requestedKey,
        bundle
    };
};

export const classroomAssessmentFor = (
    mechanismType: MechanismType,
    key: unknown,
    stage?: ClassroomAssessmentStage
): ClassroomAssessmentPrompt => {
    const bundle = resolveClassroomAssessmentBundle(key).bundle;
    const prompts = bundle.prompts[mechanismType] ?? CLASSROOM_ASSESSMENT_BUNDLES[DEFAULT_CLASSROOM_ASSESSMENT_KEY].prompts[mechanismType] ?? [];
    return prompts.find(item => item.stage === stage) ?? prompts[0] ?? defaultPromptFor(mechanismType)[0];
};

export const classroomUseExampleFor = (mechanismType: MechanismType) => MECHANISM_USE_EXAMPLES[mechanismType];

export const youtubeNoCookieEmbedUrl = (youtubeId: string) => {
    const safeId = /^[A-Za-z0-9_-]{6,32}$/.test(youtubeId) ? youtubeId : '';
    return safeId ? `https://www.youtube-nocookie.com/embed/${safeId}` : undefined;
};
