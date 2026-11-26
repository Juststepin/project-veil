// Read-only Run & Observe QA hook (adapted from Claude Code Game Studios' src/hook.ts).
// A canvas shows nothing to DOM snapshots, so Playwright observes live game state and
// translates grid tiles into viewport click coordinates through window.__veil.
// Players never see this hook, and it never bypasses real UI input or game rules.

import { GRID_SIZE } from '../core/grid';
import type { GameEngine } from '../core/GameEngine';
import type { GameState } from '../core/types';
import type { GameUI } from '../ui/GameUI';

export interface VeilQaHook {
  readonly scene: 'build' | 'play' | 'filter_choice' | 'boss_choice' | 'ending' | 'game_over';
  readonly mode: string;
  readonly inspectedEntityId: string | null;
  readonly state: GameState;
  tileCenter(tileX: number, tileY: number): { x: number; y: number } | null;
}

declare global {
  interface Window {
    __veil?: VeilQaHook;
  }
}

export function installVeilQaHook(engine: GameEngine, ui: GameUI): void {
  const hook: VeilQaHook = {
    get scene() {
      return ui.getQaSnapshot().scene;
    },
    get mode() {
      return ui.getQaSnapshot().mode;
    },
    get inspectedEntityId() {
      return ui.getQaSnapshot().inspectedEntityId;
    },
    get state() {
      return structuredClone(engine.getState());
    },
    tileCenter(tileX: number, tileY: number) {
      const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      if (tileX < 0 || tileY < 0 || tileX >= GRID_SIZE || tileY >= GRID_SIZE) return null;
      return {
        x: rect.left + ((tileX + 0.5) * rect.width) / GRID_SIZE,
        y: rect.top + ((tileY + 0.5) * rect.height) / GRID_SIZE,
      };
    },
  };

  window.__veil = hook;
}
