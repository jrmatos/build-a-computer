import { Canvas } from './editor/Canvas';
import { lazy, Suspense } from 'react';

import { useEditor } from './editor/store';
import { ContextMenu } from './ui/ContextMenu';
import { Footer } from './ui/Footer';
import { HelpDialog } from './ui/HelpDialog';
import { LibrarySidebar } from './ui/LibrarySidebar';
import { MainMenu } from './ui/MainMenu';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { Toasts } from './ui/Toasts';
import { Toolbar } from './ui/Toolbar';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { BottomDock } from './level/BottomDock';
import { WelcomeHint } from './ui/WelcomeHint';
import { LevelPanel } from './level/LevelPanel';
import { LevelSelect } from './level/LevelSelect';
import { SimControls } from './level/SimControls';
import { StatusBanner } from './level/StatusBanner';
import './App.css';

// Code levels pull in CodeMirror and the assembler: load them only when needed (first-level bundle budget).
const CodeWorkspace = lazy(() => import('./code/CodeWorkspace').then((m) => ({ default: m.CodeWorkspace })));

/**
 * Layout, Excalidraw style: a full-bleed canvas with floating islands.
 * Top left: menu and level. Top center: tools. Top right: simulation and library.
 * Left: properties of the selection. Right: level objective and tests.
 * Bottom left: zoom and undo.
 */
export function App() {
  // Code levels (Phase 6+) replace the board with the code workspace.
  const codeMode = useEditor((s) => s.level?.mode === 'code');
  return (
    <div className="app">
      {codeMode ? (
        <Suspense fallback={null}>
          <CodeWorkspace />
        </Suspense>
      ) : (
        <Canvas />
      )}
      <div className="layer">
        <div className="top-left">
          <MainMenu />
          <Breadcrumbs />
        </div>
        <div className="top-center">
          <Toolbar />
        </div>
        <div className="top-right">
          <SimControls />
        </div>
        <div className="left-dock">
          <PropertiesPanel />
        </div>
        <div className="right-dock">
          <LevelPanel />
        </div>
        <div className="bottom-left">
          <Footer />
        </div>
        <div className="bottom-dock">
          <BottomDock />
        </div>
        <StatusBanner />
        <WelcomeHint />
      </div>
      <LibrarySidebar />
      <ContextMenu />
      <LevelSelect />
      <HelpDialog />
      <Toasts />
    </div>
  );
}
