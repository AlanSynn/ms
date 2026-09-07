import { useMemo, useState } from 'react';
import type { BodyPartLayer, Point, ProjectAction, ProjectState, SceneObject } from '../../../types';
import type { AppCommandHandlerMap } from '../../../utils/appCommands';
import { artworkForOwner, assertArtworkEditWithinProjectLimits } from '../../../utils/artwork';
import { sceneObjectOutline } from '../../../utils/artworkTargets';
import { characterFabricationHoles } from '../../../utils/characterFabricationHoles';
import { fabricablePartOutlinePoints, partLandmarkLocalPoints } from '../../../utils/partGeometry';
import { PaintWorkspace } from './PaintWorkspace';
import { ShapeEditor } from './ShapeEditor';

/** Draft props use this same editor, with a local history until Add object. */
export const CharacterArtworkWorkspace = ({ project, sourceOwner, kind, draft = false, dispatch, commandHandlers, onClose }: {
  project: ProjectState;
  sourceOwner: BodyPartLayer | SceneObject;
  kind: 'part' | 'object';
  draft?: boolean;
  dispatch: (action: ProjectAction) => void;
  commandHandlers: AppCommandHandlerMap;
  onClose: () => void;
}) => {
  const [history, setHistory] = useState({ past: [] as SceneObject[], current: sourceOwner as SceneObject, future: [] as SceneObject[] });
  const [shaping, setShaping] = useState(false);
  const owner = draft ? history.current : sourceOwner;
  const holes = useMemo(() => kind === 'part' ? characterFabricationHoles(project).get(owner.id) ?? [] : [], [project, kind, owner.id]);
  const outline = useMemo(() => kind === 'part'
    ? fabricablePartOutlinePoints(owner as BodyPartLayer, partLandmarkLocalPoints(owner as BodyPartLayer, project.skeleton))
    : sceneObjectOutline(owner as SceneObject), [owner, kind, project.skeleton]);
  const update = (updates: Partial<BodyPartLayer & SceneObject>) => {
    if (draft) setHistory(current => ({ past: [...current.past, current.current], current: { ...current.current, ...updates }, future: [] }));
    else if (kind === 'part') dispatch({ type: 'update_part', partId: owner.id, updates });
    else dispatch({ type: 'update_scene_object', objectId: owner.id, updates });
  };
  const undo = () => {
    if (!draft) { commandHandlers['edit.undo'](); return; }
    setHistory(current => current.past.length ? { past: current.past.slice(0, -1), current: current.past[current.past.length - 1], future: [current.current, ...current.future] } : current);
  };
  const redo = () => {
    if (!draft) { commandHandlers['edit.redo'](); return; }
    setHistory(current => current.future.length ? { past: [...current.past, current.current], current: current.future[0], future: current.future.slice(1) } : current);
  };
  const commitShape = (points: Point[]) => {
    update({ contourPoints: points, contourSource: 'user', artwork: artworkForOwner(owner) });
    setShaping(false);
  };
  return <>
    <PaintWorkspace owner={owner} outline={outline} holes={holes}
      onArtwork={(artwork, expectedRevision) => {
        if (artworkForOwner(owner).revision !== expectedRevision) return;
        assertArtworkEditWithinProjectLimits(project, kind, owner.id, artwork);
        update({ artwork });
      }}
      onBaseColor={fillColor => update({ fillColor })} onUndo={undo} onRedo={redo}
      onChangeShape={() => setShaping(true)}
      onCancel={draft ? onClose : undefined}
      onNameChange={draft ? name => update({ name }) : undefined}
      onDone={() => {
        if (draft) {
          assertArtworkEditWithinProjectLimits(project, 'object', owner.id, artworkForOwner(owner));
          dispatch({ type: 'upsert_scene_object', object: { ...owner as SceneObject, name: owner.name.trim() || 'My object' } });
        }
        onClose();
      }} />
    {shaping && <ShapeEditor key={owner.id} owner={owner} outline={outline} attachments={holes} onCommit={commitShape} onClose={() => setShaping(false)} />}
  </>;
};
