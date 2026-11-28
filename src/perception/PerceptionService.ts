import classesData from '../data/classes.json';
import entitiesData from '../data/entities.json';
import itemsData from '../data/items.json';
import mapsData from '../data/maps.json';
import modifiersData from '../data/modifiers.json';
import racesData from '../data/races.json';
import {
  MAX_INVENTORY_SLOTS,
  type CheckpointResolution,
  type ClassConfig,
  type ClassId,
  type EndingId,
  type EntityState,
  type FilterChoice,
  type GameEvent,
  type GameState,
  type HubActionChoice,
  type HubNpcRole,
  type ImperialRecord,
  type LegalStatus,
  type ModifierConfig,
  type RaceConfig,
  type RaceId,
  type TribunalChoice,
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
  isWorldRelic?: boolean;
  canUse: boolean;
  actionLabel: string;
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

export interface DisplayTribunalOption {
  choice: TribunalChoice;
  label: string;
  note: string;
}

export interface DisplayTribunalPrompt {
  title: string;
  options: DisplayTribunalOption[];
}

export interface DisplayHubOption {
  choice: HubActionChoice;
  label: string;
  disabled: boolean;
  disabledReason?: string;
}

export interface DisplayHubPrompt {
  entityId: string;
  npcName: string;
  title: string;
  silver: number;
  inventoryCount: number;
  maxInventorySlots: number;
  options: DisplayHubOption[];
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

export type CodexEndingKey =
  | 'SUMMONER_BLADE'
  | 'RULE_BREAKER'
  | 'AWAKENED'
  | 'SOVEREIGN_PACT';

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
  silver: number;
  maxInventorySlots: number;
  inventoryHeaderLabel: string;
  entityVisuals: Record<string, EntityDisplayFlags>;
  roomVisualSummary: RoomVisualSummary;
  filterPrompt: DisplayFilterPrompt | null;
  bossPrompt: DisplayBossPrompt | null;
  tribunalPrompt: DisplayTribunalPrompt | null;
  hubPrompt: DisplayHubPrompt | null;
  ending: DisplayEnding | null;
  isRiposteReady: boolean;
  riposteLabel: string;
  codexEndingKey?: CodexEndingKey;
}

interface DualTextEntity {
  hp: number;
  maxHp: number;
  attack: number;
  isHubNpc?: boolean;
  hubRole?: HubNpcRole;
  truth: { name: string; dialogue: string };
  illusion: { name: string; dialogue: string };
  talkDialogue?: string;
  raceTalkDialogue?: Partial<Record<RaceId, string>>;
  statusTalkDialogue?: Partial<Record<LegalStatus, string>>;
  talkDialogueGuardsKilled?: string;
  talkDialogueCiviliansKilled?: string;
  talkDialogueWithBadge?: string;
}

interface DualTextItem {
  healAmount?: number;
  buyPrice?: number;
  isWorldRelic?: boolean;
  keepDamage?: number;
  keepHeal?: number;
  breakModifierId?: string;
  dormant?: {
    truth: { name: string; description: string };
    illusion: { name: string; description: string };
  };
  truth: { name: string; description: string };
  illusion: { name: string; description: string };
}

interface RoomMeta {
  name: string;
  truth?: { name: string };
  illusion?: { name: string };
}

const ENTITY_CATALOG = entitiesData as Record<string, DualTextEntity>;
const ITEM_CATALOG = itemsData as Record<string, DualTextItem>;
const MAP_CATALOG = mapsData as Record<string, RoomMeta>;
const MODIFIER_CATALOG = modifiersData as Record<string, ModifierConfig>;
const RACE_CATALOG = racesData as Record<RaceId, RaceConfig>;
const CLASS_CATALOG = classesData as Record<ClassId, ClassConfig>;

const SUMMONER_BLESSING_ID = 'summoner_blessing';
const WORLD_RELIC_ID = 'world_relic';
const BORDER_RATION_PACK_ID = 'border_ration_pack';
const DEFAULT_RATION_PRICE = 15;
const HUB_REST_COST = 10;
const CAPTAIN_ENTITY_ID = 'captain_01';
const MAGISTRATE_ENTITY_ID = 'magistrate_01';
const INNER_COURT_ROOM_ID = 'room_inner_court';
const MARKET_STREET_ROOM_ID = 'room_market_street';
const PENAL_OUTPOST_ROOM_ID = 'room_penal_outpost';
const OUTER_SEWER_ROOM_ID = 'room_outer_sewer';

export const BOSS_PROMPT_TEXT = {
  title: 'Đội Trưởng Kiểm Soát đang chờ ngươi hạ tay. Ngươi sẽ làm gì?',
  surrenderLabel: 'Hạ tay chịu áp giải',
  surrenderNote: 'Chấp nhận đình chiến · Tiến vào Nội Thành',
  fightLabel: 'Ra đòn mở đường',
  fightNote: 'Chủ động khai chiến · Tự mở đường bằng máu',
} as const;

export const TRIBUNAL_PROMPT_TEXT = {
  title: 'Phán Quan Pháp Chế đang chờ lời đáp cuối cùng trước Pháp Đình:',
  residencyLabel: 'Tiếp nhận Quy chế Cư trú',
  residencyNote: 'Tuân thủ Đế luật · Định cư hợp pháp tại Nội Thành',
  penalLabel: 'Chấp nhận Án Khổ Sai',
  penalNote: 'Gánh án chuộc tội tại biên trấn theo Đế luật',
  presentRelicLabel: 'Trình Lăng Kính Thực Tại',
  presentRelicNote: 'Dùng Báu Vật Thế Giới đàm phán quy chế Đặc sứ ngang hàng',
  defyLabel: 'Kháng án mở đường máu',
  defyNote: 'Bác bỏ phán quyết · Giao chiến trực diện với Phán Quan',
} as const;

export const HUB_PROMPT_TEXT = {
  buyLabelTruth: 'Mua tiếp tế — 15 Bạc · +35 HP',
  buyLabelIllusion: 'Đổi Bọc Tế Phẩm — 15 Bạc · +35 HP',
  claimFreeLabel: 'Nhận tiếp tế — 0 Bạc · 1 lần',
  restLabel: 'Nghỉ hồi sức — 10 Bạc · Đầy HP',
  closeLabel: 'Rời đi',
  reasonNoSilver: 'Không đủ Bạc',
  reasonBagFull: 'Túi đồ đầy 6/6',
  reasonAlreadyClaimed: 'Đã nhận tiếp tế',
  reasonFullHp: 'HP đã đầy',
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
  getRoomName(roomId: string, mode: PerceptionMode = 'truth'): string {
    const room = MAP_CATALOG[roomId];
    if (!room) return roomId;
    if (mode === 'truth') {
      return room.truth?.name ?? room.name;
    }
    return room.illusion?.name ?? room.name;
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

  isEntityPeacefulTalkable(
    entity: EntityState,
    filterChoice: FilterChoice,
    checkpointResolution: CheckpointResolution = 'UNRESOLVED',
  ): boolean {
    if (entity.isHubNpc === true) {
      return true;
    }
    if (entity.aiBehavior === 'inner_magistrate' && checkpointResolution === 'BREACHED') {
      return false;
    }
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
    const showTruthName =
      entity.isHubNpc === true ? state.filterChoice === 'BREAK' : mode === 'truth';
    const displayName = showTruthName ? meta.truth.name : meta.illusion.name;
    const isPeacefulTalkable = this.isEntityPeacefulTalkable(
      entity,
      state.filterChoice,
      state.checkpointResolution,
    );
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
      const isPeacefulTalkable = this.isEntityPeacefulTalkable(
        entity,
        state.filterChoice,
        state.checkpointResolution,
      );
      const isBossEntity =
        entity.aiBehavior === 'checkpoint_boss' || entity.aiBehavior === 'inner_magistrate';
      const isHostileBoss =
        isBossEntity &&
        !isPeacefulTalkable &&
        (state.filterChoice === 'KEEP' ||
          state.checkpointResolution === 'BREACHED' ||
          entity.provoked);

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

  getTribunalPrompt(state: GameState): DisplayTribunalPrompt {
    const hasCivilianBlood = state.imperialRecord.civiliansKilled > 0;
    const canPresentRelic =
      !hasCivilianBlood && state.inventory.includes(WORLD_RELIC_ID);

    const options: DisplayTribunalOption[] = [
      {
        choice: 'ACCEPT_DECREE',
        label: hasCivilianBlood
          ? TRIBUNAL_PROMPT_TEXT.penalLabel
          : TRIBUNAL_PROMPT_TEXT.residencyLabel,
        note: hasCivilianBlood
          ? TRIBUNAL_PROMPT_TEXT.penalNote
          : TRIBUNAL_PROMPT_TEXT.residencyNote,
      },
    ];

    if (canPresentRelic) {
      options.push({
        choice: 'PRESENT_RELIC',
        label: TRIBUNAL_PROMPT_TEXT.presentRelicLabel,
        note: TRIBUNAL_PROMPT_TEXT.presentRelicNote,
      });
    }

    options.push({
      choice: 'DEFY_TRIBUNAL',
      label: TRIBUNAL_PROMPT_TEXT.defyLabel,
      note: TRIBUNAL_PROMPT_TEXT.defyNote,
    });

    return {
      title: TRIBUNAL_PROMPT_TEXT.title,
      options,
    };
  }

  getHubPrompt(state: GameState): DisplayHubPrompt | null {
    if (!state.activeHubNpcId) return null;
    const npc = state.entities.find(
      (entity) =>
        entity.id === state.activeHubNpcId &&
        entity.hp > 0 &&
        entity.isHubNpc === true,
    );
    const meta = ENTITY_CATALOG[state.activeHubNpcId];
    if (!npc || !npc.hubRole || !meta) return null;

    const showTruth = state.filterChoice === 'BREAK';
    const npcName = showTruth ? meta.truth.name : meta.illusion.name;
    const role = npc.hubRole;
    const rationPrice = ITEM_CATALOG[BORDER_RATION_PACK_ID]?.buyPrice ?? DEFAULT_RATION_PRICE;
    const isBagFull = state.inventory.length >= MAX_INVENTORY_SLOTS;
    const isFullHp = state.player.hp >= state.player.maxHp;
    const options: DisplayHubOption[] = [];

    const offersFreeSupply =
      role === 'sanctum_agent' ||
      (role === 'penal_warden' && state.legalStatus === 'CONVICT');

    if (offersFreeSupply) {
      const alreadyClaimed = state.claimedFreeSupplyIds.includes(npc.id);
      const disabledReason = alreadyClaimed
        ? HUB_PROMPT_TEXT.reasonAlreadyClaimed
        : isBagFull
          ? HUB_PROMPT_TEXT.reasonBagFull
          : undefined;
      options.push({
        choice: 'CLAIM_FREE_SUPPLY',
        label: HUB_PROMPT_TEXT.claimFreeLabel,
        disabled: disabledReason !== undefined,
        ...(disabledReason ? { disabledReason } : {}),
      });
    }

    const offersMerchantServices =
      role === 'market_smith' || role === 'penal_warden' || role === 'sewer_broker';

    if (offersMerchantServices) {
      const buyDisabledReason =
        state.silver < rationPrice
          ? HUB_PROMPT_TEXT.reasonNoSilver
          : isBagFull
            ? HUB_PROMPT_TEXT.reasonBagFull
            : undefined;
      options.push({
        choice: 'BUY_RATION',
        label: showTruth
          ? HUB_PROMPT_TEXT.buyLabelTruth
          : HUB_PROMPT_TEXT.buyLabelIllusion,
        disabled: buyDisabledReason !== undefined,
        ...(buyDisabledReason ? { disabledReason: buyDisabledReason } : {}),
      });

      const restDisabledReason = isFullHp
        ? HUB_PROMPT_TEXT.reasonFullHp
        : state.silver < HUB_REST_COST
          ? HUB_PROMPT_TEXT.reasonNoSilver
          : undefined;
      options.push({
        choice: 'REST_HEAL',
        label: HUB_PROMPT_TEXT.restLabel,
        disabled: restDisabledReason !== undefined,
        ...(restDisabledReason ? { disabledReason: restDisabledReason } : {}),
      });
    }

    options.push({
      choice: 'CLOSE_HUB_MENU',
      label: HUB_PROMPT_TEXT.closeLabel,
      disabled: false,
    });

    return {
      entityId: npc.id,
      npcName,
      title: `${npcName} · ${state.silver} Bạc`,
      silver: state.silver,
      inventoryCount: state.inventory.length,
      maxInventorySlots: MAX_INVENTORY_SLOTS,
      options,
    };
  }

  getEndingDisplay(
    endingId: EndingId | null,
    filterChoice: FilterChoice,
    imperialRecord: ImperialRecord = { guardsKilled: 0, civiliansKilled: 0 },
    legalStatus: LegalStatus = 'UNREGISTERED',
  ): DisplayEnding | null {
    if (!endingId) return null;

    if (endingId === 'SUMMONER_BLADE') {
      if (filterChoice === 'BREAK') {
        return {
          endingId,
          title: 'Kết cục 2: Kẻ Phá Luật',
          body: 'Rũ bỏ cả mệnh lệnh của Thánh Viện lẫn bóng ma Đế luật trên mặt đất, ngươi trang bị gọn ghẽ từ chợ đen cống ngầm rồi lẩn qua cửa Đông hướng về Biên Trấn Bỏ Hoang. Không ai bảo hộ, cũng chẳng ai sai khiến — giữa vùng phế tích bị bỏ quên hai trăm năm trước, ngươi tự tìm lấy con đường sinh tồn của riêng mình.',
          isTruthEnding: true,
        };
      }

      return {
        endingId,
        title: 'Kết cục 1: Lưỡi Gươm Của Kẻ Triệu Hồi',
        body: 'Với bọc tiếp tế từ Liên Lạc Viên Kháng Chiến trong tay, ngươi rời khỏi căn hầm ẩm lạnh để tiến thẳng về Biên Trấn Bỏ Hoang. Trước mắt ngươi chỉ có mệnh lệnh thanh tẩy Mảnh Đá Tà Khí từ Hệ thống — còn phía sau lưng, bàn tay thật sự giật dây Màn Che vẫn lặng lẽ dõi theo bước chân của lưỡi gươm mù quáng.',
        isTruthEnding: false,
      };
    }

    if (endingId === 'SOVEREIGN_PACT') {
      return {
        endingId,
        title: 'Kết cục 4: Khế Ước Ngang Hàng',
        body: 'Lăng Kính Thực Tại vẫn nằm nguyên vẹn trong hành trang. Sau khi chuẩn bị đầy đủ tại Phố Giao Thương theo diện Đặc sứ, ngươi bước qua cổng Đông tiến về Biên Trấn Bỏ Hoang để trực tiếp kiểm chứng di sản của chu kỳ hai trăm năm trước — sẵn sàng mang về quân bài nặng ký nhất cho phiên đàm phán sắp tới với Thượng đỉnh Đế Quốc.',
        isTruthEnding: true,
      };
    }

    const isPenalBranch =
      legalStatus === 'CONVICT' ||
      (legalStatus === 'UNREGISTERED' && imperialRecord.civiliansKilled > 0);
    if (isPenalBranch) {
      return {
        endingId,
        title: 'Kết cục 3: Người Xé Màn Sương',
        body: 'Cầm theo khẩu phần biên ải dưới ánh mắt dò xét của Đội Trưởng Thú Nhân, ngươi bước qua rào gỗ Trạm Biên Ải tiến thẳng về bãi đá Biên Trấn Bỏ Hoang. Giữa món nợ máu với Đế luật và những kẻ đào tẩu cùng đường ngoài kia, chuyến đi chuộc tội của ngươi chỉ vừa mở màn.',
        isTruthEnding: true,
      };
    }

    return {
      endingId,
      title: 'Kết cục 3: Người Xé Màn Sương',
      body: 'Rời khỏi dãy phố sáng đèn và lò rèn đỏ lửa của Nội Thành, ngươi mang theo khẩu phần quân nhu bước qua cổng Đông tiến ra Biên Trấn Bỏ Hoang. Dưới bầu trời tĩnh lặng ngoài tầm bảo hộ của Tuần vệ, chuyến viễn chinh đầu tiên của một công dân dị giới chính thức bắt đầu.',
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
    if (endingId === 'SOVEREIGN_PACT') {
      return 'SOVEREIGN_PACT';
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
      {
        key: 'SOVEREIGN_PACT',
        title: 'Khế Ước Ngang Hàng',
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
      const result = this.translateSingleEvent(
        event,
        mode,
        selectedRaceId,
        filterChoice,
      );
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

        if (item.isWorldRelic === true) {
          return this.buildWorldRelicDisplayItem(itemId, item, mode, filterChoice);
        }

        const isHealingItem = item.healAmount !== undefined && item.healAmount > 0;
        const effectiveHealAmount = isHealingItem
          ? this.getEffectiveHealAmount(item.healAmount!, selectedRaceId)
          : undefined;
        const displayHeal = effectiveHealAmount ?? item.healAmount;
        const actionLabel =
          isHealingItem && displayHeal
            ? `Sử dụng (+${displayHeal} HP · 1 lượt)`
            : '';
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
            canUse: isHealingItem,
            actionLabel,
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
          canUse: isHealingItem,
          actionLabel,
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

  private buildWorldRelicDisplayItem(
    itemId: string,
    item: DualTextItem,
    mode: PerceptionMode,
    filterChoice: FilterChoice,
  ): DisplayItem {
    if (filterChoice === 'UNDECIDED') {
      const dormantTruth = item.dormant?.truth ?? item.truth;
      const dormantIllusion = item.dormant?.illusion ?? item.illusion;
      return {
        id: itemId,
        name: dormantIllusion.name,
        description: dormantIllusion.description,
        isWorldRelic: true,
        canUse: false,
        actionLabel: 'Chưa thức tỉnh',
        isGlitch: mode === 'glitch',
        trueName: dormantTruth.name,
        trueDescription: dormantTruth.description,
        fakeName: dormantIllusion.name,
        fakeDescription: dormantIllusion.description,
        isTruth: false,
      };
    }

    if (filterChoice === 'KEEP') {
      const keepDamage = item.keepDamage ?? 35;
      const keepHeal = item.keepHeal ?? 20;
      return {
        id: itemId,
        name: item.illusion.name,
        description: item.illusion.description,
        isWorldRelic: true,
        canUse: true,
        actionLabel: `Kích hoạt (${keepDamage} sát thương & +${keepHeal} HP · 1 lượt)`,
        isGlitch: false,
        trueName: item.truth.name,
        trueDescription: item.truth.description,
        fakeName: item.illusion.name,
        fakeDescription: item.illusion.description,
        isTruth: false,
      };
    }

    const clarityMod = item.breakModifierId
      ? MODIFIER_CATALOG[item.breakModifierId]
      : undefined;
    const breakActionLabel = clarityMod
      ? `Kích hoạt (+${clarityMod.attackBonus} ATK, +${clarityMod.maxHpBonus} Max HP, hồi ${clarityMod.instantHeal} HP · 1 lượt)`
      : 'Kích hoạt (+5 ATK, +15 Max HP, hồi 30 HP · 1 lượt)';

    return {
      id: itemId,
      name: item.truth.name,
      description: item.truth.description,
      isWorldRelic: true,
      canUse: true,
      actionLabel: breakActionLabel,
      isGlitch: false,
      trueName: item.truth.name,
      trueDescription: item.truth.description,
      fakeName: item.illusion.name,
      fakeDescription: item.illusion.description,
      isTruth: true,
    };
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
    const roomMode: PerceptionMode =
      state.filterChoice === 'UNDECIDED' && mode === 'truth' ? 'illusion' : mode;
    const entityVisuals = this.getEntityVisuals(state);
    const codexEndingKey = this.getCodexEndingKey(state.endingId, state.filterChoice);
    const riposteBonus =
      CLASS_CATALOG.iron_vanguard?.trait.riposteBonusDamage ?? 10;
    const inventory = this.getDisplayInventory(
      state.inventory,
      state.lucidity,
      state.filterChoice,
      state.selectedRaceId,
    );
    return {
      mode,
      veilStatusLabel: this.getVeilStatusLabel(state.lucidity, state.filterChoice),
      buildDisplayLabel: this.getBuildDisplayLabel(state),
      roomName: this.getRoomName(state.currentRoomId, roomMode),
      statusBanner: this.getStatusBanner(state.lucidity, state.filterChoice),
      logs: this.translateEvents(
        events,
        state.lucidity,
        state.filterChoice,
        state.selectedRaceId,
      ),
      inventory,
      silver: state.silver,
      maxInventorySlots: MAX_INVENTORY_SLOTS,
      inventoryHeaderLabel: `HÀNH TRANG (${state.inventory.length}/${MAX_INVENTORY_SLOTS}) · ${state.silver} Bạc`,
      entityVisuals,
      roomVisualSummary: this.getRoomVisualSummary(state, entityVisuals),
      filterPrompt: state.pendingFilterChoice ? this.getFilterPrompt() : null,
      bossPrompt: state.pendingBossChoice ? this.getBossPrompt() : null,
      tribunalPrompt: state.pendingTribunalChoice ? this.getTribunalPrompt(state) : null,
      hubPrompt: state.activeHubNpcId !== null ? this.getHubPrompt(state) : null,
      ending: this.getEndingDisplay(
        state.endingId,
        state.filterChoice,
        state.imperialRecord,
        state.legalStatus,
      ),
      isRiposteReady: state.isRiposteReady,
      riposteLabel: `Phản Công +${riposteBonus}`,
      ...(codexEndingKey ? { codexEndingKey } : {}),
    };
  }

  private translateSingleEvent(
    event: GameEvent,
    mode: PerceptionMode,
    selectedRaceId: RaceId,
    filterChoice: FilterChoice,
  ): DisplayLogEntry | DisplayLogEntry[] | null {
    const hubMode: PerceptionMode =
      filterChoice === 'UNDECIDED' && mode === 'truth' ? 'illusion' : mode;

    switch (event.type) {
      case 'ROOM_CHANGED': {
        const roomName = this.getRoomName(event.toRoomId, hubMode);
        return {
          text: `Bước qua cánh cửa, tiến vào: ${roomName}.`,
          isGlitch: false,
          isTruth: false,
        };
      }

      case 'ROOM_AMBIENT_OBSERVED': {
        if (event.roomId === MARKET_STREET_ROOM_ID) {
          const text =
            'Dưới ánh đèn phố đều tăm tắp, thương buôn Nhân Loại và thợ rèn Người Lùn bày hàng dọc lối đi ngay dưới tầm mắt Tuần Vệ Bất Tử đứng gác đầu phố.';
          return {
            text,
            isGlitch: false,
            isTruth: true,
          };
        }

        if (event.roomId === PENAL_OUTPOST_ROOM_ID) {
          return buildLogEntry(
            hubMode,
            'Gió biên ải thổi qua dãy rào gỗ nơi đội lính Thú Nhân đang điểm danh phạm nhân khổ sai; ngay cạnh bốt gác là một Tuần Vệ mới bổ sung đứng bất động.',
            'Khói lạnh bốc lên quanh chuồng sắt nơi lũ cốt ma đang xua kẻ sống ra vùng đất chết.',
            '[KHÔI PHỤC MÀN CHE: Khói lạnh bốc lên quanh chuồng sắt nơi lũ cốt ma đang xua kẻ sống ra vùng đất chết.]',
          );
        }

        if (event.roomId === OUTER_SEWER_ROOM_ID) {
          return buildLogEntry(
            hubMode,
            'Mùi rêu ẩm bao trùm căn hầm đá khuất bóng Tuần Vệ; một góc bày hàng lậu của dân cống ngầm, góc đối diện là ánh đèn dầu mờ từ người của Thánh Viện.',
            'Trong căn hầm tránh mắt Quân đoàn Vong cốt, ngọn đèn dầu leo lét soi sáng kho tiếp tế cuối cùng của đội kháng chiến.',
            '[KHÔI PHỤC MÀN CHE: Trong căn hầm tránh mắt Quân đoàn Vong cốt, ngọn đèn dầu leo lét soi sáng kho tiếp tế cuối cùng của đội kháng chiến.]',
          );
        }

        if (event.roomId === INNER_COURT_ROOM_ID) {
          const truthText =
            event.checkpointResolution === 'BREACHED'
              ? 'Còi báo động vang dội khắp đại sảnh — Thư Lại Pháp Đình lùi gấp về sau cột đá khi Phán Quan Pháp Chế bước ra thi hành án.'
              : 'Giữa đại sảnh đá trang nghiêm, Thư Lại Pháp Đình bình thản lật sổ biên bản bên cạnh Phán Quan Pháp Chế đang chờ thẩm vấn.';
          return buildLogEntry(
            mode,
            truthText,
            'Giữa sảnh đá u tối, Tế Phẩm Xiềng Xích co rúm bên bệ máu trong lúc Đại Tư Tế Vong Cốt giương quyền trượng xương.',
            '[KHÔI PHỤC MÀN CHE: Giữa sảnh đá u tối, Tế Phẩm Xiềng Xích co rúm bên bệ máu trong lúc Đại Tư Tế Vong Cốt giương quyền trượng xương.]',
          );
        }

        return buildLogEntry(
          mode,
          'Phía trước kho quân nhu, Phu Chở Lương run rẩy lùi lại trong lúc Tuần Vệ Bảo Hộ bước lên chắn trước mặt công dân.',
          'Phía trước kho lương, Thây Ma Tải Xác rít lên giữa đống hàng trong lúc Đao Phủ Vong Cốt giơ cao lưỡi rìu.',
          '[KHÔI PHỤC MÀN CHE: Phía trước kho lương, Thây Ma Tải Xác rít lên giữa đống hàng trong lúc Đao Phủ Vong Cốt giơ cao lưỡi rìu.]',
        );
      }

      case 'GATE_LOCKED': {
        if (event.reason === 'TRIBUNAL_IN_SESSION') {
          return {
            text: 'Cổng sắt phía sau đã đóng chốt trong thời gian mở phiên thẩm vấn Pháp Đình.',
            isGlitch: false,
            isTruth: false,
            isWarning: true,
            noPrefix: true,
          };
        }

        if (event.reason === 'TRIBUNAL_CONCLUDED') {
          return {
            text: 'Cổng Tiền Sảnh Pháp Đình đã đóng chốt sau khi tuyên án — không được tự ý quay lại.',
            isGlitch: false,
            isTruth: false,
            isWarning: true,
            noPrefix: true,
          };
        }

        if (event.reason === 'CONVICT_BARRED') {
          return {
            text: 'Tuần vệ cổng Nội Thành chặn bước: Phạm nhân đang mang án khổ sai không được phép tiến vào Phố Giao Thương trước khi xóa án tích.',
            isGlitch: false,
            isTruth: false,
            isWarning: true,
            noPrefix: true,
          };
        }

        if (event.reason === 'OUTLAW_LOCKDOWN') {
          const entry = buildLogEntry(
            hubMode,
            'Lệnh truy nã tối cao đang phong tỏa lối lên mặt đất — bước ra khỏi Hầm Cống lúc này là tự nộp mạng cho Tuần vệ.',
            '[HỆ THỐNG]: Lối lên sào huyệt Nội thành đang bị Quân đoàn Vong cốt phong tỏa dày đặc — hãy di chuyển theo tuyến ngầm tới vùng biên!',
            '[KHÔI PHỤC MÀN CHE: Lối lên sào huyệt Nội thành đang bị Quân đoàn Vong cốt phong tỏa dày đặc — hãy di chuyển theo tuyến ngầm tới vùng biên!]',
          );
          if (hubMode === 'illusion') {
            entry.isSystem = true;
          } else if (hubMode === 'truth') {
            entry.isWarning = true;
            entry.noPrefix = true;
          }
          return entry;
        }

        if (event.reason === 'EXPEDITION_UNBRIEFED') {
          const entry = buildLogEntry(
            hubMode,
            'Chưa nhận ủy thác hay lệnh di chuyển ngoài thành — hãy nói chuyện với người phụ trách trong khu vực trước khi tiến ra Biên Trấn Bỏ Hoang.',
            '[HỆ THỐNG]: Chưa nhận chỉ thị nhiệm vụ tại căn hầm — hãy gặp Liên Lạc Viên Kháng Chiến hoặc Tay Buôn Hầm Ngầm trước khi xuất phát!',
            '[KHÔI PHỤC MÀN CHE: Chưa nhận chỉ thị nhiệm vụ tại căn hầm — hãy gặp Liên Lạc Viên Kháng Chiến hoặc Tay Buôn Hầm Ngầm trước khi xuất phát!]',
          );
          if (hubMode === 'illusion') {
            entry.isSystem = true;
          } else if (hubMode === 'truth') {
            entry.isWarning = true;
            entry.noPrefix = true;
          }
          return entry;
        }

        const entry = buildLogEntry(
          mode,
          'Cổng sắt Nội Thành đang khóa chốt pháp chế — phải trình diện hoặc vượt qua Đội Trưởng Kiểm Soát.',
          '[HỆ THỐNG]: Cổng Sào huyệt Nội thành đang bị phong ấn — hãy tiêu diệt Thống Lĩnh Vong Cốt!',
          '[KHÔI PHỤC MÀN CHE: Cổng Sào huyệt Nội thành đang bị phong ấn — hãy tiêu diệt Thống Lĩnh Vong Cốt!]',
        );
        if (mode === 'illusion') {
          entry.isSystem = true;
        }
        return entry;
      }

      case 'CHECKPOINT_BREACHED': {
        const entry = buildLogEntry(
          mode,
          'Đội Trưởng Kiểm Soát gục ngã — chốt cổng sắt phía Đông bung mở dẫn thẳng vào Tiền Sảnh Nội Thành!',
          '[HỆ THỐNG]: Thống Lĩnh Vong Cốt đã bị thanh tẩy — đường vào Sào huyệt Nội thành đã mở!',
          '[KHÔI PHỤC MÀN CHE: Thống Lĩnh Vong Cốt đã bị thanh tẩy — đường vào Sào huyệt Nội thành đã mở!]',
        );
        if (mode === 'illusion') {
          entry.isSystem = true;
        }
        return entry;
      }

      case 'CHECKPOINT_ESCORTED':
        return {
          text: 'Hai hàng Tuần vệ mở chốt cổng sắt, áp giải ngươi bước vào Tiền Sảnh Nội Thành để trình diện Phán Quan.',
          isGlitch: false,
          isTruth: true,
          noPrefix: true,
        };

      case 'TRIBUNAL_TRANSITIONED': {
        if (event.resolution === 'CITIZEN') {
          return {
            text: `Con dấu Pháp Đình đóng xuống trang giấy da. Đế luật cấp quy chế Công dân Dị giới cùng ${event.silverGranted} Bạc định cư — cổng Đông mở lối dẫn ngươi thẳng vào Phố Giao Thương Nội Thành.`,
            isGlitch: false,
            isTruth: true,
            noPrefix: true,
          };
        }

        if (event.resolution === 'ENVOY') {
          return {
            text: `Ánh sáng nguyên bản từ Lăng Kính Thực Tại khiến Phán Quan lập mật tấu khẩn gửi Thượng đỉnh. Đế luật cấp ${event.silverGranted} Bạc công phí Đặc sứ — mời ngươi tạm lưu chân tại Phố Giao Thương Nội Thành chờ phiên triệu kiến.`,
            isGlitch: false,
            isTruth: true,
            noPrefix: true,
          };
        }

        if (event.resolution === 'CONVICT') {
          return {
            text: `Bản án khổ sai biên trấn được đóng dấu xác nhận. Hai hàng Tuần vệ áp giải ngươi ra Trạm Biên Ải Khổ Sai kèm ${event.silverGranted} Bạc tiếp tế tối thiểu để bắt đầu hạn ngạch chuộc tội.`,
            isGlitch: false,
            isTruth: true,
            noPrefix: true,
          };
        }

        const escapeEntry = buildLogEntry(
          hubMode,
          `Phán Quan Pháp Chế gục ngã giữa hồi chuông giới nghiêm vang dội khắp Nội Thành. Giữa cơn hỗn loạn, ngươi vơ vội ${event.silverGranted} Bạc rồi lao qua lối cống vỡ bên hông sảnh, rơi thẳng xuống Hầm Cống Ngoại Vi.`,
          `[HỆ THỐNG]: Đại Tư Tế Vong Cốt đã bị thanh tẩy! Phát hiện Quân đoàn Vong cốt bao vây đại sảnh — thu hồi ${event.silverGranted} Bạc chiến lợi phẩm và rút gấp qua lối ngầm xuống Hầm Trú Ẩn Đội Kháng Chiến!`,
          `[KHÔI PHỤC MÀN CHE: Đại Tư Tế Vong Cốt đã bị thanh tẩy! Phát hiện Quân đoàn Vong cốt bao vây đại sảnh — thu hồi ${event.silverGranted} Bạc chiến lợi phẩm và rút gấp qua lối ngầm xuống Hầm Trú Ẩn Đội Kháng Chiến!]`,
        );
        if (hubMode === 'illusion') {
          escapeEntry.isSystem = true;
        } else if (hubMode === 'truth') {
          escapeEntry.noPrefix = true;
        }
        return escapeEntry;
      }

      case 'RELIC_ACTIVATED': {
        if (event.mode === 'KEEP') {
          if (event.targetId) {
            const target = ENTITY_CATALOG[event.targetId];
            const targetName = target
              ? mode === 'truth'
                ? target.truth.name
                : target.illusion.name
              : event.targetId;
            const damage = event.damage ?? 35;
            return {
              text: `[Trái Tim Chinh Phạt: Phóng xung kích gây ${damage} sát thương lên ${targetName}, hồi ${event.healAmount} HP!]`,
              isGlitch: false,
              isTruth: false,
              isSystem: true,
              noPrefix: true,
            };
          }

          return {
            text: `[Trái Tim Chinh Phạt: Hấp thụ xung kích, hồi ${event.healAmount} HP!]`,
            isGlitch: false,
            isTruth: false,
            isSystem: true,
            noPrefix: true,
          };
        }

        return {
          text: `[Lăng Kính Thực Tại: Kích hoạt Cộng Hưởng Thực Tại (+5 ATK, +15 Max HP, hồi ${event.healAmount} HP)!]`,
          isGlitch: false,
          isTruth: true,
          noPrefix: true,
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

      case 'INVENTORY_FULL': {
        const entry = buildLogEntry(
          hubMode,
          `Hành trang đã đầy (${event.maxSlots}/${event.maxSlots} ô) — không thể mang thêm vật phẩm.`,
          `[HỆ THỐNG]: Hành trang đã đạt giới hạn ${event.maxSlots}/${event.maxSlots} ô — hãy sử dụng bớt vật phẩm trước khi thu hồi.`,
          `[KHÔI PHỤC MÀN CHE: Hành trang đã đạt giới hạn ${event.maxSlots}/${event.maxSlots} ô — hãy sử dụng bớt vật phẩm trước khi thu hồi.]`,
        );
        if (hubMode === 'illusion') {
          entry.isSystem = true;
        } else if (hubMode === 'truth') {
          entry.isWarning = true;
          entry.noPrefix = true;
        }
        return entry;
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

      case 'HUB_RATION_BOUGHT': {
        const item = ITEM_CATALOG[event.itemId];
        if (!item) return null;
        return buildLogEntry(
          hubMode,
          `Mua ${item.truth.name} (-${event.cost} Bạc).`,
          `Đổi ${item.illusion.name} (-${event.cost} Bạc).`,
          `[KHÔI PHỤC MÀN CHE: Đổi ${item.illusion.name} (-${event.cost} Bạc).]`,
        );
      }

      case 'HUB_SUPPLY_CLAIMED': {
        const item = ITEM_CATALOG[event.itemId];
        if (!item) return null;
        return buildLogEntry(
          hubMode,
          `Nhận tiếp tế miễn phí: ${item.truth.name}.`,
          `Nhận tiếp tế kháng chiến: ${item.illusion.name}.`,
          `[KHÔI PHỤC MÀN CHE: Nhận tiếp tế kháng chiến: ${item.illusion.name}.]`,
        );
      }

      case 'HUB_RESTED':
        return buildLogEntry(
          hubMode,
          `Nghỉ chân hồi phục đầy ${event.maxHp} HP (-${event.cost} Bạc).`,
          `Tạm ẩn mình phục hồi đầy ${event.maxHp} HP (-${event.cost} Bạc).`,
          `[KHÔI PHỤC MÀN CHE: Tạm ẩn mình phục hồi đầy ${event.maxHp} HP (-${event.cost} Bạc).]`,
        );

      case 'EXPEDITION_DEPARTED': {
        const entry = buildLogEntry(
          hubMode,
          'Bước qua cổng Đông, rời khỏi vòng kiểm soát Nội Thành để tiến về Biên Trấn Bỏ Hoang.',
          '[HỆ THỐNG]: Rời khỏi hầm trú ẩn — bắt đầu chiến dịch thanh tẩy tại Biên Trấn Bỏ Hoang!',
          '[KHÔI PHỤC MÀN CHE: Rời khỏi hầm trú ẩn — bắt đầu chiến dịch thanh tẩy tại Biên Trấn Bỏ Hoang!]',
        );
        if (hubMode === 'illusion') {
          entry.isSystem = true;
        } else if (hubMode === 'truth') {
          entry.noPrefix = true;
        }
        return entry;
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

        if (entity.isHubNpc === true) {
          return this.translateHubNpcTalk(entity, event, selectedRaceId, filterChoice);
        }

        if (event.entityId === MAGISTRATE_ENTITY_ID) {
          return this.translateMagistrateTalk(entity, event, selectedRaceId);
        }

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

      case 'TRIBUNAL_CHOICE_REACHED':
        return {
          text: TRIBUNAL_PROMPT_TEXT.title,
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

      case 'OBJECT_INSPECTED':
      case 'RELIC_SHARD_GLITCHED':
      case 'NPC_ATTACKED_NPC':
      case 'RELIC_SHARD_SUBMITTED':
      case 'HUB_SERVICE_OPENED':
      case 'HUB_SERVICE_CLOSED':
      case 'GAME_ENDED':
      case 'PLAYER_MOVED':
        return null;
    }
  }

  private translateHubNpcTalk(
    entity: DualTextEntity,
    event: Extract<GameEvent, { type: 'NPC_TALKED' }>,
    selectedRaceId: RaceId,
    filterChoice: FilterChoice,
  ): DisplayLogEntry {
    if (filterChoice !== 'BREAK') {
      const formattedIllusion = formatDialogueSegment(entity.illusion.dialogue);
      return {
        text: `${entity.illusion.name}: ${formattedIllusion}`,
        isGlitch: false,
        isTruth: false,
        isTalk: true,
      };
    }

    const statusRaw = event.legalStatus
      ? entity.statusTalkDialogue?.[event.legalStatus]
      : undefined;
    const raceRaw = entity.raceTalkDialogue?.[event.raceId ?? selectedRaceId];
    const rawDialogue =
      statusRaw ?? raceRaw ?? entity.talkDialogue ?? entity.truth.dialogue;
    const formattedDialogue = formatDialogueSegment(rawDialogue);

    return {
      text: `${entity.truth.name}: ${formattedDialogue}`,
      isGlitch: false,
      isTruth: false,
      isTalk: true,
    };
  }

  private translateMagistrateTalk(
    entity: DualTextEntity,
    event: Extract<GameEvent, { type: 'NPC_TALKED' }>,
    selectedRaceId: RaceId,
  ): DisplayLogEntry {
    const record = event.imperialRecord ?? { guardsKilled: 0, civiliansKilled: 0 };
    const raceId = event.raceId ?? selectedRaceId;

    let primaryRaw: string;
    if (record.civiliansKilled > 0) {
      primaryRaw =
        entity.talkDialogueCiviliansKilled ??
        entity.talkDialogue ??
        entity.truth.dialogue;
    } else if (record.guardsKilled > 0) {
      primaryRaw =
        entity.talkDialogueGuardsKilled ??
        entity.talkDialogue ??
        entity.truth.dialogue;
    } else {
      primaryRaw =
        entity.raceTalkDialogue?.[raceId] ??
        entity.talkDialogue ??
        entity.truth.dialogue;
    }

    const formattedPrimary = formatDialogueSegment(primaryRaw);
    if (
      record.civiliansKilled === 0 &&
      event.hasBadge === true &&
      entity.talkDialogueWithBadge
    ) {
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
}
