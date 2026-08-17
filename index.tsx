import React from 'react';
import { flushSync } from 'react-dom';
import ReactDOM from 'react-dom/client';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const releaseBootLoader = () => {
  document.body.classList.add('app-ready');
  window.setTimeout(() => document.getElementById('boot-loader')?.remove(), 320);
};

void import('./App')
  .then(({ default: App }) => {
    flushSync(() => {
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      );
    });
    // AI cache preparation is scheduled by the mounted shell, never used as
    // the condition for releasing the editor.
    releaseBootLoader();
  })
  .catch((error: unknown) => {
    rootElement.textContent = 'MotionSmith could not open. Reload to try again.';
    console.error(error);
  });
