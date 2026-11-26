import classesData from '../data/classes.json';
import entitiesData from '../data/entities.json';
import itemsData from '../data/items.json';
import mapsData from '../data/maps.json';
import modifiersData from '../data/modifiers.json';
import racesData from '../data/races.json';
import type {
  ClassConfig,
  ClassId,
  EndingId,
  EntityState,
  FilterChoice,
  GameEvent,
  GameState,
  ModifierConfig,
  RaceConfig,
  RaceId,
} from '../core/types';

export type PerceptionMode = 'illusion' | 'glitch' | 'truth';
export const GLITCH_DURATION_MS = 2700;

export interface DisplayLogEntry {
  text: string;
  isGlitch: boolean;
  trueText?: string;
  fakeText?: string;
  isTruth: boolean;
  isDanger?: boolean;
  isWarning?: boolean;
  isTalk?: boolean;
  isSystem?: boolean;
  noPrefix?: boolean;
}

export interface DisplayItem {
  id: string;
  name: string;
  description: string;
  healAmount?: number;
  effectiveHealAmount?: number;
  isGlitch: boolean;
  trueName: string;
  trueDescription: string;
  fakeName: string;
  fakeDescription: string;
  isTruth: boolean;
}

export interface DisplayRaceOption {
  id: RaceId;
  displayName: string;
  systemLabel: string;
  systemHeader: string;
  systemNote?: string;
  description: string;
  maxHpBonus: number;
  attackBonus: number;
  traitName: string;
  traitDescription: string;
}

export interface DisplayClassOption {
  id: ClassId;
  displayName: string;
  name: string;
  description: string;
  maxHpBonus: number;
  attackBonus: number;
  traitName: string;
  traitDescription: string;
}

export interface DisplayBuildOptions {
  title: string;
  raceGroupLabel: string;
  classGroupLabel: string;
  startButtonLabel: string;
  baseMaxHp: number;
  baseAttack: number;
  races: DisplayRaceOption[];
  classes: DisplayClassOption[];
}

export interface EntityDisplayFlags {
  isPeacefulTalkable: boolean;
  isHostileBoss: boolean;
}

export interface RoomVisualSummary {
  hasRegularEntity: boolean;
  hasPeacefulTalkable: boolean;
  hasHostileBoss: boolean;
}

export interface DisplayFilterPrompt {
  title: string;
  keepLabel: string;
  keepNote: string;
  breakLabel: string;
  breakNote: string;
}

export interface DisplayBossPrompt {
  title: string;
  surrenderLabel: string;
  surrenderNote: string;
  fightLabel: string;
  fightNote: string;
}

export interface DisplayEntityInspection {
  entityId: string;
  displayName: string;
  hp: number;
  maxHp: number;
  attack: number;
  statusLabel: string;
  isPeacefulTalkable: boolean;
  isGlitching: boolean;
  glitchTruthName?: string;
}

export type CodexEndingKey = 'SUMMONER_BLADE' | 'RULE_BREAKER' | 'AWAKENED';

export interface CodexEntryDefinition {
  key: CodexEndingKey;
  title: string;
  lockedLabel: string;
}

export const CODEX_LOCKED_LABEL = '??? — Chưa mở khóa';

export interface DisplayEnding {
  endingId: EndingId;
  title: string;
  body: string;
  isTruthEnding: boolean;
}

export interface DisplayPacket {
  mode: PerceptionMode;
  veilStatusLabel: string;
  buildDisplayLabel: string;
  roomName: string;
  statusBanner: string;
  logs: DisplayLogEntry[];
  inventory: DisplayItem[];
  entityVisuals: Record<string, EntityDisplayFlags>;
  roomVisualSummary: RoomVisualSummary;
  filterPrompt: DisplayFilterPrompt | null;
  bossPrompt: DisplayBossPrompt | null;
  ending: DisplayEnding | null;
  isRiposteReady: boolean;
  codexEndingKey?: CodexEndingKey;
}

