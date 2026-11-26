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

      const keepEnding = ps.getEndingDisplay('SUMMONER_BLADE', 'KEEP');
      assertEqual(
        keepEnding?.title,
        'Kết cục 1: Lưỡi Gươm Của Kẻ Triệu Hồi',
        'Ending 1 KEEP title',
      );
      assert(
        keepEnding?.body.startsWith(
          '‘Thống Lĩnh Vong Cốt’ — kẻ thực chất là Đội trưởng Kiểm soát — gục xuống dưới sức mạnh tàn bạo của Khế Ước Triệu Hồi.',
        ) === true,
        'Ending 1 KEEP body bridges illusion boss name to true identity',
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
  {
    name: 'Phase 4 Step 4A: getBuildOptions() exposes [HỆ THỐNG] labels/systemNote without leaking undead truth, and getBuildDisplayLabel() switches only on BREAK',
    run: () => {
      const options = ps.getBuildOptions();
      assertEqual(
        options.title,
        '[HỆ THỐNG] KHỞI TẠO HỒ SƠ TRIỆU HỒI',
        'build screen title verbatim',
      );
      assertEqual(options.raceGroupLabel, 'CHỦNG TỘC', 'race group label');
      assertEqual(options.classGroupLabel, 'LỚP NGHỀ', 'class group label');
      assertEqual(options.startButtonLabel, 'Khởi hành', 'start button label');
      assertEqual(options.baseMaxHp, 100, 'baseMaxHp from entities.json');
      assertEqual(options.baseAttack, 15, 'baseAttack from entities.json');
      assertEqual(options.races.length, 3, '3 race options');
      assertEqual(options.classes.length, 3, '3 class options');

      const undeadOpt = options.races.find((r) => r.id === 'undead_outsider')!;
      assertEqual(undeadOpt.displayName, 'Khung Thể Dị Hình', 'undead masked label');
      assertEqual(
        undeadOpt.systemHeader,
        '[HỆ THỐNG]: Khung Thể Dị Hình',
        'undead systemHeader',
      );
      assertEqual(
        undeadOpt.systemNote,
        '[CẢNH BÁO ĐỒNG BỘ]: Tín hiệu thể chất bất thường — kháng sát thương vật lý cao.',
        'undead systemNote verbatim',
      );
      assert(
        !JSON.stringify(undeadOpt).includes('Bất Tử Dị Giới'),
        'build options must never leak Bất Tử Dị Giới before BREAK',
      );

      // HUD build label across states
      const engine = new GameEngine('undead_outsider', 'iron_vanguard');
      const state = engine.getState();
      assertEqual(
        ps.getBuildDisplayLabel(state),
        'Khung Thể Dị Hình · Thiết Vệ',
        '0 lucidity UNDECIDED uses systemLabel',
      );
      state.lucidity = 45;
      assertEqual(
        ps.getBuildDisplayLabel(state),
        'Khung Thể Dị Hình · Thiết Vệ',
        'glitch UNDECIDED still uses systemLabel',
      );
      state.lucidity = 70;
      assertEqual(
        ps.getBuildDisplayLabel(state),
        'Khung Thể Dị Hình · Thiết Vệ',
        '70 lucidity UNDECIDED before BREAK still uses systemLabel',
      );
      state.filterChoice = 'KEEP';
      assertEqual(
        ps.getBuildDisplayLabel(state),
        'Khung Thể Dị Hình · Thiết Vệ',
        'KEEP keeps masked systemLabel',
      );
      state.filterChoice = 'BREAK';
      assertEqual(
        ps.getBuildDisplayLabel(state),
        'Bất Tử Dị Giới · Thiết Vệ',
        'BREAK reveals true race name Bất Tử Dị Giới',
      );
    },
  },
  {
    name: 'Phase 4 Step 4A: Inventory effectiveHealAmount reflects human adaptability (+10) vs dark_elf (+0) and leaves non-healing items undefined',
    run: () => {
      const itemIds = ['healing_tonic', 'warm_bread', 'patrol_badge'];

      const humanItems = ps.getDisplayInventory(itemIds, 10, 'UNDECIDED', 'human');
      assertEqual(humanItems[0].healAmount, 35, 'tonic base heal 35');
      assertEqual(humanItems[0].effectiveHealAmount, 45, 'human tonic effective heal 45');
      assertEqual(humanItems[1].effectiveHealAmount, 35, 'human bread effective heal 35');
      assertEqual(humanItems[2].effectiveHealAmount, undefined, 'badge has no heal');

      const elfItems = ps.getDisplayInventory(itemIds, 10, 'UNDECIDED', 'dark_elf');
      assertEqual(elfItems[0].effectiveHealAmount, 35, 'dark_elf tonic effective heal 35');
      assertEqual(elfItems[1].effectiveHealAmount, 25, 'dark_elf bread effective heal 25');
      assertEqual(elfItems[2].effectiveHealAmount, undefined, 'badge has no heal');

      // Also verify buildDisplayPacket wires state.selectedRaceId automatically
      const engine = new GameEngine('human', 'brawler');
      engine.getState().inventory.push('warm_bread');
      const packet = ps.buildDisplayPacket(engine.getState(), []);
      assertEqual(
        packet.inventory[0].effectiveHealAmount,
        35,
        'buildDisplayPacket passes selectedRaceId to inventory',
      );
    },
  },
  {
    name: 'Phase 4 Step 4A: captain_01 NPC_TALKED translates all 3 raceTalkDialogue variants and appends talkDialogueWithBadge cleanly without double quotes',
    run: () => {
      const expectations: Array<{
        raceId: 'human' | 'dark_elf' | 'undead_outsider';
        snippet: string;
      }> = [
        { raceId: 'human', snippet: 'Nhân loại dị giới, ánh mắt vừa mới tỉnh lại sao?' },
        { raceId: 'dark_elf', snippet: 'Hắc Tinh Linh... huyết mạch nhạy bén hiếm thấy' },
        {
          raceId: 'undead_outsider',
          snippet: 'hơi thở của một Bất Tử Giả không thuộc biên chế Đế Quốc',
        },
      ];

      for (const { raceId, snippet } of expectations) {
        const [noBadge] = ps.translateEvents(
          [{ type: 'NPC_TALKED', entityId: 'captain_01', hasBadge: false, raceId }],
          75,
          'BREAK',
        );
        assert(noBadge.text.includes(snippet), `${raceId} without badge includes race dialogue`);
        assert(
          !noBadge.text.includes('Phù hiệu Trị an của đội giữ kho'),
          `${raceId} without badge omits badge line`,
        );
        assert(!noBadge.text.includes('""'), `${raceId} without badge has no ""`);

        const [withBadge] = ps.translateEvents(
          [{ type: 'NPC_TALKED', entityId: 'captain_01', hasBadge: true, raceId }],
          75,
          'BREAK',
        );
        assert(withBadge.text.includes(snippet), `${raceId} with badge keeps race dialogue`);
        assert(
          withBadge.text.includes(
            'Phù hiệu Trị an của đội giữ kho... Sống hay chết, để thượng cấp định đoạt.',
          ),
          `${raceId} with badge appends standalone badge follow-up`,
        );
        assert(!withBadge.text.includes('""'), `${raceId} with badge has no ""`);
      }
    },
  },
  {
    name: 'Phase 4 Step 4A: BOSS_CHOICE_REACHED prompt & Trait logs (combo_strike, first_strike, undying_frame, and glitch-safe iron_stance at lucidity 40)',
    run: () => {
      // 1. BOSS_CHOICE_REACHED log & bossPrompt in DisplayPacket
      const [bossChoiceLog] = ps.translateEvents(
        [{ type: 'BOSS_CHOICE_REACHED', entityId: 'captain_01' }],
        75,
        'BREAK',
      );
      assertEqual(
        bossChoiceLog.text,
        'Đội Trưởng Kiểm Soát đang chờ ngươi hạ tay. Ngươi sẽ làm gì?',
        'BOSS_CHOICE_REACHED prompt verbatim',
      );

      const engine = new GameEngine();
      engine.getState().pendingBossChoice = true;
      const packet = ps.buildDisplayPacket(engine.getState(), []);
      assertEqual(packet.bossPrompt?.surrenderLabel, 'Hạ tay chịu áp giải', 'surrender button label');
      assertEqual(
        packet.bossPrompt?.surrenderNote,
        'Chấp nhận đình chiến · Tiến vào Nội Thành',
        'surrender button note omits spoiler (Kết cục 2)',
      );
      assertEqual(packet.bossPrompt?.fightLabel, 'Ra đòn mở đường', 'fight button label');

      // 2. combo_strike & first_strike logs
      const comboLogs = ps.translateEvents(
        [
          {
            type: 'ATTACKED',
            attackerId: 'player',
            targetId: 'patrol_01',
            damage: 22,
            targetRemainingHp: 28,
            triggeredTraitId: 'combo_strike',
            bonusDamage: 6,
          },
        ],
        10,
        'UNDECIDED',
      );
      assertEqual(comboLogs.length, 2, 'combo_strike emits attack + trait log');
      assertEqual(comboLogs[1].text, '[Liên Hoàn Quyền: +6 sát thương!]', 'combo_strike verbatim');

      const firstStrikeLogs = ps.translateEvents(
        [
          {
            type: 'ATTACKED',
            attackerId: 'player',
            targetId: 'captain_01',
            damage: 28,
            targetRemainingHp: 82,
            triggeredTraitId: 'first_strike',
            bonusDamage: 8,
          },
        ],
        75,
        'BREAK',
      );
      assertEqual(firstStrikeLogs.length, 2, 'first_strike emits attack + trait log');
      assertEqual(
        firstStrikeLogs[1].text,
        '[Nhát Chém Tiên Phong: +8 sát thương!]',
        'first_strike verbatim',
      );

      // 3. iron_stance counter log MUST go through buildLogEntry and glitch properly at lucidity 40
      const ironGlitchLogs = ps.translateEvents(
        [
          {
            type: 'ENEMY_ATTACKED',
            attackerId: 'patrol_01',
            damage: 6,
            playerRemainingHp: 109,
            damageReduced: 6,
            counterDamage: 6,
            triggeredTraitId: 'iron_stance',
          },
        ],
        40,
        'UNDECIDED',
      );
      assertEqual(ironGlitchLogs.length, 2, 'iron_stance emits hit + counter log');
      const counterLog = ironGlitchLogs[1];
      assertEqual(counterLog.isGlitch, true, 'iron_stance counter log glitches at lucidity 40');
      assertEqual(
        counterLog.trueText,
        '[Thế Thủ Thép: Giảm nửa sát thương, phản lại 6 sát thương lên Tuần Vệ Ngoại Vi!]',
        'glitch trueText flashes truth name briefly',
      );
      assert(
        counterLog.fakeText?.includes('Chiến Binh Vong Cốt') === true &&
          !counterLog.text.includes('Tuần Vệ Ngoại Vi'),
        'resolved text restores illusion name without leaking truth name',
      );

      // 4. undying_frame compact reduction note
      const [undyingLog] = ps.translateEvents(
        [
          {
            type: 'ENEMY_ATTACKED',
            attackerId: 'patrol_01',
            damage: 10,
            playerRemainingHp: 110,
            damageReduced: 2,
            triggeredTraitId: 'undying_frame',
          },
        ],
        10,
        'UNDECIDED',
      );
      assert(
        undyingLog.text.includes('(-2 sát thương)'),
        'undying_frame includes compact (-2 sát thương) note',
      );
    },
  },
  {
    name: 'Phase 4 Step 4A: inspectEntity() across Ổn định, Nhiễu (glitch), KEEP, and BREAK (!provoked vs provoked)',
    run: () => {
      const engine = new GameEngine();
      const state = engine.getState();

      // 1. Ổn định (0-29, UNDECIDED): courier_01 must still show Thù địch (no civilian leak!)
      state.lucidity = 10;
      state.filterChoice = 'UNDECIDED';
      const stableInspect = ps.inspectEntity(state, 'courier_01')!;
      assertEqual(stableInspect.displayName, 'Thây Ma Tải Xác', 'illusion name at 10');
      assertEqual(stableInspect.hp, 45, 'courier hp 45');
      assertEqual(stableInspect.maxHp, 45, 'courier maxHp 45');
      assertEqual(stableInspect.attack, 0, 'courier attack 0');
      assertEqual(stableInspect.statusLabel, 'Thù địch', 'must not leak peaceful label before BREAK');
      assertEqual(stableInspect.isPeacefulTalkable, false, 'not talkable before BREAK');
      assertEqual(stableInspect.isGlitching, false, 'not glitching at 10');
      assertEqual(stableInspect.glitchTruthName, undefined, 'no glitchTruthName at 10');

      // 2. Nhiễu (30-69, UNDECIDED): isGlitching === true with glitchTruthName
      state.lucidity = 45;
      const glitchInspect = ps.inspectEntity(state, 'courier_01')!;
      assertEqual(glitchInspect.displayName, 'Thây Ma Tải Xác', 'resolved displayName is illusion');
      assertEqual(glitchInspect.isGlitching, true, 'isGlitching true at 45 UNDECIDED');
      assertEqual(glitchInspect.glitchTruthName, 'Phu Chở Lương', 'glitchTruthName exposed for 2700ms flash');
      assertEqual(glitchInspect.statusLabel, 'Thù địch', 'still Thù địch during glitch');
      assertEqual(glitchInspect.isPeacefulTalkable, false, 'still not talkable during glitch');

      // 3. KEEP: locked illusion, no glitch
      state.lucidity = 70;
      state.filterChoice = 'KEEP';
      const keepInspect = ps.inspectEntity(state, 'courier_01')!;
      assertEqual(keepInspect.displayName, 'Thây Ma Tải Xác', 'KEEP locks illusion name');
      assertEqual(keepInspect.isGlitching, false, 'no glitch in KEEP');
      assertEqual(keepInspect.statusLabel, 'Thù địch', 'Thù địch in KEEP');

      // 4. BREAK unprovoked vs provoked
      state.filterChoice = 'BREAK';
      const breakPeaceful = ps.inspectEntity(state, 'courier_01')!;
      assertEqual(breakPeaceful.displayName, 'Phu Chở Lương', 'BREAK shows truth name');
      assertEqual(
        breakPeaceful.statusLabel,
        'Hòa bình — Tiếp cận để giao tiếp',
        'unprovoked BREAK shows peaceful talk label',
      );
      assertEqual(breakPeaceful.isPeacefulTalkable, true, 'isPeacefulTalkable true');
      assertEqual(breakPeaceful.isGlitching, false, 'no glitch in BREAK');

      const courier = state.entities.find((e) => e.id === 'courier_01')!;
      courier.provoked = true;
      const breakProvoked = ps.inspectEntity(state, 'courier_01')!;
      assertEqual(breakProvoked.displayName, 'Phu Chở Lương', 'still truth name when provoked');
      assertEqual(breakProvoked.statusLabel, 'Thù địch', 'provoked BREAK switches to Thù địch');
      assertEqual(breakProvoked.isPeacefulTalkable, false, 'not talkable when provoked');

      // 5. Dead or unknown entity returns null
      courier.hp = 0;
      assertEqual(ps.inspectEntity(state, 'courier_01'), null, 'dead entity returns null');
      assertEqual(ps.inspectEntity(state, 'non_existent'), null, 'unknown entity returns null');
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} PERCEPTION SERVICE TEST SUITES PASSED`);
