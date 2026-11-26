import './style.css';
import { GameEngine } from './core/GameEngine';
import { installVeilQaHook } from './debug/veilHook';
import { PerceptionService } from './perception/PerceptionService';
import { GameUI } from './ui/GameUI';

const appRoot = document.querySelector<HTMLElement>('#app');

if (appRoot) {
  const engine = new GameEngine();
  const perception = new PerceptionService();
  const ui = new GameUI(appRoot, engine, perception);
  ui.mount();
  installVeilQaHook(engine, ui);
}
