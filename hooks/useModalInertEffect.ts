import { useEffect } from "react";

type ModalShellRef = { current: HTMLElement | null };

const setModalInertState = (shell: HTMLElement | null, active: boolean) => {
  if (active) {
    shell?.setAttribute("inert", "");
    shell?.setAttribute("aria-hidden", "true");
    document.documentElement.classList.add("welcome-modal-open");
    document.body.classList.add("welcome-modal-open");
    return;
  }
  shell?.removeAttribute("inert");
  shell?.removeAttribute("aria-hidden");
  document.documentElement.classList.remove("welcome-modal-open");
  document.body.classList.remove("welcome-modal-open");
};

export const useModalInertEffect = (
  appShellRef: ModalShellRef,
  modalOpen: boolean,
) => {
  useEffect(() => {
    const shell = appShellRef.current;
    setModalInertState(shell, modalOpen);
    return () => setModalInertState(shell, false);
  }, [appShellRef, modalOpen]);
};
