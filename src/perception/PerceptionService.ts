import entitiesData from '../data/entities.json';
import itemsData from '../data/items.json';
import type { GameEvent, GameState } from '../core/types';

export type PerceptionMode = 'illusion' | 'glitch' | 'truth';

export interface DisplayLogEntry {
  text: string;
  isGlitch: boolean;
  trueText?: string;
  fakeText?: string;
  isTruth: boolean;
}

export interface DisplayItem {
  id: string;
  name: string;
  description: string;
  isGlitch: boolean;
  trueName: string;
  trueDescription: string;
  fakeName: string;
  fakeDescription: string;
  isTruth: boolean;
}

export interface DisplayPacket {
  mode: PerceptionMode;
  statusBanner: string;
  logs: DisplayLogEntry[];
  inventory: DisplayItem[];
}

interface DualTextEntity {
  truth: { name: string; dialogue: string };
  illusion: { name: string; dialogue: string };
}

interface DualTextItem {
  truth: { name: string; description: string };
  illusion: { name: string; description: string };
}

const ENTITY_CATALOG = entitiesData as Record<string, DualTextEntity>;
const ITEM_CATALOG = itemsData as Record<string, DualTextItem>;

export function getPerceptionMode(lucidity: number): PerceptionMode {
  if (lucidity < 30) {
    return 'illusion';
  } else if (lucidity < 70) {
    return 'glitch';
  } else {
    return 'truth';
  }
}

function buildLogEntry(
  mode: PerceptionMode,
  trueText: string,
  fakeText: string,
  glitchResolvedText = fakeText,
): DisplayLogEntry {
  if (mode === 'illusion') {
    return { text: fakeText, isGlitch: false, isTruth: false };
  }
  if (mode === 'glitch') {
    return {
      text: glitchResolvedText,
      isGlitch: true,
      trueText,
      fakeText: glitchResolvedText,
      isTruth: false,
    };
  }
  return { text: trueText, isGlitch: false, isTruth: true };
}

export class PerceptionService {
  getStatusBanner(lucidity: number): string {
    const mode = getPerceptionMode(lucidity);
    if (mode === 'illusion') {
      return '[HỆ THỐNG]: Bộ lọc nhận thức hoạt động bình thường. Mục tiêu: Dọn sạch Undead.';
    }
    if (mode === 'glitch') {
      return '[CẢNH BÁO]: Phát hiện nhiễu đồng bộ nhận thức... Đang hiệu chỉnh lại.';
    }
    return '[LỖI BỘ LỌC]: Lớp phủ nhận thức đã nứt vỡ. Đang hiển thị dữ liệu gốc.';
  }

  translateEvents(events: GameEvent[], lucidity: number): DisplayLogEntry[] {
    const mode = getPerceptionMode(lucidity);
    const logs: DisplayLogEntry[] = [];

    for (const event of events) {
      const entry = this.translateSingleEvent(event, mode);
      if (entry) {
        logs.push(entry);
      }
    }

    return logs;
  }

  getDisplayInventory(itemIds: string[], lucidity: number): DisplayItem[] {
    const mode = getPerceptionMode(lucidity);

    return itemIds
      .map((itemId): DisplayItem | null => {
        const item = ITEM_CATALOG[itemId];
        if (!item) return null;

        if (mode === 'truth') {
          return {
            id: itemId,
            name: item.truth.name,
            description: item.truth.description,
            isGlitch: false,
            trueName: item.truth.name,
            trueDescription: item.truth.description,
            fakeName: item.illusion.name,
            fakeDescription: item.illusion.description,
            isTruth: true,
          };
        }

        return {
          id: itemId,
          name: item.illusion.name,
          description: item.illusion.description,
          isGlitch: mode === 'glitch',
          trueName: item.truth.name,
          trueDescription: item.truth.description,
          fakeName: item.illusion.name,
          fakeDescription: item.illusion.description,
          isTruth: false,
        };
      })
      .filter((item): item is DisplayItem => item !== null);
  }

  buildDisplayPacket(state: GameState, events: GameEvent[]): DisplayPacket {
    return {
      mode: getPerceptionMode(state.lucidity),
      statusBanner: this.getStatusBanner(state.lucidity),
      logs: this.translateEvents(events, state.lucidity),
      inventory: this.getDisplayInventory(state.inventory, state.lucidity),
    };
  }

  private translateSingleEvent(
    event: GameEvent,
    mode: PerceptionMode,
  ): DisplayLogEntry | null {
    switch (event.type) {
      case 'ATTACKED': {
        const target = ENTITY_CATALOG[event.targetId];
        if (!target) return null;
        return buildLogEntry(
          mode,
          `[Bạn gây ${event.damage} sát thương lên: ${target.truth.name}]`,
          `[Bạn gây ${event.damage} sát thương lên: ${target.illusion.name}]`,
          `[ĐÃ ĐỒNG BỘ LẠI: ${target.illusion.name}]`,
        );
      }

      case 'DIALOGUE_SPOKEN': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;
        return buildLogEntry(
          mode,
          `${entity.truth.name}: "${entity.truth.dialogue}"`,
          `${entity.illusion.name}: "${entity.illusion.dialogue}"`,
          `[ĐÃ ĐỒNG BỘ LẠI] ${entity.illusion.name}: "${entity.illusion.dialogue}"`,
        );
      }

      case 'AI_FLED': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;
        return buildLogEntry(
          mode,
          `${entity.truth.name} hoảng sợ lùi lại một bước!`,
          `${entity.illusion.name} lùi lại giữ khoảng cách!`,
          `[ĐÃ ĐỒNG BỘ LẠI: ${entity.illusion.name} tái bố trí đội hình]`,
        );
      }

      case 'ENTITY_DIED': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;
        return buildLogEntry(
          mode,
          `${entity.truth.name} đã gục xuống...`,
          `Đã tiêu diệt ${entity.illusion.name}!`,
          `[ĐÃ ĐỒNG BỘ LẠI: Đã thanh trừng ${entity.illusion.name}]`,
        );
      }

      case 'ITEM_DROPPED': {
        const item = ITEM_CATALOG[event.itemId];
        if (!item) return null;
        return buildLogEntry(
          mode,
          `Rơi ra vật phẩm: ${item.truth.name}.`,
          `Phát hiện chiến lợi phẩm: ${item.illusion.name}.`,
          `[ĐÃ ĐỒNG BỘ LẠI: Chiến lợi phẩm ${item.illusion.name}]`,
        );
      }

      case 'ITEM_PICKED_UP': {
        const item = ITEM_CATALOG[event.itemId];
        if (!item) return null;
        return buildLogEntry(
          mode,
          `Bạn đã nhặt: ${item.truth.name}.`,
          `Bạn đã thu hồi: ${item.illusion.name}.`,
          `[ĐÃ ĐỒNG BỘ LẠI: Đã thu hồi ${item.illusion.name}]`,
        );
      }

      case 'PLAYER_MOVED':
      case 'LUCIDITY_CHANGED':
        return null;
    }
  }
}
