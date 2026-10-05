import { Canvas } from './editor/Canvas';
import { ContextMenu } from './ui/ContextMenu';
import { Footer } from './ui/Footer';
import { HelpDialog } from './ui/HelpDialog';
import { LibrarySidebar } from './ui/LibrarySidebar';
import { MainMenu } from './ui/MainMenu';
import { PropertiesPanel } from './ui/PropertiesPanel';
import { Toasts } from './ui/Toasts';
import { Toolbar } from './ui/Toolbar';
import { WelcomeHint } from './ui/WelcomeHint';
import { LevelPanel } from './level/LevelPanel';
import { LevelSelect } from './level/LevelSelect';
import { SimControls } from './level/SimControls';
import { StatusBanner } from './level/StatusBanner';
import './App.css';

/**
 * Layout, Excalidraw style: a full-bleed canvas with floating islands.
 * Top left: menu and level. Top center: tools. Top right: simulation and library.
 * Left: properties of the selection. Right: level objective and tests.
 * Bottom left: zoom and undo.
 */
export function App() {
  return (
    <div className="app">
      <Canvas />
      <div className="layer">
        <div className="top-left">
          <MainMenu />
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
