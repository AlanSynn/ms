import { useEffect, useMemo, useState } from 'react';
import type { BodyPartLayer, SceneObject } from '../../../types';
import type { BuildPlanCharacterPartV1, BuildPlanCharacterV1, BuildPlanObjectPartV1 } from '../../../utils/buildPlan';
import { sceneToOwnerLocal } from '../../../utils/artwork';
import { partOutlineBounds } from '../../../utils/partGeometry';
import { SCENE_PX_PER_MM } from '../../../utils/coordinates';

export const BlueprintPieceArtwork = ({ piece, owner, character, holeDiameterMm }: {
    piece: BuildPlanCharacterPartV1 | BuildPlanObjectPartV1;
    owner: BodyPartLayer | SceneObject;
    character: BuildPlanCharacterV1;
    holeDiameterMm: number;
}) => {
    const localOutline = useMemo(() => piece.outline.map(point => sceneToOwnerLocal(point, piece.localToScene)), [piece]);
    const bounds = useMemo(() => partOutlineBounds(localOutline), [localOutline]);
    const holes = useMemo(() => piece.artwork.ownerKind === 'part'
        ? [...character.fixedPins, ...character.freePivots].filter(pin => pin.partIds.includes(owner.id)).map(pin => ({
            center: sceneToOwnerLocal(pin.scene, piece.localToScene),
            radius: holeDiameterMm * SCENE_PX_PER_MM / (2 * Math.abs(piece.localToScene.scale)),
        })) : [], [character, owner.id, piece, holeDiameterMm]);
    const [render, setRender] = useState<{ owner: typeof owner; source?: string; failed?: boolean }>();
    useEffect(() => {
        const controller = new AbortController();
        void (async () => {
            const { rasterizeOwnerArtwork, artworkCanvasPng, disposeArtworkCanvas } = await import('../../../runtime/artwork/artworkRaster');
            if (controller.signal.aborted) return;
            // This is an editing/inspection derivative. Export separately replays at 300 ppi.
            const scale = Math.min(3, 1024 / Math.max(bounds.width, bounds.height));
            const canvas = await rasterizeOwnerArtwork({
                owner,
                targetFrame: { x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height },
                clip: { kind: 'contour', points: localOutline, holes },
                resolution: { width: Math.max(1, Math.ceil(bounds.width * scale)), height: Math.max(1, Math.ceil(bounds.height * scale)) },
                signal: controller.signal,
            });
            try {
                const source = await artworkCanvasPng(canvas);
                if (!controller.signal.aborted) setRender({ owner, source });
            } finally { disposeArtworkCanvas(canvas); }
        })().catch(() => {
            if (!controller.signal.aborted) setRender({ owner, failed: true });
        });
        return () => controller.abort();
    }, [owner, bounds, localOutline, holes]);
    const current = render?.owner === owner ? render : undefined;
    const transform = piece.localToScene;
    const points = localOutline.map(point => `${point.x},${-point.y}`).join(' ');
    return <g
        data-blueprint-artwork-owner={piece.artwork.ownerId}
        data-blueprint-artwork-revision={piece.artwork.revision}
        data-blueprint-artwork-status={current?.failed ? 'failed' : current?.source ? 'current' : 'pending'}
        transform={`translate(${transform.x / SCENE_PX_PER_MM} ${-transform.y / SCENE_PX_PER_MM}) rotate(${-transform.rotation}) scale(${transform.scale / SCENE_PX_PER_MM})`}
    >
        <polygon points={points} fill={owner.fillColor} />
        {current?.source && <image href={current.source} x={bounds.minX} y={-bounds.maxY} width={bounds.width} height={bounds.height} />}
        <polygon points={points} className="blueprint-character-outline" style={{ fill: 'none' }} />
        {holes.map((hole, index) => <circle key={index} cx={hole.center.x} cy={-hole.center.y} r={hole.radius} fill="white" stroke="#172033" strokeWidth={0.8} data-blueprint-piece-hole={index} />)}
        {current?.failed && <text x={bounds.minX} y={-bounds.minY + 8} fontSize={6} fill="#b91c1c">Reload artwork</text>}
    </g>;
};
