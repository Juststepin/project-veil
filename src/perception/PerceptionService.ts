import entitiesData from '../data/entities.json';
import itemsData from '../data/items.json';
import mapsData from '../data/maps.json';
import modifiersData from '../data/modifiers.json';
import type {
  EndingId,
  EntityState,
  FilterChoice,
  GameEvent,
  GameState,
  ModifierConfig,
} from '../core/types';

export type PerceptionMode = 'illusion' | 'glitch' | 'truth';

export interface DisplayLogEntry {
  text: string;
  isGlitch: boolean;
  trueText?: string;
  fakeText?: string;
  isTruth: boolean;
  isDanger?: boolean;
  isTalk?: boolean;
  isSystem?: boolean;
  noPrefix?: boolean;
}

export interface DisplayItem {
  id: string;
  name: string;
  description: string;
  healAmount?: number;
  isGlitch: boolean;
  trueName: string;
  trueDescription: string;
  fakeName: string;
  fakeDescription: string;
  isTruth: boolean;
}

export interface EntityDisplayFlags {
  isPeacefulTalkable: boolean;
  isHostileBoss: boolean;
}

export interface DisplayFilterPrompt {
  title: string;
  keepLabel: string;
  keepNote: string;
  breakLabel: string;
  breakNote: string;
}

export interface DisplayEnding {
  endingId: EndingId;
  title: string;
  body: string;
  isTruthEnding: boolean;
}

export interface DisplayPacket {
  mode: PerceptionMode;
  veilStatusLabel: string;
  roomName: string;
  statusBanner: string;
  logs: DisplayLogEntry[];
  inventory: DisplayItem[];
  entityVisuals: Record<string, EntityDisplayFlags>;
  filterPrompt: DisplayFilterPrompt | null;
  ending: DisplayEnding | null;
}

interface DualTextEntity {
  truth: { name: string; dialogue: string };
  illusion: { name: string; dialogue: string };
  talkDialogue?: string;
  talkDialogueWithBadge?: string;
}

interface DualTextItem {
  healAmount?: number;
  truth: { name: string; description: string };
  illusion: { name: string; description: string };
}

interface RoomMeta {
  name: string;
}

const ENTITY_CATALOG = entitiesData as Record<string, DualTextEntity>;
const ITEM_CATALOG = itemsData as Record<string, DualTextItem>;
const MAP_CATALOG = mapsData as Record<string, RoomMeta>;
const MODIFIER_CATALOG = modifiersData as Record<string, ModifierConfig>;

const SUMMONER_BLESSING_ID = 'summoner_blessing';
const CAPTAIN_ENTITY_ID = 'captain_01';

export function getPerceptionMode(
  lucidity: number,
  filterChoice: FilterChoice = 'UNDECIDED',
): PerceptionMode {
  if (filterChoice === 'KEEP') {
    return 'illusion';
  }
  if (filterChoice === 'BREAK') {
    return 'truth';
  }
  if (lucidity < 30) {
    return 'illusion';
  }
  if (lucidity < 70) {
    return 'glitch';
  }
  return 'truth';
}

