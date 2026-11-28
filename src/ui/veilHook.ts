/// <reference types="vite/client" />

// Read-only Run & Observe QA hook.
// Enabled ONLY in local dev (`import.meta.env.DEV`) or when `?qa=1` is present in the URL,
// keeping `window.__veil` undefined on normal production builds (e.g., GitHub Pages).

import { GRID_SIZE } from '../core/grid';
import type { GameEngine } from '../core/GameEngine';
import type { GameState } from '../core/types';
import type { GameUI } from './GameUI';

export interface VeilQaHook {
  readonly scene:
    | 'build'
    | 'play'
    | 'filter_choice'
    | 'boss_choice'
    | 'tribunal_choice'
    | 'hub_service'
    | 'ending'
    | 'game_over';
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

export function shouldEnableVeilQaHook(): boolean {
  if (import.meta.env.DEV) {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('qa') === '1';
}

export function installVeilQaHook(engine: GameEngine, ui: GameUI): void {
  if (!shouldEnableVeilQaHook()) {
    return;
  }

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
