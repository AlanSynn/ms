import { useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { WorkspacePlayerDock } from "../components/AppShell";
import type { AppStage } from "../types";

export type WorkspacePlayerDockState = {
  playerDock: ReactNode;
  assemblyStepIndex: number;
  setAssemblyStepIndex: Dispatch<SetStateAction<number>>;
  assemblyStepProgress: number;
  setAssemblyStepProgress: Dispatch<SetStateAction<number>>;
  assemblyPlaying: boolean;
  setAssemblyPlaying: Dispatch<SetStateAction<boolean>>;
  setAssemblyStepCount: Dispatch<SetStateAction<number>>;
};

type UseWorkspacePlayerDockOptions = {
  editorStage: AppStage;
  modalOpen: boolean;
  isPlaying: boolean;
  setIsPlaying: Dispatch<SetStateAction<boolean>>;
  angle: number;
  setAngle: Dispatch<SetStateAction<number>>;
  speed: number;
  drawMode: boolean;
};

export const useWorkspacePlayerDock = ({
  editorStage,
  modalOpen,
  isPlaying,
  setIsPlaying,
  angle,
  setAngle,
  speed,
  drawMode,
}: UseWorkspacePlayerDockOptions): WorkspacePlayerDockState => {
  const [assemblyPlaying, setAssemblyPlaying] = useState(false);
  const [assemblyStepIndex, setAssemblyStepIndex] = useState(0);
  const [assemblyStepProgress, setAssemblyStepProgress] = useState(0);
  const [assemblyStepCount, setAssemblyStepCount] = useState(0);

  const goSharedAssemblyStep = (index: number) => {
    const maxStepIndex = Math.max(0, assemblyStepCount - 1);
    setAssemblyStepProgress(0);
    setAssemblyStepIndex(Math.max(0, Math.min(maxStepIndex, index)));
  };
  const isAssemblyStage = editorStage === "assembly";
  const showsWorkspacePlayer =
    editorStage === "path" ||
    editorStage === "design" ||
    editorStage === "assembly";
  const playerDock =
    !modalOpen && showsWorkspacePlayer ? (
      <WorkspacePlayerDock
        isPlaying={isAssemblyStage ? assemblyPlaying : isPlaying}
        setIsPlaying={isAssemblyStage ? setAssemblyPlaying : setIsPlaying}
        angle={angle}
        setAngle={setAngle}
        speed={speed}
        drawMode={drawMode}
        stepPlayback={
          isAssemblyStage
            ? {
                stepIndex: assemblyStepIndex,
                stepCount: assemblyStepCount,
                onStepChange: goSharedAssemblyStep,
              }
            : undefined
        }
      />
    ) : null;

  return {
    playerDock,
    assemblyStepIndex,
    setAssemblyStepIndex,
    assemblyStepProgress,
    setAssemblyStepProgress,
    assemblyPlaying,
    setAssemblyPlaying,
    setAssemblyStepCount,
  };
};
