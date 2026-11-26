import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { listenForInstall, registerServiceWorker } from './pwa/pwa';
import './styles.css';

// Installable app: catch the browser's install prompt early, and register the service worker (production only).
listenForInstall();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
