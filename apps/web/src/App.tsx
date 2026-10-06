import { Suspense } from 'react';

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
import { useModeUi } from './modes';
import './App.css';

/**
 * Layout, Excalidraw style: a full-bleed canvas with floating islands.
 * Top left: menu and level. Top center: tools. Top right: simulation and library.
 * Left: properties of the selection. Right: level objective and tests.
 * Bottom left: zoom and undo.
 */
export function App() {
  // The level's mode plugin (modes/) picks the workspace: the board canvas, or the lazy code and JS editors.
  const { Workspace, Effects } = useModeUi();
  const level = useEditor((s) => s.level);
  return (
    <div className="app">
      <Suspense fallback={null}>
        <Workspace />
      </Suspense>
      {Effects && level && <Effects key={level.mode} level={level} />}
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