interface DualTextEntity {
  hp: number;
  maxHp: number;
  attack: number;
  truth: { name: string; dialogue: string };
  illusion: { name: string; dialogue: string };
  talkDialogue?: string;
  raceTalkDialogue?: Partial<Record<RaceId, string>>;
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
const RACE_CATALOG = racesData as Record<RaceId, RaceConfig>;
const CLASS_CATALOG = classesData as Record<ClassId, ClassConfig>;

const SUMMONER_BLESSING_ID = 'summoner_blessing';
const CAPTAIN_ENTITY_ID = 'captain_01';

export const BOSS_PROMPT_TEXT = {
  title: 'Đội Trưởng Kiểm Soát đang chờ ngươi hạ tay. Ngươi sẽ làm gì?',
  surrenderLabel: 'Hạ tay chịu áp giải',
  surrenderNote: 'Chấp nhận đình chiến · Tiến vào Nội Thành',
  fightLabel: 'Ra đòn mở đường',
  fightNote: 'Chủ động khai chiến · Tự mở đường bằng máu',
} as const;

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

function formatDialogueSegment(rawDialogue: string): string {
  const trimmed = rawDialogue.trim();
  return trimmed.startsWith('"') ? trimmed : `"${trimmed}"`;
}

export class PerceptionService {
  getRoomName(roomId: string): string {
    return MAP_CATALOG[roomId]?.name ?? roomId;
  }

  getVeilStatusLabel(lucidity: number, filterChoice: FilterChoice): string {
    return getVeilStatusLabel(lucidity, filterChoice);
  }

  getBuildOptions(): DisplayBuildOptions {
    const playerBase = ENTITY_CATALOG.player;
    const races: DisplayRaceOption[] = Object.values(RACE_CATALOG).map((race) => ({
      id: race.id,
      displayName: race.systemLabel,
      systemLabel: race.systemLabel,
      systemHeader: `[HỆ THỐNG]: ${race.systemLabel}`,
      ...(race.systemNote ? { systemNote: race.systemNote } : {}),
      description: race.description,
      maxHpBonus: race.maxHpBonus,
      attackBonus: race.attackBonus,
      traitName: race.trait.name,
      traitDescription: race.trait.description,
    }));

    const classes: DisplayClassOption[] = Object.values(CLASS_CATALOG).map((cls) => ({
      id: cls.id,
      displayName: cls.name,
      name: cls.name,
      description: cls.description,
      maxHpBonus: cls.maxHpBonus,
      attackBonus: cls.attackBonus,
      traitName: cls.trait.name,
      traitDescription: cls.trait.description,
    }));

    return {
      title: '[HỆ THỐNG] KHỞI TẠO HỒ SƠ TRIỆU HỒI',
      raceGroupLabel: 'CHỦNG TỘC',
      classGroupLabel: 'LỚP NGHỀ',
      startButtonLabel: 'Khởi hành',
      baseMaxHp: playerBase.maxHp,
      baseAttack: playerBase.attack,
      races,
      classes,
    };
  }

  getBuildDisplayLabel(state: GameState): string {
    const race = RACE_CATALOG[state.selectedRaceId];
    const playerClass = CLASS_CATALOG[state.selectedClassId];
    const raceLabel = race
      ? state.filterChoice === 'BREAK'
        ? race.name
        : race.systemLabel
      : state.selectedRaceId;
    const classLabel = playerClass ? playerClass.name : state.selectedClassId;
    return `${raceLabel} · ${classLabel}`;
  }

