import { GameEngine } from '../src/core/GameEngine';
import {
  GLITCH_DURATION_MS,
  PerceptionService,
  getPerceptionMode,
  getVeilStatusLabel,
} from '../src/perception/PerceptionService';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
    );
  }
}

const ps = new PerceptionService();

const tests: Array<{ name: string; run: () => void }> = [
  {
    name: 'GLITCH_DURATION_MS is 2700ms and ATTACKED glitch text preserves damage value',
    run: () => {
      assertEqual(GLITCH_DURATION_MS, 2700, 'GLITCH_DURATION_MS must be 2700ms');

      const [entry] = ps.translateEvents(
        [
          {
            type: 'ATTACKED',
            attackerId: 'player',
            targetId: 'patrol_01',
            damage: 15,
            targetRemainingHp: 35,
          },
        ],
        45,
        'UNDECIDED',
      );
      assert(entry !== undefined, 'ATTACKED must translate to a log entry');
      assertEqual(entry.isGlitch, true, 'entry must be marked isGlitch at lucidity 45');
      assertEqual(entry.trueText, '[Gây 15 sát thương lên Tuần Vệ Ngoại Vi]', 'trueText check');
      assertEqual(
        entry.fakeText,
        '[KHÔI PHỤC MÀN CHE: Gây 15 sát thương lên Chiến Binh Vong Cốt]',
        'glitch fakeText must preserve damage number',
      );
    },
  },
  {
    name: 'Natural glitch warning fires when lucidity crosses >= 30 in gameplay and does not duplicate',
    run: () => {
      const engine = new GameEngine();
      const state = engine.getState();

      // Kill patrol_01 (+15 -> 15/100)
      const patrol1 = state.entities.find((e) => e.id === 'patrol_01')!;
      patrol1.hp = 15;
      patrol1.position = { x: 4, y: 3 };
      state.player.position = { x: 3, y: 3 };
      const killEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const killPacket = ps.buildDisplayPacket(state, killEvents);
      assertEqual(killPacket.mode, 'illusion', 'still illusion at 15');
      assert(
        !killPacket.logs.some((log) => log.isWarning),
        'no glitch warning at 15',
      );

      // Walk into room_depot (+15 -> 30/100) => natural glitch warning must emit automatically
      state.player.position = { x: 6, y: 3 };
      const depotEvents = engine.handleAction({ type: 'MOVE', direction: 'right' });
      const depotPacket = ps.buildDisplayPacket(state, depotEvents);
      assertEqual(depotPacket.mode, 'glitch', 'should enter glitch at 30');
      const warningLog = depotPacket.logs.find((log) => log.isWarning);
      assert(warningLog !== undefined, 'natural glitch warning must appear when crossing 30');
      assertEqual(
        warningLog?.text,
        '[CẢNH BÁO]: Phát hiện nhiễu Màn Che Nhận Thức... Đang hiệu chỉnh lại.',
        'natural glitch warning verbatim check',
      );

      // Further lucidity gain inside glitch (30 -> 45) must NOT re-emit warning
      const extraEvents = engine.debugAddLucidity(15);
      const extraPacket = ps.buildDisplayPacket(state, extraEvents);
      assert(
        !extraPacket.logs.some((log) => log.isWarning),
        'must not re-emit glitch warning once already >= 30',
      );
    },
  },
  {
    name: 'patrol_01 and captain_01 NPC_TALKED texts match STYLE_GLOSSARY without double quotes',
    run: () => {
      const [patrolTalk] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'patrol_01', hasBadge: false }],
        75,
        'BREAK',
      );
      assertEqual(
        patrolTalk.text,
        'Tuần Vệ Ngoại Vi: "Đứng yên tại chỗ. Màn sương trong mắt ngươi đã tan — hãy tiến về Trạm Kiểm Soát Nội Thành để chịu thẩm vấn theo Đế luật."',
        'patrol_01 talkDialogue verbatim',
      );

      const [captainNoBadge] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'captain_01', hasBadge: false }],
        75,
        'BREAK',
      );
      assert(!captainNoBadge.text.includes('""'), 'captain no badge must not have ""');

      const [captainWithBadge] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'captain_01', hasBadge: true }],
        75,
        'BREAK',
      );
      assert(!captainWithBadge.text.includes('""'), 'captain with badge must not have ""');
      assert(
        captainWithBadge.text.includes('Phù hiệu Trị an của đội giữ kho'),
        'captain with badge must use talkDialogueWithBadge',
      );
    },
  },
  {
    name: 'roomVisualSummary reflects only alive entities in the current room (Talkable & Boss legend)',
    run: () => {
      const engine = new GameEngine();
      let state = engine.getState();

      // Room 1 UNDECIDED: patrol_01 is regular entity
      let packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.roomVisualSummary.hasRegularEntity, true, 'Room 1 UNDECIDED has regular entity');
      assertEqual(packet.roomVisualSummary.hasPeacefulTalkable, false, 'Room 1 UNDECIDED has no talkable');
      assertEqual(packet.roomVisualSummary.hasHostileBoss, false, 'Room 1 UNDECIDED has no boss');

      // Room 1 BREAK with patrol_01 alive & unprovoked: talkable appears
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.roomVisualSummary.hasRegularEntity, false, 'Room 1 BREAK unprovoked has no red entity');
      assertEqual(packet.roomVisualSummary.hasPeacefulTalkable, true, 'Room 1 BREAK has talkable patrol_01');
      assertEqual(packet.roomVisualSummary.hasHostileBoss, false, 'Room 1 BREAK has no boss');

      // If patrol_01 is dead in Room 1, Room 1 legend must NOT show Giao tiếp (even though Room 2/3 have talkable NPCs)
      state.entities = state.entities.filter((e) => e.id !== 'patrol_01');
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(
        packet.roomVisualSummary.hasPeacefulTalkable,
        false,
        'empty Room 1 must not show talkable legend from other rooms',
      );

      // Room 3 KEEP: merchant_01 is regular entity, captain_01 is hostile Boss
      engine.reset();
      state = engine.getState();
      engine.debugAddLucidity(75);
      engine.handleAction({ type: 'CHOOSE_FILTER', choice: 'KEEP' });
      state.currentRoomId = 'room_checkpoint';
      state.player.roomId = 'room_checkpoint';
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.roomVisualSummary.hasRegularEntity, true, 'Room 3 KEEP has regular entity merchant_01');
      assertEqual(packet.roomVisualSummary.hasHostileBoss, true, 'Room 3 KEEP has hostile boss captain_01');
      assertEqual(packet.roomVisualSummary.hasPeacefulTalkable, false, 'Room 3 KEEP has no talkable');
    },
  },
  {
    name: 'Modes, Veil HUD labels, and all 3 Ending variants match Spec verbatim',
    run: () => {
      assertEqual(getPerceptionMode(100, 'KEEP'), 'illusion', 'KEEP forces illusion');
      assertEqual(getPerceptionMode(0, 'BREAK'), 'truth', 'BREAK forces truth');
      assertEqual(getVeilStatusLabel(15, 'UNDECIDED'), 'Ổn định', '0-29 label');
      assertEqual(getVeilStatusLabel(30, 'UNDECIDED'), 'Nhiễu', '30-69 label');
      assertEqual(getVeilStatusLabel(70, 'UNDECIDED'), 'Rạn vỡ', '70+ UNDECIDED label');
      assertEqual(getVeilStatusLabel(70, 'KEEP'), 'Đã khóa', 'KEEP label');
      assertEqual(getVeilStatusLabel(70, 'BREAK'), 'Đã xé', 'BREAK label');

      assertEqual(
        ps.getEndingDisplay('SUMMONER_BLADE', 'KEEP')?.title,
        'Kết cục 1: Lưỡi Gươm Của Kẻ Triệu Hồi',
        'Ending 1 KEEP title',
      );
      assertEqual(
        ps.getEndingDisplay('SUMMONER_BLADE', 'BREAK')?.title,
        'Kết cục 1 (Biến thể): Kẻ Phá Luật',
        'Ending 1 BREAK variant title',
      );
      assertEqual(
        ps.getEndingDisplay('AWAKENED', 'BREAK')?.title,
        'Kết cục 2: Người Xé Màn Sương',
        'Ending 2 AWAKENED title',
      );
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} PERCEPTION SERVICE TEST SUITES PASSED`);
