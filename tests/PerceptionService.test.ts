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
    name: 'Phase 5 v0.3: Inventory effectiveHealAmount & (+10 Thích Nghi) description note for human vs non-human and non-healing items',
    run: () => {
      const itemIds = ['healing_tonic', 'warm_bread', 'patrol_badge'];

      const humanItems = ps.getDisplayInventory(itemIds, 10, 'UNDECIDED', 'human');
      assertEqual(humanItems[0].healAmount, 35, 'tonic base heal 35');
      assertEqual(humanItems[0].effectiveHealAmount, 45, 'human tonic effective heal 45');
      assert(
        humanItems[0].description.endsWith(' (+10 Thích Nghi)'),
        'human healing_tonic illusion description appends (+10 Thích Nghi)',
      );
      assert(
        humanItems[0].trueDescription.endsWith(' (+10 Thích Nghi)'),
        'human healing_tonic trueDescription appends (+10 Thích Nghi) for glitch flash',
      );
      assertEqual(humanItems[1].effectiveHealAmount, 35, 'human bread effective heal 35');
      assert(
        humanItems[1].description.endsWith(' (+10 Thích Nghi)'),
        'human warm_bread description appends (+10 Thích Nghi)',
      );
      assertEqual(humanItems[2].effectiveHealAmount, undefined, 'badge has no heal');
      assert(
        !humanItems[2].description.includes('Thích Nghi'),
        'non-healing patrol_badge must NOT append (+10 Thích Nghi)',
      );

      // Truth mode check for human
      const humanTruthItems = ps.getDisplayInventory(['healing_tonic'], 75, 'BREAK', 'human');
      assertEqual(
        humanTruthItems[0].description,
        'Bình dược tề tiêu chuẩn cấp phát cho Tuần vệ biên trấn. Hồi 35 HP. (+10 Thích Nghi)',
        'human truth description verbatim with (+10 Thích Nghi)',
      );

      // Non-human check
      const elfItems = ps.getDisplayInventory(itemIds, 10, 'UNDECIDED', 'dark_elf');
      assertEqual(elfItems[0].effectiveHealAmount, 35, 'dark_elf tonic effective heal 35');
      assert(
        !elfItems[0].description.includes('Thích Nghi'),
        'dark_elf must not append (+10 Thích Nghi)',
      );
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
      assert(
        packet.inventory[0].description.endsWith(' (+10 Thích Nghi)'),
        'buildDisplayPacket inventory includes (+10 Thích Nghi) for human',
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
    name: 'Phase 5 v0.3: BOSS_CHOICE_REACHED & Trait logs (combo_strike, first_strike +10, riposte_strike +10, iron_stance riposteArmed, and undying_frame + iron_stance)',
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

      // 2. combo_strike, first_strike (+10), and riposte_strike (+10) logs
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
            damage: 30,
            targetRemainingHp: 80,
            triggeredTraitId: 'first_strike',
            bonusDamage: 10,
          },
        ],
        75,
        'BREAK',
      );
      assertEqual(firstStrikeLogs.length, 2, 'first_strike emits attack + trait log');
      assertEqual(
        firstStrikeLogs[1].text,
        '[Nhát Chém Tiên Phong: +10 sát thương!]',
        'first_strike +10 verbatim',
      );

      const riposteLogs = ps.translateEvents(
        [
          {
            type: 'ATTACKED',
            attackerId: 'player',
            targetId: 'patrol_01',
            damage: 24,
            targetRemainingHp: 26,
            triggeredTraitId: 'riposte_strike',
            bonusDamage: 10,
          },
        ],
        40,
        'UNDECIDED',
      );
      assertEqual(riposteLogs.length, 2, 'riposte_strike emits attack + trait log');
      assertEqual(riposteLogs[0].isGlitch, true, 'attack entry glitches at lucidity 40');
      assertEqual(
        riposteLogs[1].text,
        '[Thế Phản Công: +10 sát thương!]',
        'riposte_strike verbatim per STYLE_GLOSSARY 5.3',
      );

      // 3. Combined undying_frame + iron_stance (riposteArmed === true & flatDamageReduced === 2)
      const combinedGuardLogs = ps.translateEvents(
        [
          {
            type: 'ENEMY_ATTACKED',
            attackerId: 'patrol_02',
            damage: 5,
            playerRemainingHp: 130,
            damageReduced: 9,
            flatDamageReduced: 2,
            riposteArmed: true,
            triggeredTraitId: 'iron_stance',
          },
        ],
        40,
        'UNDECIDED',
      );
      assertEqual(combinedGuardLogs.length, 2, 'guarded hit emits hit + iron_stance arming log');
      assertEqual(combinedGuardLogs[0].isGlitch, true, 'hit entry glitches at lucidity 40');
      assertEqual(
        combinedGuardLogs[0].trueText,
        '[Tuần Vệ Bảo Hộ tấn công, gây 5 sát thương! (-2 sát thương)]',
        'hit trueText preserves (-2 sát thương) even when paired with iron_stance',
      );
      assertEqual(
        combinedGuardLogs[0].fakeText,
        '[KHÔI PHỤC MÀN CHE: Đao Phủ Vong Cốt gây 5 sát thương! (-2 sát thương)]',
        'hit resolved glitch text preserves (-2 sát thương) without leaking truth name',
      );
      assertEqual(
        combinedGuardLogs[1].text,
        '[Thế Thủ Thép: Giảm nửa sát thương, nạp Thế Phản Công (+10 sát thương cho đòn đánh tới)!]',
        'iron_stance arming log verbatim per STYLE_GLOSSARY 5.3',
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
  {
    name: 'Phase 5 v0.3: ROOM_AMBIENT_OBSERVED translates across illusion, glitch (2700ms), and truth verbatim per STYLE_GLOSSARY 6.1',
    run: () => {
      const ambientEvent = {
        type: 'ROOM_AMBIENT_OBSERVED' as const,
        roomId: 'room_depot',
        position: { x: 1, y: 3 },
      };

      const expectedTruth =
        'Phía trước kho quân nhu, Phu Chở Lương run rẩy lùi lại trong lúc Tuần Vệ Bảo Hộ bước lên chắn trước mặt công dân.';
      const expectedIllusion =
        'Phía trước kho lương, Thây Ma Tải Xác rít lên giữa đống hàng trong lúc Đao Phủ Vong Cốt giơ cao lưỡi rìu.';
      const expectedGlitchSync =
        '[KHÔI PHỤC MÀN CHE: Phía trước kho lương, Thây Ma Tải Xác rít lên giữa đống hàng trong lúc Đao Phủ Vong Cốt giơ cao lưỡi rìu.]';

      const [illusionLog] = ps.translateEvents([ambientEvent], 15, 'UNDECIDED');
      assertEqual(illusionLog.isGlitch, false, 'illusion ambient is not glitch');
      assertEqual(illusionLog.isTruth, false, 'illusion ambient is not truth');
      assertEqual(illusionLog.text, expectedIllusion, 'illusion ambient verbatim');

      const [glitchLog] = ps.translateEvents([ambientEvent], 36, 'UNDECIDED');
      assertEqual(glitchLog.isGlitch, true, 'glitch ambient has isGlitch true');
      assertEqual(glitchLog.trueText, expectedTruth, 'glitch ambient flashes truth for 2700ms');
      assertEqual(glitchLog.fakeText, expectedGlitchSync, 'glitch ambient resolves to KHÔI PHỤC MÀN CHE');

      const [truthLog] = ps.translateEvents([ambientEvent], 75, 'BREAK');
      assertEqual(truthLog.isGlitch, false, 'truth ambient is not glitch');
      assertEqual(truthLog.isTruth, true, 'truth ambient isTruth true');
      assertEqual(truthLog.text, expectedTruth, 'truth ambient verbatim');
    },
  },
  {
    name: 'Phase 5 v0.3: undead_outsider BREAK unmasking log (STYLE_GLOSSARY 6.2), DisplayPacket.isRiposteReady & codexEndingKey, and getCodexDefinitions()',
    run: () => {
      // 1. undead_outsider BREAK emits 2 log lines in exact order; human/dark_elf emit 1; KEEP never leaks
      const undeadEngine = new GameEngine('undead_outsider', 'iron_vanguard');
      undeadEngine.debugAddLucidity(75);
      const breakEvents = undeadEngine.handleAction({ type: 'CHOOSE_FILTER', choice: 'BREAK' });
      const undeadPacket = ps.buildDisplayPacket(undeadEngine.getState(), breakEvents);
      assertEqual(undeadPacket.logs.length, 2, 'undead_outsider BREAK emits 2 log lines');
      assertEqual(
        undeadPacket.logs[0].text,
        'Ngươi xé toạc Màn Che. Mọi tiếng gầm khát máu tắt lịm — chỉ còn lại thế giới thật lạnh lẽo và trần trụi.',
        'first BREAK log line verbatim',
      );
      assertEqual(
        undeadPacket.logs[1].text,
        "Màn sương tan biến — thứ ẩn dưới lớp vỏ 'Khung Thể Dị Hình' không phải sinh vật sống, mà là thân xác lạnh ngắt của một Bất Tử Dị Giới.",
        'second undead_outsider unmasking log line verbatim per STYLE_GLOSSARY 6.2',
      );

      const humanBreakLogs = ps.translateEvents(
        [{ type: 'FILTER_CHOICE_MADE', choice: 'BREAK' }],
        75,
        'BREAK',
        'human',
      );
      assertEqual(humanBreakLogs.length, 1, 'human BREAK emits only 1 log line');

      const undeadKeepLogs = ps.translateEvents(
        [{ type: 'FILTER_CHOICE_MADE', choice: 'KEEP', appliedModifierId: 'summoner_blessing' }],
        75,
        'KEEP',
        'undead_outsider',
      );
      assertEqual(undeadKeepLogs.length, 1, 'undead_outsider KEEP emits 1 log line');
      assert(
        !JSON.stringify(undeadKeepLogs).includes('Bất Tử Dị Giới'),
        'KEEP must never leak Bất Tử Dị Giới',
      );

      // 2. DisplayPacket.isRiposteReady & codexEndingKey across all 3 endings
      const state = undeadEngine.getState();
      assertEqual(undeadPacket.isRiposteReady, false, 'isRiposteReady starts false');
      assertEqual(undeadPacket.codexEndingKey, undefined, 'codexEndingKey undefined before ending');

      state.isRiposteReady = true;
      assertEqual(ps.buildDisplayPacket(state, []).isRiposteReady, true, 'isRiposteReady reflects state');

      state.filterChoice = 'KEEP';
      state.endingId = 'SUMMONER_BLADE';
      assertEqual(
        ps.buildDisplayPacket(state, []).codexEndingKey,
        'SUMMONER_BLADE',
        'SUMMONER_BLADE + KEEP maps to SUMMONER_BLADE',
      );

      state.filterChoice = 'BREAK';
      state.endingId = 'SUMMONER_BLADE';
      assertEqual(
        ps.buildDisplayPacket(state, []).codexEndingKey,
        'RULE_BREAKER',
        'SUMMONER_BLADE + BREAK maps to RULE_BREAKER (Kẻ Phá Luật)',
      );

      state.filterChoice = 'BREAK';
      state.endingId = 'AWAKENED';
      assertEqual(
        ps.buildDisplayPacket(state, []).codexEndingKey,
        'AWAKENED',
        'AWAKENED maps to AWAKENED',
      );

      // 3. getCodexDefinitions() returns canonical 3 entries without spoiling locked label
      const defs = ps.getCodexDefinitions();
      assertEqual(defs.length, 3, '3 codex definitions');
      assertEqual(defs[0].key, 'SUMMONER_BLADE', 'codex 0 key');
      assertEqual(defs[0].title, 'Lưỡi Gươm Của Kẻ Triệu Hồi', 'codex 0 title');
      assertEqual(defs[1].key, 'RULE_BREAKER', 'codex 1 key');
      assertEqual(defs[1].title, 'Kẻ Phá Luật', 'codex 1 title');
      assertEqual(defs[2].key, 'AWAKENED', 'codex 2 key');
      assertEqual(defs[2].title, 'Người Xé Màn Sương', 'codex 2 title');
      assertEqual(defs[0].lockedLabel, '??? — Chưa mở khóa', 'lockedLabel verbatim');
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} PERCEPTION SERVICE TEST SUITES PASSED`);