  getEffectiveHealAmount(baseHealAmount: number, raceId: RaceId = 'human'): number {
    if (baseHealAmount <= 0) return 0;
    const healBonus = RACE_CATALOG[raceId]?.trait.healBonus ?? 0;
    return baseHealAmount + healBonus;
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

  inspectEntity(state: GameState, entityId: string): DisplayEntityInspection | null {
    const entity = state.entities.find(
      (entry) => entry.id === entityId && entry.hp > 0,
    );
    const meta = ENTITY_CATALOG[entityId];
    if (!entity || !meta) {
      return null;
    }

    const mode = getPerceptionMode(state.lucidity, state.filterChoice);
    const isGlitching = mode === 'glitch' && state.filterChoice === 'UNDECIDED';
    const displayName = mode === 'truth' ? meta.truth.name : meta.illusion.name;
    const isPeacefulTalkable = this.isEntityPeacefulTalkable(entity, state.filterChoice);
    const statusLabel = isPeacefulTalkable
      ? 'Hòa bình — Tiếp cận để giao tiếp'
      : 'Thù địch';

    return {
      entityId: entity.id,
      displayName,
      hp: entity.hp,
      maxHp: entity.maxHp,
      attack: entity.attack,
      statusLabel,
      isPeacefulTalkable,
      isGlitching,
      ...(isGlitching ? { glitchTruthName: meta.truth.name } : {}),
    };
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

  getBossPrompt(): DisplayBossPrompt {
    return { ...BOSS_PROMPT_TEXT };
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
        body: "‘Thống Lĩnh Vong Cốt’ — kẻ thực chất là Đội trưởng Kiểm soát — gục xuống dưới sức mạnh tàn bạo của Khế Ước Triệu Hồi. Trước mắt ngươi chỉ còn đống giáp xương vỡ vụn cùng dòng khen thưởng vô cảm từ Hệ thống — còn sau cánh cổng Nội thành vừa bị phá toang, tiếng kêu cứu tuyệt vọng của những thường dân mà ngươi vẫn nhìn thấy là 'vong linh' mới chỉ vừa bắt đầu.",
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

  getCodexEndingKey(
    endingId: EndingId | null,
    filterChoice: FilterChoice,
  ): CodexEndingKey | undefined {
    if (!endingId) return undefined;
    if (endingId === 'SUMMONER_BLADE') {
      return filterChoice === 'BREAK' ? 'RULE_BREAKER' : 'SUMMONER_BLADE';
    }
    return 'AWAKENED';
  }

  getCodexDefinitions(): CodexEntryDefinition[] {
    return [
      {
        key: 'SUMMONER_BLADE',
        title: 'Lưỡi Gươm Của Kẻ Triệu Hồi',
        lockedLabel: CODEX_LOCKED_LABEL,
      },
      {
        key: 'RULE_BREAKER',
        title: 'Kẻ Phá Luật',
        lockedLabel: CODEX_LOCKED_LABEL,
      },
      {
        key: 'AWAKENED',
        title: 'Người Xé Màn Sương',
        lockedLabel: CODEX_LOCKED_LABEL,
      },
    ];
  }

  translateEvents(
    events: GameEvent[],
    lucidity: number,
    filterChoice: FilterChoice = 'UNDECIDED',
    selectedRaceId: RaceId = 'human',
  ): DisplayLogEntry[] {
    const mode = getPerceptionMode(lucidity, filterChoice);
    const logs: DisplayLogEntry[] = [];

    for (const event of events) {
      const result = this.translateSingleEvent(event, mode, selectedRaceId);
      if (!result) continue;
      if (Array.isArray(result)) {
        logs.push(...result);
      } else {
        logs.push(result);
      }
    }

    return logs;
  }

  getDisplayInventory(
    itemIds: string[],
    lucidity: number,
    filterChoice: FilterChoice = 'UNDECIDED',
    selectedRaceId: RaceId = 'human',
  ): DisplayItem[] {
    const mode = getPerceptionMode(lucidity, filterChoice);
    const raceTrait = RACE_CATALOG[selectedRaceId]?.trait;
    const healBonus = raceTrait?.healBonus ?? 0;

    return itemIds
      .map((itemId): DisplayItem | null => {
        const item = ITEM_CATALOG[itemId];
        if (!item) return null;
        const isHealingItem = item.healAmount !== undefined && item.healAmount > 0;
        const effectiveHealAmount = isHealingItem
          ? this.getEffectiveHealAmount(item.healAmount!, selectedRaceId)
          : undefined;
        const traitHealNote =
          isHealingItem && healBonus > 0 && raceTrait
            ? ` (+${healBonus} ${raceTrait.name})`
            : '';
        const trueDescription = `${item.truth.description}${traitHealNote}`;
        const fakeDescription = `${item.illusion.description}${traitHealNote}`;

        if (mode === 'truth') {
          return {
            id: itemId,
            name: item.truth.name,
            description: trueDescription,
            healAmount: item.healAmount,
            effectiveHealAmount,
            isGlitch: false,
            trueName: item.truth.name,
            trueDescription,
            fakeName: item.illusion.name,
            fakeDescription,
            isTruth: true,
          };
        }

        return {
          id: itemId,
          name: item.illusion.name,
          description: fakeDescription,
          healAmount: item.healAmount,
          effectiveHealAmount,
          isGlitch: mode === 'glitch',
          trueName: item.truth.name,
          trueDescription,
          fakeName: item.illusion.name,
          fakeDescription,
          isTruth: false,
        };
      })
      .filter((item): item is DisplayItem => item !== null);
  }

  getRoomVisualSummary(
    state: GameState,
    entityVisuals: Record<string, EntityDisplayFlags>,
  ): RoomVisualSummary {
    let hasRegularEntity = false;
    let hasPeacefulTalkable = false;
    let hasHostileBoss = false;

    for (const entity of state.entities) {
      if (entity.roomId !== state.currentRoomId || entity.hp <= 0) continue;
      const visual = entityVisuals[entity.id];
      if (visual?.isPeacefulTalkable) {
        hasPeacefulTalkable = true;
      } else if (visual?.isHostileBoss) {
        hasHostileBoss = true;
      } else {
        hasRegularEntity = true;
      }
    }

    return {
      hasRegularEntity,
      hasPeacefulTalkable,
      hasHostileBoss,
    };
  }

  buildDisplayPacket(state: GameState, events: GameEvent[]): DisplayPacket {
    const mode = getPerceptionMode(state.lucidity, state.filterChoice);
    const entityVisuals = this.getEntityVisuals(state);
    const codexEndingKey = this.getCodexEndingKey(state.endingId, state.filterChoice);
    return {
      mode,
      veilStatusLabel: this.getVeilStatusLabel(state.lucidity, state.filterChoice),
      buildDisplayLabel: this.getBuildDisplayLabel(state),
      roomName: this.getRoomName(state.currentRoomId),
      statusBanner: this.getStatusBanner(state.lucidity, state.filterChoice),
      logs: this.translateEvents(
        events,
        state.lucidity,
        state.filterChoice,
        state.selectedRaceId,
      ),
      inventory: this.getDisplayInventory(
        state.inventory,
        state.lucidity,
        state.filterChoice,
        state.selectedRaceId,
      ),
      entityVisuals,
      roomVisualSummary: this.getRoomVisualSummary(state, entityVisuals),
      filterPrompt: state.pendingFilterChoice ? this.getFilterPrompt() : null,
      bossPrompt: state.pendingBossChoice ? this.getBossPrompt() : null,
      ending: this.getEndingDisplay(state.endingId, state.filterChoice),
      isRiposteReady: state.isRiposteReady,
      ...(codexEndingKey ? { codexEndingKey } : {}),
    };
  }

  private translateSingleEvent(
    event: GameEvent,
    mode: PerceptionMode,
    selectedRaceId: RaceId,
  ): DisplayLogEntry | DisplayLogEntry[] | null {
    switch (event.type) {
      case 'ROOM_CHANGED': {
        const roomName = this.getRoomName(event.toRoomId);
        return {
          text: `Bước qua cánh cửa, tiến vào: ${roomName}.`,
          isGlitch: false,
          isTruth: false,
        };
      }

      case 'ROOM_AMBIENT_OBSERVED':
        return buildLogEntry(
          mode,
          'Phía trước kho quân nhu, Phu Chở Lương run rẩy lùi lại trong lúc Tuần Vệ Bảo Hộ bước lên chắn trước mặt công dân.',
          'Phía trước kho lương, Thây Ma Tải Xác rít lên giữa đống hàng trong lúc Đao Phủ Vong Cốt giơ cao lưỡi rìu.',
          '[KHÔI PHỤC MÀN CHE: Phía trước kho lương, Thây Ma Tải Xác rít lên giữa đống hàng trong lúc Đao Phủ Vong Cốt giơ cao lưỡi rìu.]',
        );

      case 'PLAYER_WAITED':
        return {
          text: 'Giữ nguyên vị trí, lặng lẽ quan sát xung quanh.',
          isGlitch: false,
          isTruth: false,
        };

      case 'ATTACKED': {
        const target = ENTITY_CATALOG[event.targetId];
        if (!target) return null;
        const attackEntry = buildLogEntry(
          mode,
          `[Gây ${event.damage} sát thương lên ${target.truth.name}]`,
          `[Gây ${event.damage} sát thương lên ${target.illusion.name}]`,
          `[KHÔI PHỤC MÀN CHE: Gây ${event.damage} sát thương lên ${target.illusion.name}]`,
        );

        if (
          event.triggeredTraitId === 'combo_strike' &&
          event.bonusDamage &&
          event.bonusDamage > 0
        ) {
          return [
            attackEntry,
            {
              text: `[Liên Hoàn Quyền: +${event.bonusDamage} sát thương!]`,
              isGlitch: false,
              isTruth: false,
              noPrefix: true,
            },
          ];
        }

        if (
          event.triggeredTraitId === 'first_strike' &&
          event.bonusDamage &&
          event.bonusDamage > 0
        ) {
          return [
            attackEntry,
            {
              text: `[Nhát Chém Tiên Phong: +${event.bonusDamage} sát thương!]`,
              isGlitch: false,
              isTruth: false,
              noPrefix: true,
            },
          ];
        }

        if (
          event.triggeredTraitId === 'riposte_strike' &&
          event.bonusDamage &&
          event.bonusDamage > 0
        ) {
          return [
            attackEntry,
            {
              text: `[Thế Phản Công: +${event.bonusDamage} sát thương!]`,
              isGlitch: false,
              isTruth: false,
              noPrefix: true,
            },
          ];
        }

        return attackEntry;
      }

      case 'ENEMY_ATTACKED': {
        const attacker = ENTITY_CATALOG[event.attackerId];
        if (!attacker) return null;

        const flatReduced =
          event.flatDamageReduced ??
          (event.triggeredTraitId === 'undying_frame' ? event.damageReduced : undefined);
        const undyingNote =
          flatReduced && flatReduced > 0 ? ` (-${flatReduced} sát thương)` : '';

        const hitEntry = buildLogEntry(
          mode,
          `[${attacker.truth.name} tấn công, gây ${event.damage} sát thương!${undyingNote}]`,
          `[${attacker.illusion.name} tấn công, gây ${event.damage} sát thương!${undyingNote}]`,
          `[KHÔI PHỤC MÀN CHE: ${attacker.illusion.name} gây ${event.damage} sát thương!${undyingNote}]`,
        );

        if (event.riposteArmed === true) {
          const riposteBonus =
            CLASS_CATALOG.iron_vanguard?.trait.riposteBonusDamage ?? 10;
          return [
            hitEntry,
            {
              text: `[Thế Thủ Thép: Giảm nửa sát thương, nạp Thế Phản Công (+${riposteBonus} sát thương cho đòn đánh tới)!]`,
              isGlitch: false,
              isTruth: false,
              noPrefix: true,
            },
          ];
        }

        return hitEntry;
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

        const breakEntry: DisplayLogEntry = {
          text: 'Ngươi xé toạc Màn Che. Mọi tiếng gầm khát máu tắt lịm — chỉ còn lại thế giới thật lạnh lẽo và trần trụi.',
          isGlitch: false,
          isTruth: true,
          noPrefix: true,
        };

        if (selectedRaceId === 'undead_outsider') {
          return [
            breakEntry,
            {
              text: "Màn sương tan biến — thứ ẩn dưới lớp vỏ 'Khung Thể Dị Hình' không phải sinh vật sống, mà là thân xác lạnh ngắt của một Bất Tử Dị Giới.",
              isGlitch: false,
              isTruth: true,
              noPrefix: true,
            },
          ];
        }

        return breakEntry;
      }

      case 'NPC_TALKED': {
        const entity = ENTITY_CATALOG[event.entityId];
        if (!entity) return null;

        if (event.entityId === CAPTAIN_ENTITY_ID) {
          const primaryRaw =
            (event.raceId ? entity.raceTalkDialogue?.[event.raceId] : undefined) ??
            entity.talkDialogue ??
            entity.truth.dialogue;
          const formattedPrimary = formatDialogueSegment(primaryRaw);

          if (event.hasBadge === true && entity.talkDialogueWithBadge) {
            const formattedBadge = formatDialogueSegment(entity.talkDialogueWithBadge);
            return {
              text: `${entity.truth.name}: ${formattedPrimary}\n${formattedBadge}`,
              isGlitch: false,
              isTruth: false,
              isTalk: true,
            };
          }

          return {
            text: `${entity.truth.name}: ${formattedPrimary}`,
            isGlitch: false,
            isTruth: false,
            isTalk: true,
          };
        }

        const rawDialogue = entity.talkDialogue ?? entity.truth.dialogue;
        const formattedDialogue = formatDialogueSegment(rawDialogue);

        return {
          text: `${entity.truth.name}: ${formattedDialogue}`,
          isGlitch: false,
          isTruth: false,
          isTalk: true,
        };
      }

      case 'BOSS_CHOICE_REACHED':
        return {
          text: BOSS_PROMPT_TEXT.title,
          isGlitch: false,
          isTruth: false,
          isWarning: true,
          noPrefix: true,
        };

      case 'LUCIDITY_CHANGED': {
        const prevLucidity = event.newLucidity - event.amount;
        if (mode === 'glitch' && prevLucidity < 30 && event.newLucidity >= 30) {
          return {
            text: this.getStatusBanner(event.newLucidity, 'UNDECIDED'),
            isGlitch: false,
            isTruth: false,
            isWarning: true,
            noPrefix: true,
          };
        }
        return null;
      }

      case 'GAME_ENDED':
      case 'PLAYER_MOVED':
        return null;
    }
  }
}