export function getVeilStatusLabel(
  lucidity: number,
  filterChoice: FilterChoice,
): string {
  if (filterChoice === 'KEEP') {
    return 'Đã khóa';
  }
  if (filterChoice === 'BREAK') {
    return 'Đã xé';
  }
  if (lucidity < 30) {
    return 'Ổn định';
  }
  if (lucidity < 70) {
    return 'Nhiễu';
  }
  return 'Rạn vỡ';
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
  getRoomName(roomId: string): string {
    return MAP_CATALOG[roomId]?.name ?? roomId;
  }

  getVeilStatusLabel(lucidity: number, filterChoice: FilterChoice): string {
    return getVeilStatusLabel(lucidity, filterChoice);
  }

  getStatusBanner(lucidity: number, filterChoice: FilterChoice = 'UNDECIDED'): string {
    const mode = getPerceptionMode(lucidity, filterChoice);
    if (mode === 'illusion') {
      return '[HỆ THỐNG]: Màn Che Nhận Thức ổn định. Sứ mệnh: Thanh tẩy mọi Vong linh trong khu vực.';
    }
    if (mode === 'glitch') {
      return '[CẢNH BÁO]: Phát hiện nhiễu Màn Che Nhận Thức... Đang hiệu chỉnh lại.';
    }
    return '[CẢNH BÁO]: Màn Che Nhận Thức đã rạn vỡ. Thực tại đang lộ diện.';
  }

  isEntityPeacefulTalkable(entity: EntityState, filterChoice: FilterChoice): boolean {
    return filterChoice === 'BREAK' && entity.canTalk === true && entity.provoked === false;
  }

  getEntityVisuals(state: GameState): Record<string, EntityDisplayFlags> {
    const visuals: Record<string, EntityDisplayFlags> = {};
    for (const entity of state.entities) {
      if (entity.hp <= 0) continue;
      const isPeacefulTalkable = this.isEntityPeacefulTalkable(entity, state.filterChoice);
      const isHostileBoss =
        entity.aiBehavior === 'checkpoint_boss' &&
        !isPeacefulTalkable &&
        (state.filterChoice === 'KEEP' || entity.provoked);

      visuals[entity.id] = {
        isPeacefulTalkable,
        isHostileBoss,
      };
    }
    return visuals;
  }

  getFilterPrompt(): DisplayFilterPrompt {
    const blessing = MODIFIER_CATALOG[SUMMONER_BLESSING_ID];
    const keepNote = blessing
      ? `+${blessing.attackBonus} ATK, +${blessing.maxHpBonus} Max HP, hồi ${blessing.instantHeal} HP · Tiếp tục thanh tẩy`
      : '+8 ATK, +20 Max HP, hồi 25 HP · Tiếp tục thanh tẩy';

    return {
      title: 'MÀN CHE NHẬN THỨC ĐANG RẠN VỠ',
      keepLabel: 'Giữ Màn Che',
      keepNote,
      breakLabel: 'Xé Màn Che',
      breakNote: 'Không nhận buff · Nhìn thấu sự thật & mở Giao tiếp',
    };
  }

  getEndingDisplay(
    endingId: EndingId | null,
    filterChoice: FilterChoice,
  ): DisplayEnding | null {
    if (!endingId) return null;

    if (endingId === 'SUMMONER_BLADE') {
      if (filterChoice === 'BREAK') {
        return {
          endingId,
          title: 'Kết cục 1 (Biến thể): Kẻ Phá Luật',
          body: 'Đội trưởng Kiểm soát gục xuống. Ngươi không còn bị Màn Che lừa dối, cũng chẳng mang Khế Ước Triệu Hồi — nhưng ngươi vẫn chọn mở đường bằng máu. Sau cánh cổng Nội thành vừa bị phá toang, hồi còi báo động của Đế Quốc Vĩnh Hằng đã vang lên, và lần này kẻ bị săn đuổi là một kẻ tỉnh táo.',
          isTruthEnding: true,
        };
      }

      return {
        endingId,
        title: 'Kết cục 1: Lưỡi Gươm Của Kẻ Triệu Hồi',
        body: "Đội trưởng Kiểm soát gục xuống dưới sức mạnh tàn bạo của Khế Ước Triệu Hồi. Trước mắt ngươi chỉ còn đống giáp xương vỡ vụn cùng dòng khen thưởng vô cảm từ Hệ thống — còn sau cánh cổng Nội thành vừa bị phá toang, tiếng kêu cứu tuyệt vọng của những thường dân mà ngươi vẫn nhìn thấy là 'vong linh' mới chỉ vừa bắt đầu.",
        isTruthEnding: false,
      };
    }

    return {
      endingId,
      title: 'Kết cục 2: Người Xé Màn Sương',
      body: 'Cánh cổng sắt nặng nề chỉ hé mở vừa đủ để hai hàng Tuần vệ Bất tử tiến ra áp giải ngươi vào Nội thành. Không một lời chào đón — chỉ có Đế luật lạnh băng. Nhưng giữa vòng vây giáp sắt, lần đầu tiên ngươi nhìn thấy những con phố sạch bóng cướp bóc, nơi người sống an cư dưới bóng tối uy nghiêm của Đế Quốc. Màn Che đã rách; ván cờ thật sự chỉ vừa mở màn.',
      isTruthEnding: true,
    };
  }

  translateEvents(
    events: GameEvent[],
    lucidity: number,
    filterChoice: FilterChoice = 'UNDECIDED',
  ): DisplayLogEntry[] {
    const mode = getPerceptionMode(lucidity, filterChoice);
    const logs: DisplayLogEntry[] = [];

    for (const event of events) {
      const entry = this.translateSingleEvent(event, mode);
      if (entry) {
        logs.push(entry);
      }
    }

    return logs;
  }

  getDisplayInventory(
    itemIds: string[],
    lucidity: number,
    filterChoice: FilterChoice = 'UNDECIDED',
  ): DisplayItem[] {
    const mode = getPerceptionMode(lucidity, filterChoice);

    return itemIds
      .map((itemId): DisplayItem | null => {
        const item = ITEM_CATALOG[itemId];
        if (!item) return null;

        if (mode === 'truth') {
          return {
            id: itemId,
            name: item.truth.name,
            description: item.truth.description,
            healAmount: item.healAmount,
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
          healAmount: item.healAmount,
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
    const mode = getPerceptionMode(state.lucidity, state.filterChoice);
    return {
      mode,
      veilStatusLabel: this.getVeilStatusLabel(state.lucidity, state.filterChoice),
      roomName: this.getRoomName(state.currentRoomId),
      statusBanner: this.getStatusBanner(state.lucidity, state.filterChoice),
      logs: this.translateEvents(events, state.lucidity, state.filterChoice),
      inventory: this.getDisplayInventory(
        state.inventory,
        state.lucidity,
        state.filterChoice,
      ),
      entityVisuals: this.getEntityVisuals(state),
      filterPrompt: state.pendingFilterChoice ? this.getFilterPrompt() : null,
      ending: this.getEndingDisplay(state.endingId, state.filterChoice),
    };
  }

  private translateSingleEvent(
    event: GameEvent,
    mode: PerceptionMode,
  ): DisplayLogEntry | null {
    switch (event.type) {
      case 'ROOM_CHANGED': {
        const roomName = this.getRoomName(event.toRoomId);
        return {
          text: `Bước qua cánh cửa, tiến vào: ${roomName}.`,
          isGlitch: false,
          isTruth: false,
        };
      }

      case 'PLAYER_WAITED':
        return {
          text: 'Giữ nguyên vị trí, lặng lẽ quan sát xung quanh.',
          isGlitch: false,
          isTruth: false,
        };

      case 'ATTACKED': {
        const target = ENTITY_CATALOG[event.targetId];
        if (!target) return null;
        return buildLogEntry(
          mode,
          `[Gây ${event.damage} sát thương lên ${target.truth.name}]`,
          `[Gây ${event.damage} sát thương lên ${target.illusion.name}]`,
          `[KHÔI PHỤC MÀN CHE: ${target.illusion.name}]`,
        );
      }

      case 'ENEMY_ATTACKED': {
        const attacker = ENTITY_CATALOG[event.attackerId];
        if (!attacker) return null;
        return buildLogEntry(
          mode,
          `[${attacker.truth.name} tấn công, gây ${event.damage} sát thương!]`,
          `[${attacker.illusion.name} tấn công, gây ${event.damage} sát thương!]`,
          `[KHÔI PHỤC MÀN CHE: ${attacker.illusion.name} gây ${event.damage} sát thương!]`,
        );
      }

      case 'GUARD_INTERVENED': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;
        return buildLogEntry(
          mode,
          `${entity.truth.name}: "${entity.truth.dialogue}"`,
          `${entity.illusion.name}: "${entity.illusion.dialogue}"`,
          `[KHÔI PHỤC MÀN CHE] ${entity.illusion.name}: "${entity.illusion.dialogue}"`,
        );
      }

      case 'DIALOGUE_SPOKEN': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;
        return buildLogEntry(
          mode,
          `${entity.truth.name}: "${entity.truth.dialogue}"`,
          `${entity.illusion.name}: "${entity.illusion.dialogue}"`,
          `[KHÔI PHỤC MÀN CHE] ${entity.illusion.name}: "${entity.illusion.dialogue}"`,
        );
      }

      case 'AI_FLED': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;
        return buildLogEntry(
          mode,
          `${entity.truth.name} hoảng sợ lùi lại một bước!`,
          `${entity.illusion.name} lùi lại rình rập!`,
          `[KHÔI PHỤC MÀN CHE: ${entity.illusion.name} lùi lại giữ khoảng cách]`,
        );
      }

      case 'ENTITY_DIED': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;
        return buildLogEntry(
          mode,
          `${entity.truth.name} đã gục xuống nền đá...`,
          `Đã thanh tẩy ${entity.illusion.name}!`,
          `[KHÔI PHỤC MÀN CHE: Đã thanh tẩy ${entity.illusion.name}]`,
        );
      }

      case 'PLAYER_DIED':
        return {
          text: 'Ngươi đã gục ngã. Màn sương đen nuốt chửng tầm nhìn.',
          isGlitch: false,
          isTruth: false,
          isDanger: true,
        };

      case 'ITEM_DROPPED': {
        const item = ITEM_CATALOG[event.itemId];
        if (!item) return null;
        return buildLogEntry(
          mode,
          `Rơi ra vật phẩm: ${item.truth.name}.`,
          `Phát hiện chiến lợi phẩm: ${item.illusion.name}.`,
          `[KHÔI PHỤC MÀN CHE: Chiến lợi phẩm ${item.illusion.name}]`,
        );
      }

      case 'ITEM_PICKED_UP': {
        const item = ITEM_CATALOG[event.itemId];
        if (!item) return null;
        return buildLogEntry(
          mode,
          `Nhặt được: ${item.truth.name}.`,
          `Thu hồi: ${item.illusion.name}.`,
          `[KHÔI PHỤC MÀN CHE: Đã thu hồi ${item.illusion.name}]`,
        );
      }

      case 'ITEM_USED': {
        const item = ITEM_CATALOG[event.itemId];
        if (!item) return null;
        return buildLogEntry(
          mode,
          `Dùng ${item.truth.name}, hồi ${event.healAmount} HP.`,
          `Nuốt vội ${item.illusion.name}, hồi ${event.healAmount} HP.`,
          `[KHÔI PHỤC MÀN CHE] Nuốt vội ${item.illusion.name}, hồi ${event.healAmount} HP.`,
        );
      }

      case 'FILTER_THRESHOLD_REACHED':
        return {
          text: 'MÀN CHE NHẬN THỨC ĐANG RẠN VỠ — NGƯƠI PHẢI LỰA CHỌN!',
          isGlitch: false,
          isTruth: false,
          isDanger: true,
        };

      case 'FILTER_CHOICE_MADE': {
        if (event.choice === 'KEEP') {
          const modifier = event.appliedModifierId
            ? MODIFIER_CATALOG[event.appliedModifierId]
            : MODIFIER_CATALOG[SUMMONER_BLESSING_ID];
          const text = modifier
            ? `[HỆ THỐNG] Khóa chặt Màn Che hoàn tất. Kích hoạt ${modifier.name} (+${modifier.attackBonus} ATK, +${modifier.maxHpBonus} Max HP, hồi ${modifier.instantHeal} HP). Hãy tiếp tục thanh tẩy!`
            : '[HỆ THỐNG] Khóa chặt Màn Che hoàn tất. Kích hoạt Khế Ước Triệu Hồi (+8 ATK, +20 Max HP, hồi 25 HP). Hãy tiếp tục thanh tẩy!';
          return {
            text,
            isGlitch: false,
            isTruth: false,
            isSystem: true,
          };
        }

        return {
          text: 'Ngươi xé toạc Màn Che. Mọi tiếng gầm khát máu tắt lịm — chỉ còn lại thế giới thật lạnh lẽo và trần trụi.',
          isGlitch: false,
          isTruth: true,
          noPrefix: true,
        };
      }

      case 'NPC_TALKED': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;
        const rawDialogue =
          event.entityId === CAPTAIN_ENTITY_ID &&
          event.hasBadge === true &&
          entity.talkDialogueWithBadge
            ? entity.talkDialogueWithBadge
            : entity.talkDialogue ?? entity.truth.dialogue;
        const formattedDialogue = rawDialogue.startsWith('"')
          ? rawDialogue
          : `"${rawDialogue}"`;

        return {
          text: `${entity.truth.name}: ${formattedDialogue}`,
          isGlitch: false,
          isTruth: false,
          isTalk: true,
        };
      }

      case 'GAME_ENDED':
      case 'PLAYER_MOVED':
      case 'LUCIDITY_CHANGED':
        return null;
    }
  }
}
