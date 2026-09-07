import React from 'react';
import ReactDOM from 'react-dom/client';
import { BOOT_READY_EVENT } from './utils/startupFlow';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const releaseBootLoader = () => {
  document.body.classList.add('app-ready');
  window.setTimeout(() => {
    document.getElementById('boot-loader')?.remove();
    window.dispatchEvent(new Event(BOOT_READY_EVENT));
  }, 320);
};

void import('./App')
  .then(({ default: App }) => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
    // Release only after React has had one frame to schedule the editor shell.
    window.requestAnimationFrame(releaseBootLoader);
  })
  .catch((error: unknown) => {
    rootElement.textContent = 'MotionSmith could not open. Reload to try again.';
    console.error(error);
  });
