import { useEffect, useRef } from "react";
import {
  commandIdForKeyboardEvent,
  type AppCommandHandlerMap,
} from "../utils/appCommands";

type UseAppCommandBindingsOptions = {
  commandHandlers: AppCommandHandlerMap;
  disabled?: boolean;
};

const isTypingShortcutTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export const useAppCommandBindings = ({
  commandHandlers,
  disabled = false,
}: UseAppCommandBindingsOptions) => {
  const commandHandlersRef = useRef<AppCommandHandlerMap>(commandHandlers);
  commandHandlersRef.current = commandHandlers;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (disabled) return;
      if (isTypingShortcutTarget(event.target)) return;
      const commandId = commandIdForKeyboardEvent(event);
      if (!commandId) return;
      event.preventDefault();
      commandHandlersRef.current[commandId]?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled]);
};
