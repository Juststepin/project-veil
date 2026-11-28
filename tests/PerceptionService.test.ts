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
    name: 'Modes, Veil HUD labels, and all 4 v0.5.0 Ending variants (+ AWAKENED Chuộc Tội) match STYLE_GLOSSARY 8.5 verbatim',
    run: () => {
      assertEqual(getPerceptionMode(100, 'KEEP'), 'illusion', 'KEEP forces illusion');
      assertEqual(getPerceptionMode(0, 'BREAK'), 'truth', 'BREAK forces truth');
      assertEqual(getVeilStatusLabel(15, 'UNDECIDED'), 'Ổn định', '0-29 label');
      assertEqual(getVeilStatusLabel(30, 'UNDECIDED'), 'Nhiễu', '30-69 label');
      assertEqual(getVeilStatusLabel(70, 'UNDECIDED'), 'Rạn vỡ', '70+ UNDECIDED label');
      assertEqual(getVeilStatusLabel(70, 'KEEP'), 'Đã khóa', 'KEEP label');
      assertEqual(getVeilStatusLabel(70, 'BREAK'), 'Đã xé', 'BREAK label');

      const keepEnding = ps.getEndingDisplay(
        'SUMMONER_BLADE',
        'KEEP',
        { guardsKilled: 2, civiliansKilled: 0 },
        'OUTLAW',
      );
      assertEqual(
        keepEnding?.title,
        'Kết cục 1: Lưỡi Gươm Của Kẻ Triệu Hồi',
        'Ending 1 KEEP title',
      );
      assertEqual(
        keepEnding?.body,
        'Với bọc tiếp tế từ Liên Lạc Viên Kháng Chiến trong tay, ngươi rời khỏi căn hầm ẩm lạnh để tiến thẳng về Biên Trấn Bỏ Hoang. Trước mắt ngươi chỉ có mệnh lệnh thanh tẩy Mảnh Đá Tà Khí từ Hệ thống — còn phía sau lưng, bàn tay thật sự giật dây Màn Che vẫn lặng lẽ dõi theo bước chân của lưỡi gươm mù quáng.',
        'Ending 1 KEEP body verbatim per STYLE_GLOSSARY 8.5',
      );

      const ruleBreakerEnding = ps.getEndingDisplay(
        'SUMMONER_BLADE',
        'BREAK',
        { guardsKilled: 1, civiliansKilled: 0 },
        'OUTLAW',
      );
      assertEqual(
        ruleBreakerEnding?.title,
        'Kết cục 2: Kẻ Phá Luật',
        'Ending 2 RULE_BREAKER title',
      );
      assertEqual(
        ruleBreakerEnding?.body,
        'Rũ bỏ cả mệnh lệnh của Thánh Viện lẫn bóng ma Đế luật trên mặt đất, ngươi trang bị gọn ghẽ từ chợ đen cống ngầm rồi lẩn qua cửa Đông hướng về Biên Trấn Bỏ Hoang. Không ai bảo hộ, cũng chẳng ai sai khiến — giữa vùng phế tích bị bỏ quên hai trăm năm trước, ngươi tự tìm lấy con đường sinh tồn của riêng mình.',
        'Ending 2 RULE_BREAKER body verbatim per STYLE_GLOSSARY 8.5',
      );

      const awakenedClean = ps.getEndingDisplay(
        'AWAKENED',
        'BREAK',
        { guardsKilled: 2, civiliansKilled: 0 },
        'CITIZEN',
      );
      assertEqual(
        awakenedClean?.title,
        'Kết cục 3: Người Xé Màn Sương',
        'Ending 3 AWAKENED title',
      );
      assertEqual(
        awakenedClean?.body,
        'Rời khỏi dãy phố sáng đèn và lò rèn đỏ lửa của Nội Thành, ngươi mang theo khẩu phần quân nhu bước qua cổng Đông tiến ra Biên Trấn Bỏ Hoang. Dưới bầu trời tĩnh lặng ngoài tầm bảo hộ của Tuần vệ, chuyến viễn chinh đầu tiên của một công dân dị giới chính thức bắt đầu.',
        'Ending 3 AWAKENED CITIZEN body verbatim per STYLE_GLOSSARY 8.5',
      );

      const awakenedPenal = ps.getEndingDisplay(
        'AWAKENED',
        'BREAK',
        { guardsKilled: 0, civiliansKilled: 1 },
        'CONVICT',
      );
      assertEqual(
        awakenedPenal?.title,
        'Kết cục 3: Người Xé Màn Sương',
        'Ending 3 AWAKENED penal title',
      );
      assertEqual(
        awakenedPenal?.body,
        'Cầm theo khẩu phần biên ải dưới ánh mắt dò xét của Đội Trưởng Thú Nhân, ngươi bước qua rào gỗ Trạm Biên Ải tiến thẳng về bãi đá Biên Trấn Bỏ Hoang. Giữa món nợ máu với Đế luật và những kẻ đào tẩu cùng đường ngoài kia, chuyến đi chuộc tội của ngươi chỉ vừa mở màn.',
        'Ending 3 AWAKENED CONVICT body verbatim per STYLE_GLOSSARY 8.5',
      );

      // Backward-compatible fallback when legalStatus is omitted but civiliansKilled > 0
      const awakenedPenalFallback = ps.getEndingDisplay('AWAKENED', 'BREAK', {
        guardsKilled: 0,
        civiliansKilled: 1,
      });
      assertEqual(
        awakenedPenalFallback?.body,
        awakenedPenal?.body,
        'AWAKENED fallback still uses CONVICT body when civiliansKilled > 0',
      );

      const pactEnding = ps.getEndingDisplay(
        'SOVEREIGN_PACT',
        'BREAK',
        { guardsKilled: 0, civiliansKilled: 0 },
        'ENVOY',
      );
      assertEqual(
        pactEnding?.title,
        'Kết cục 4: Khế Ước Ngang Hàng',
        'Ending 4 SOVEREIGN_PACT title',
      );
      assertEqual(
        pactEnding?.body,
        'Lăng Kính Thực Tại vẫn nằm nguyên vẹn trong hành trang. Sau khi chuẩn bị đầy đủ tại Phố Giao Thương theo diện Đặc sứ, ngươi bước qua cổng Đông tiến về Biên Trấn Bỏ Hoang để trực tiếp kiểm chứng di sản của chu kỳ hai trăm năm trước — sẵn sàng mang về quân bài nặng ký nhất cho phiên đàm phán sắp tới với Thượng đỉnh Đế Quốc.',
        'Ending 4 SOVEREIGN_PACT body verbatim per STYLE_GLOSSARY 8.5',
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
      const breadItem = packet.inventory.find((i) => i.id === 'warm_bread')!;
      assertEqual(
        breadItem.effectiveHealAmount,
        35,
        'buildDisplayPacket passes selectedRaceId to inventory',
      );
      assert(
        breadItem.description.endsWith(' (+10 Thích Nghi)'),
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

      state.filterChoice = 'BREAK';
      state.endingId = 'SOVEREIGN_PACT';
      assertEqual(
        ps.buildDisplayPacket(state, []).codexEndingKey,
        'SOVEREIGN_PACT',
        'SOVEREIGN_PACT maps to SOVEREIGN_PACT',
      );

      // 3. getCodexDefinitions() returns canonical 4 entries without spoiling locked label
      const defs = ps.getCodexDefinitions();
      assertEqual(defs.length, 4, '4 codex definitions');
      assertEqual(defs[0].key, 'SUMMONER_BLADE', 'codex 0 key');
      assertEqual(defs[0].title, 'Lưỡi Gươm Của Kẻ Triệu Hồi', 'codex 0 title');
      assertEqual(defs[1].key, 'RULE_BREAKER', 'codex 1 key');
      assertEqual(defs[1].title, 'Kẻ Phá Luật', 'codex 1 title');
      assertEqual(defs[2].key, 'AWAKENED', 'codex 2 key');
      assertEqual(defs[2].title, 'Người Xé Màn Sương', 'codex 2 title');
      assertEqual(defs[3].key, 'SOVEREIGN_PACT', 'codex 3 key');
      assertEqual(defs[3].title, 'Khế Ước Ngang Hàng', 'codex 3 title');
      for (const def of defs) {
        assertEqual(def.lockedLabel, '??? — Chưa mở khóa', `${def.key} lockedLabel never spoils`);
      }
    },
  },
  {
    name: 'Phase 6 v0.4: world_relic 3-state DisplayItem (UNDECIDED dormant + 2700ms glitch + 70-UNDECIDED truth guard, KEEP, BREAK, no Thích Nghi) & imperial_salve',
    run: () => {
      // 1. UNDECIDED at 0-29: dormant illusion, canUse false, actionLabel 'Chưa thức tỉnh', NO (+10 Thích Nghi)
      const [dormantStable] = ps.getDisplayInventory(['world_relic'], 10, 'UNDECIDED', 'human');
      assertEqual(dormantStable.name, 'Lõi Thánh Vật Ngủ Yên', 'dormant illusion name');
      assertEqual(
        dormantStable.description,
        'Báu Vật Thế Giới đi cùng ngươi qua khe nứt triệu hồi. Đang ngủ yên — chỉ thức tỉnh khi Màn Che định hình.',
        'dormant illusion description verbatim',
      );
      assertEqual(dormantStable.canUse, false, 'dormant relic cannot be used');
      assertEqual(dormantStable.actionLabel, 'Chưa thức tỉnh', 'dormant actionLabel');
      assertEqual(dormantStable.isGlitch, false, 'not glitching at lucidity 10');
      assertEqual(dormantStable.isTruth, false, 'not truth when UNDECIDED');
      assert(!dormantStable.description.includes('Thích Nghi'), 'no Thích Nghi on world_relic');

      // 2. UNDECIDED at 30-69 (glitch): flashes Lăng Kính Thực Tại dormant truth for 2700ms, still canUse false
      const [dormantGlitch] = ps.getDisplayInventory(['world_relic'], 45, 'UNDECIDED', 'human');
      assertEqual(dormantGlitch.name, 'Lõi Thánh Vật Ngủ Yên', 'settled glitch name stays dormant');
      assertEqual(dormantGlitch.isGlitch, true, 'isGlitch true at 45 UNDECIDED');
      assertEqual(dormantGlitch.trueName, 'Lăng Kính Thực Tại', 'flashes Lăng Kính Thực Tại');
      assertEqual(
        dormantGlitch.trueDescription,
        'Báu Vật Thế Giới bị Thánh Viện gắn khóa bóp méo nhận thức người mang...',
        'flashes dormant truth description verbatim',
      );
      assertEqual(dormantGlitch.canUse, false, 'glitch dormant still cannot be used');
      assertEqual(dormantGlitch.actionLabel, 'Chưa thức tỉnh', 'glitch dormant actionLabel');

      // 3. UNDECIDED at 70 (before choosing KEEP/BREAK): must NOT leak awakened truth!
      const [dormantAtThreshold] = ps.getDisplayInventory(['world_relic'], 70, 'UNDECIDED', 'human');
      assertEqual(
        dormantAtThreshold.name,
        'Lõi Thánh Vật Ngủ Yên',
        'at 70 UNDECIDED before BREAK, world_relic stays dormant',
      );
      assertEqual(dormantAtThreshold.isTruth, false, 'never leaks isTruth before BREAK');
      assertEqual(dormantAtThreshold.canUse, false, 'cannot use before choosing KEEP/BREAK');

      // 4. KEEP: Trái Tim Chinh Phạt, canUse true, exact actionLabel, no Thích Nghi
      const [keepRelic] = ps.getDisplayInventory(['world_relic'], 70, 'KEEP', 'human');
      assertEqual(keepRelic.name, 'Trái Tim Chinh Phạt', 'KEEP relic name');
      assertEqual(
        keepRelic.description,
        'Báu Vật Thế Giới hòa làm một với Khế Ước Triệu Hồi. Kích hoạt phóng xung kích gây 35 sát thương lên kẻ địch gần nhất trong phòng và hồi 20 HP.',
        'KEEP relic description verbatim',
      );
      assertEqual(keepRelic.canUse, true, 'KEEP relic canUse true');
      assertEqual(
        keepRelic.actionLabel,
        'Kích hoạt (35 sát thương & +20 HP · 1 lượt)',
        'KEEP relic actionLabel verbatim',
      );
      assertEqual(keepRelic.isTruth, false, 'KEEP relic isTruth false');
      assert(!keepRelic.description.includes('Thích Nghi'), 'no Thích Nghi on KEEP relic');

      // 5. BREAK: Lăng Kính Thực Tại, canUse true, exact actionLabel, no Thích Nghi
      const [breakRelic] = ps.getDisplayInventory(['world_relic'], 70, 'BREAK', 'human');
      assertEqual(breakRelic.name, 'Lăng Kính Thực Tại', 'BREAK relic name');
      assertEqual(
        breakRelic.description,
        'Báu Vật Thế Giới đã rũ bỏ khóa nhận thức của Thánh Viện. Dùng để kích hoạt Cộng Hưởng Thực Tại (+5 ATK, +15 Max HP, hồi 30 HP) hoặc giữ nguyên vẹn làm vật chứng trước Pháp Đình.',
        'BREAK relic description verbatim',
      );
      assertEqual(breakRelic.canUse, true, 'BREAK relic canUse true');
      assertEqual(
        breakRelic.actionLabel,
        'Kích hoạt (+5 ATK, +15 Max HP, hồi 30 HP · 1 lượt)',
        'BREAK relic actionLabel verbatim',
      );
      assertEqual(breakRelic.isTruth, true, 'BREAK relic isTruth true');
      assert(!breakRelic.description.includes('Thích Nghi'), 'no Thích Nghi on BREAK relic');

      // 6. imperial_salve gets +10 Thích Nghi for human (55 HP) and 45 HP for non-human
      const [humanSalve] = ps.getDisplayInventory(['imperial_salve'], 75, 'BREAK', 'human');
      assertEqual(humanSalve.name, 'Cao Dưỡng Thương Quân Vụ', 'imperial_salve truth name');
      assertEqual(humanSalve.effectiveHealAmount, 55, 'human imperial_salve effective 55 HP');
      assert(humanSalve.description.endsWith(' (+10 Thích Nghi)'), 'human salve appends Thích Nghi');
      assertEqual(
        humanSalve.actionLabel,
        'Sử dụng (+55 HP · 1 lượt)',
        'human salve actionLabel',
      );
    },
  },
  {
    name: 'Phase 6 v0.4: GATE_LOCKED, CHECKPOINT_BREACHED, CHECKPOINT_ESCORTED, RELIC_ACTIVATED, and Room 4 ROOM_AMBIENT_OBSERVED match STYLE_GLOSSARY 7.2 & 7.3 verbatim',
    run: () => {
      // 1. GATE_LOCKED
      const [sealedIllusion] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_checkpoint', reason: 'CHECKPOINT_SEALED' }],
        70,
        'KEEP',
      );
      assertEqual(
        sealedIllusion.text,
        '[HỆ THỐNG]: Cổng Sào huyệt Nội thành đang bị phong ấn — hãy tiêu diệt Thống Lĩnh Vong Cốt!',
        'GATE_LOCKED CHECKPOINT_SEALED illusion verbatim',
      );

      const [sealedTruth] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_checkpoint', reason: 'CHECKPOINT_SEALED' }],
        75,
        'BREAK',
      );
      assertEqual(
        sealedTruth.text,
        'Cổng sắt Nội Thành đang khóa chốt pháp chế — phải trình diện hoặc vượt qua Đội Trưởng Kiểm Soát.',
        'GATE_LOCKED CHECKPOINT_SEALED truth verbatim',
      );

      const [tribunalGate] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_inner_court', reason: 'TRIBUNAL_IN_SESSION' }],
        75,
        'BREAK',
      );
      assertEqual(
        tribunalGate.text,
        'Cổng sắt phía sau đã đóng chốt trong thời gian mở phiên thẩm vấn Pháp Đình.',
        'GATE_LOCKED TRIBUNAL_IN_SESSION verbatim',
      );

      // 2. CHECKPOINT_BREACHED & CHECKPOINT_ESCORTED
      const [breachIllusion] = ps.translateEvents([{ type: 'CHECKPOINT_BREACHED' }], 70, 'KEEP');
      assertEqual(
        breachIllusion.text,
        '[HỆ THỐNG]: Thống Lĩnh Vong Cốt đã bị thanh tẩy — đường vào Sào huyệt Nội thành đã mở!',
        'CHECKPOINT_BREACHED illusion verbatim',
      );
      const [breachTruth] = ps.translateEvents([{ type: 'CHECKPOINT_BREACHED' }], 75, 'BREAK');
      assertEqual(
        breachTruth.text,
        'Đội Trưởng Kiểm Soát gục ngã — chốt cổng sắt phía Đông bung mở dẫn thẳng vào Tiền Sảnh Nội Thành!',
        'CHECKPOINT_BREACHED truth verbatim',
      );
      const [escortedLog] = ps.translateEvents(
        [{ type: 'CHECKPOINT_ESCORTED', toRoomId: 'room_inner_court', to: { x: 1, y: 3 } }],
        75,
        'BREAK',
      );
      assertEqual(
        escortedLog.text,
        'Hai hàng Tuần vệ mở chốt cổng sắt, áp giải ngươi bước vào Tiền Sảnh Nội Thành để trình diện Phán Quan.',
        'CHECKPOINT_ESCORTED verbatim',
      );

      // 3. RELIC_ACTIVATED (KEEP target, KEEP empty, BREAK)
      const [keepTargetLog] = ps.translateEvents(
        [
          {
            type: 'RELIC_ACTIVATED',
            mode: 'KEEP',
            healAmount: 20,
            targetId: 'magistrate_01',
            damage: 35,
            targetPosition: { x: 6, y: 3 },
          },
        ],
        70,
        'KEEP',
      );
      assertEqual(
        keepTargetLog.text,
        '[Trái Tim Chinh Phạt: Phóng xung kích gây 35 sát thương lên Đại Tư Tế Vong Cốt, hồi 20 HP!]',
        'RELIC_ACTIVATED KEEP with target verbatim',
      );

      const [keepEmptyLog] = ps.translateEvents(
        [{ type: 'RELIC_ACTIVATED', mode: 'KEEP', healAmount: 20 }],
        70,
        'KEEP',
      );
      assertEqual(
        keepEmptyLog.text,
        '[Trái Tim Chinh Phạt: Hấp thụ xung kích, hồi 20 HP!]',
        'RELIC_ACTIVATED KEEP empty room verbatim',
      );

      const [breakRelicLog] = ps.translateEvents(
        [
          {
            type: 'RELIC_ACTIVATED',
            mode: 'BREAK',
            healAmount: 30,
            appliedModifierId: 'relic_clarity',
          },
        ],
        75,
        'BREAK',
      );
      assertEqual(
        breakRelicLog.text,
        '[Lăng Kính Thực Tại: Kích hoạt Cộng Hưởng Thực Tại (+5 ATK, +15 Max HP, hồi 30 HP)!]',
        'RELIC_ACTIVATED BREAK verbatim',
      );

      // 4. Room 4 ROOM_AMBIENT_OBSERVED (ESCORTED truth vs BREACHED truth vs KEEP illusion vs glitch)
      const [courtEscorted] = ps.translateEvents(
        [
          {
            type: 'ROOM_AMBIENT_OBSERVED',
            roomId: 'room_inner_court',
            position: { x: 1, y: 3 },
            checkpointResolution: 'ESCORTED',
          },
        ],
        75,
        'BREAK',
      );
      assertEqual(
        courtEscorted.text,
        'Giữa đại sảnh đá trang nghiêm, Thư Lại Pháp Đình bình thản lật sổ biên bản bên cạnh Phán Quan Pháp Chế đang chờ thẩm vấn.',
        'Room 4 ESCORTED ambient verbatim',
      );

      const [courtBreached] = ps.translateEvents(
        [
          {
            type: 'ROOM_AMBIENT_OBSERVED',
            roomId: 'room_inner_court',
            position: { x: 1, y: 3 },
            checkpointResolution: 'BREACHED',
          },
        ],
        75,
        'BREAK',
      );
      assertEqual(
        courtBreached.text,
        'Còi báo động vang dội khắp đại sảnh — Thư Lại Pháp Đình lùi gấp về sau cột đá khi Phán Quan Pháp Chế bước ra thi hành án.',
        'Room 4 BREACHED truth ambient verbatim',
      );

      const [courtKeep] = ps.translateEvents(
        [
          {
            type: 'ROOM_AMBIENT_OBSERVED',
            roomId: 'room_inner_court',
            position: { x: 1, y: 3 },
            checkpointResolution: 'BREACHED',
          },
        ],
        70,
        'KEEP',
      );
      assertEqual(
        courtKeep.text,
        'Giữa sảnh đá u tối, Tế Phẩm Xiềng Xích co rúm bên bệ máu trong lúc Đại Tư Tế Vong Cốt giương quyền trượng xương.',
        'Room 4 KEEP illusion ambient verbatim',
      );

      const [courtGlitch] = ps.translateEvents(
        [
          {
            type: 'ROOM_AMBIENT_OBSERVED',
            roomId: 'room_inner_court',
            position: { x: 1, y: 3 },
            checkpointResolution: 'ESCORTED',
          },
        ],
        45,
        'UNDECIDED',
      );
      assertEqual(courtGlitch.isGlitch, true, 'Room 4 glitch ambient sets isGlitch');
      assertEqual(
        courtGlitch.fakeText,
        '[KHÔI PHỤC MÀN CHE: Giữa sảnh đá u tối, Tế Phẩm Xiềng Xích co rúm bên bệ máu trong lúc Đại Tư Tế Vong Cốt giương quyền trượng xương.]',
        'Room 4 glitch resolved text verbatim',
      );
    },
  },
  {
    name: 'Phase 6 v0.4: magistrate_01 & scribe_01 dialogues by imperialRecord/raceId/hasBadge, dynamic tribunalPrompt, and Room 4 Boss visuals',
    run: () => {
      // 1. scribe_01 peaceful talk
      const [scribeTalk] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'scribe_01', hasBadge: false }],
        75,
        'BREAK',
      );
      assertEqual(
        scribeTalk.text,
        'Thư Lại Pháp Đình: "Lữ khách đứng nghiêm trước bục xét xử nhé. Ngài Phán Quan trông lạnh lùng vậy thôi, chứ Ngài chỉ chiếu đúng sổ sách Đế luật — tay không vấy máu dân lành thì chẳng ai bị xử oan đâu."',
        'scribe_01 talkDialogue verbatim',
      );

      // 2. magistrate_01 Case 1: civiliansKilled > 0 (even with badge, badge line MUST be omitted!)
      const [magCivilianBlood] = ps.translateEvents(
        [
          {
            type: 'NPC_TALKED',
            entityId: 'magistrate_01',
            hasBadge: true,
            raceId: 'human',
            imperialRecord: { guardsKilled: 1, civiliansKilled: 1 },
          },
        ],
        75,
        'BREAK',
      );
      assertEqual(
        magCivilianBlood.text,
        'Phán Quan Pháp Chế: "Ta đã đọc biên bản từ trạm ngoài, kẻ dị giới. Dù bị Thánh Viện che mắt, tay ngươi đã vấy máu công dân nộp thuế của Đế Quốc. Đế luật không xóa trắng nợ máu dân thường — hoặc chịu án khổ sai biên trấn để chuộc tội, hoặc nhận án trảm tại đây."',
        'magistrate_01 civiliansKilled > 0 verbatim & omits badge line',
      );

      // 3. magistrate_01 Case 2: spotless 0/0 across all 3 races (+ badge check)
      const raceSnippets: Array<{
        raceId: 'human' | 'dark_elf' | 'undead_outsider';
        expected: string;
      }> = [
        {
          raceId: 'human',
          expected:
            'Phán Quan Pháp Chế: "Ba trạm biên giới không đổ một giọt máu. Một Nhân loại dị giới giữ được lý trí tỉnh táo trước thuật thao túng của Thánh Viện là điều hiếm gặp. Đế luật ghi nhận thiện chí của ngươi."',
        },
        {
          raceId: 'dark_elf',
          expected:
            'Phán Quan Pháp Chế: "Ba trạm biên giới không đổ một giọt máu. Đôi mắt Hắc Tinh Linh đã nhìn thấu màn sương dối trá của Thánh Viện sớm hơn dự liệu của ta. Đế luật ghi nhận sự minh mẫn của ngươi."',
        },
        {
          raceId: 'undead_outsider',
          expected:
            'Phán Quan Pháp Chế: "Ba trạm biên giới không đổ một giọt máu. Một Bất Tử Giả ngoại biên tự bẻ gãy xiềng nhận thức của Thánh Viện mà không làm tổn hại một ai — hồ sơ của ngươi xứng đáng đặt thẳng lên bàn Thượng cấp."',
        },
      ];
      for (const { raceId, expected } of raceSnippets) {
        const [cleanTalk] = ps.translateEvents(
          [
            {
              type: 'NPC_TALKED',
              entityId: 'magistrate_01',
              hasBadge: false,
              raceId,
              imperialRecord: { guardsKilled: 0, civiliansKilled: 0 },
            },
          ],
          75,
          'BREAK',
        );
        assertEqual(cleanTalk.text, expected, `magistrate_01 0/0 ${raceId} verbatim`);
      }

      // 4. magistrate_01 Case 3: civiliansKilled === 0 && guardsKilled > 0 + patrol_badge follow-up
      const [magSelfDefenseWithBadge] = ps.translateEvents(
        [
          {
            type: 'NPC_TALKED',
            entityId: 'magistrate_01',
            hasBadge: true,
            raceId: 'human',
            imperialRecord: { guardsKilled: 2, civiliansKilled: 0 },
          },
        ],
        75,
        'BREAK',
      );
      assertEqual(
        magSelfDefenseWithBadge.text,
        'Phán Quan Pháp Chế: "Biên bản ghi nhận Tuần vệ biên trấn ngã xuống lúc ngươi còn chìm trong thuật che mắt, nhưng ngươi đã kịp dừng tay trước công dân Đế Quốc. Chiếu theo tiền lệ triệu hồi hai trăm năm, ta miễn án tử cho ngươi."\n"Phù hiệu Trị an ngươi giữ từ kho quân nhu đã được xác nhận — giao lại cho Thư Lại lưu kho Pháp Đình."',
        'magistrate_01 guardsKilled > 0 + badge follow-up verbatim without double quotes',
      );

      // 5. TRIBUNAL_CHOICE_REACHED & dynamic tribunalPrompt + Room 4 Boss visuals
      const [tribunalReachedLog] = ps.translateEvents(
        [{ type: 'TRIBUNAL_CHOICE_REACHED', entityId: 'magistrate_01' }],
        75,
        'BREAK',
      );
      assertEqual(
        tribunalReachedLog.text,
        'Phán Quan Pháp Chế đang chờ lời đáp cuối cùng trước Pháp Đình:',
        'TRIBUNAL_CHOICE_REACHED title verbatim',
      );

      const engine = new GameEngine('human', 'brawler');
      const state = engine.getState();
      state.currentRoomId = 'room_inner_court';
      state.player.roomId = 'room_inner_court';
      state.filterChoice = 'BREAK';
      state.checkpointResolution = 'ESCORTED';
      state.pendingTribunalChoice = true;

      // Clean record + intact world_relic -> 3 options (Residency, Present Relic, Defy)
      let packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.tribunalPrompt?.options.length, 3, '3 tribunal options when clean + relic');
      assertEqual(
        packet.tribunalPrompt?.options[0].label,
        'Tiếp nhận Quy chế Cư trú',
        'clean option 0 label',
      );
      assertEqual(
        packet.tribunalPrompt?.options[1].choice,
        'PRESENT_RELIC',
        'option 1 is PRESENT_RELIC',
      );
      assertEqual(
        packet.tribunalPrompt?.options[1].label,
        'Trình Lăng Kính Thực Tại',
        'PRESENT_RELIC label verbatim',
      );
      assertEqual(
        packet.tribunalPrompt?.options[2].label,
        'Kháng án mở đường máu',
        'DEFY_TRIBUNAL label verbatim',
      );
      assertEqual(
        packet.roomVisualSummary.hasPeacefulTalkable,
        true,
        'Room 4 ESCORTED shows peaceful talkable legend',
      );
      assertEqual(
        packet.roomVisualSummary.hasHostileBoss,
        false,
        'Room 4 ESCORTED unprovoked hides hostile boss legend',
      );

      // Consumed world_relic -> hides PRESENT_RELIC (2 options), keeps Residency label
      state.inventory = [];
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.tribunalPrompt?.options.length, 2, '2 options when world_relic consumed');
      assertEqual(
        packet.tribunalPrompt?.options[0].label,
        'Tiếp nhận Quy chế Cư trú',
        'clean without relic still offers Residency',
      );

      // civiliansKilled > 0 (even with world_relic back) -> 2 options & switches to Penal servitude label!
      state.inventory = ['world_relic'];
      state.imperialRecord.civiliansKilled = 1;
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.tribunalPrompt?.options.length, 2, '2 options when civiliansKilled > 0');
      assertEqual(
        packet.tribunalPrompt?.options[0].label,
        'Chấp nhận Án Khổ Sai',
        'penal label verbatim when civiliansKilled > 0',
      );
      assertEqual(
        packet.tribunalPrompt?.options[0].note,
        'Gánh án chuộc tội tại biên trấn theo Đế luật',
        'penal note verbatim',
      );

      // Room 4 BREACHED -> magistrate_01 becomes Hostile Boss
      state.checkpointResolution = 'BREACHED';
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(
        packet.entityVisuals.magistrate_01.isHostileBoss,
        true,
        'magistrate_01 isHostileBoss when BREACHED',
      );
      assertEqual(
        packet.roomVisualSummary.hasHostileBoss,
        true,
        'Room 4 BREACHED shows Boss legend',
      );
    },
  },
  {
    name: 'Phase 7A v0.5.0: Dual Hub room names, ROOM_CHANGED without pre-BREAK leak, and Hub ROOM_AMBIENT_OBSERVED match STYLE_GLOSSARY 8.1 verbatim',
    run: () => {
      // 1. Direct getRoomName across modes
      assertEqual(
        ps.getRoomName('room_market_street', 'truth'),
        'Phố Giao Thương Nội Thành',
        'market street truth name',
      );
      assertEqual(
        ps.getRoomName('room_penal_outpost', 'truth'),
        'Trạm Biên Ải Khổ Sai',
        'penal outpost truth name',
      );
      assertEqual(
        ps.getRoomName('room_penal_outpost', 'illusion'),
        'Trại Giam Nô Lệ Cốt Ma',
        'penal outpost illusion name',
      );
      assertEqual(
        ps.getRoomName('room_outer_sewer', 'truth'),
        'Hầm Cống Ngoại Vi',
        'outer sewer truth name',
      );
      assertEqual(
        ps.getRoomName('room_outer_sewer', 'illusion'),
        'Hầm Trú Ẩn Đội Kháng Chiến',
        'outer sewer illusion name',
      );

      // 2. DisplayPacket.roomName & ROOM_CHANGED honor filterChoice (no leak at 70-UNDECIDED!)
      const engine = new GameEngine('human', 'brawler');
      const state = engine.getState();
      state.currentRoomId = 'room_outer_sewer';
      state.player.roomId = 'room_outer_sewer';
      state.lucidity = 70;
      state.filterChoice = 'KEEP';
      assertEqual(
        ps.buildDisplayPacket(state, []).roomName,
        'Hầm Trú Ẩn Đội Kháng Chiến',
        'KEEP roomName for outer sewer uses illusion',
      );
      state.filterChoice = 'UNDECIDED';
      assertEqual(
        ps.buildDisplayPacket(state, []).roomName,
        'Hầm Trú Ẩn Đội Kháng Chiến',
        '70-UNDECIDED roomName must NOT leak truth Hub name before BREAK',
      );
      state.filterChoice = 'BREAK';
      assertEqual(
        ps.buildDisplayPacket(state, []).roomName,
        'Hầm Cống Ngoại Vi',
        'BREAK roomName for outer sewer uses truth',
      );

      const [sewerMoveKeep] = ps.translateEvents(
        [
          {
            type: 'ROOM_CHANGED',
            fromRoomId: 'room_inner_court',
            toRoomId: 'room_outer_sewer',
            to: { x: 1, y: 3 },
          },
        ],
        70,
        'KEEP',
      );
      assertEqual(
        sewerMoveKeep.text,
        'Bước qua cánh cửa, tiến vào: Hầm Trú Ẩn Đội Kháng Chiến.',
        'ROOM_CHANGED KEEP uses illusion Hub room name',
      );
      const [sewerMoveBreak] = ps.translateEvents(
        [
          {
            type: 'ROOM_CHANGED',
            fromRoomId: 'room_inner_court',
            toRoomId: 'room_outer_sewer',
            to: { x: 1, y: 3 },
          },
        ],
        75,
        'BREAK',
      );
      assertEqual(
        sewerMoveBreak.text,
        'Bước qua cánh cửa, tiến vào: Hầm Cống Ngoại Vi.',
        'ROOM_CHANGED BREAK uses truth Hub room name',
      );

      // 3. Hub ROOM_AMBIENT_OBSERVED verbatim (market, penal truth/illusion/glitch, sewer truth/illusion/glitch)
      const [marketAmbient] = ps.translateEvents(
        [{ type: 'ROOM_AMBIENT_OBSERVED', roomId: 'room_market_street', position: { x: 1, y: 3 } }],
        75,
        'BREAK',
      );
      assertEqual(
        marketAmbient.text,
        'Dưới ánh đèn phố đều tăm tắp, thương buôn Nhân Loại và thợ rèn Người Lùn bày hàng dọc lối đi ngay dưới tầm mắt Tuần Vệ Bất Tử đứng gác đầu phố.',
        'room_market_street ambient verbatim',
      );

      const [penalTruth] = ps.translateEvents(
        [{ type: 'ROOM_AMBIENT_OBSERVED', roomId: 'room_penal_outpost', position: { x: 1, y: 3 } }],
        75,
        'BREAK',
      );
      assertEqual(
        penalTruth.text,
        'Gió biên ải thổi qua dãy rào gỗ nơi đội lính Thú Nhân đang điểm danh phạm nhân khổ sai; ngay cạnh bốt gác là một Tuần Vệ mới bổ sung đứng bất động.',
        'room_penal_outpost truth ambient verbatim',
      );

      const [penalIllusion] = ps.translateEvents(
        [{ type: 'ROOM_AMBIENT_OBSERVED', roomId: 'room_penal_outpost', position: { x: 1, y: 3 } }],
        70,
        'KEEP',
      );
      assertEqual(
        penalIllusion.text,
        'Khói lạnh bốc lên quanh chuồng sắt nơi lũ cốt ma đang xua kẻ sống ra vùng đất chết.',
        'room_penal_outpost illusion ambient verbatim',
      );

      const [penalGlitch] = ps.translateEvents(
        [{ type: 'ROOM_AMBIENT_OBSERVED', roomId: 'room_penal_outpost', position: { x: 1, y: 3 } }],
        45,
        'UNDECIDED',
      );
      assertEqual(penalGlitch.isGlitch, true, 'penal glitch sets isGlitch');
      assertEqual(
        penalGlitch.fakeText,
        '[KHÔI PHỤC MÀN CHE: Khói lạnh bốc lên quanh chuồng sắt nơi lũ cốt ma đang xua kẻ sống ra vùng đất chết.]',
        'penal glitch resolved text verbatim',
      );

      const [sewerTruth] = ps.translateEvents(
        [{ type: 'ROOM_AMBIENT_OBSERVED', roomId: 'room_outer_sewer', position: { x: 1, y: 3 } }],
        75,
        'BREAK',
      );
      assertEqual(
        sewerTruth.text,
        'Mùi rêu ẩm bao trùm căn hầm đá khuất bóng Tuần Vệ; một góc bày hàng lậu của dân cống ngầm, góc đối diện là ánh đèn dầu mờ từ người của Thánh Viện.',
        'room_outer_sewer truth ambient verbatim',
      );

      const [sewerIllusion] = ps.translateEvents(
        [{ type: 'ROOM_AMBIENT_OBSERVED', roomId: 'room_outer_sewer', position: { x: 1, y: 3 } }],
        70,
        'KEEP',
      );
      assertEqual(
        sewerIllusion.text,
        'Trong căn hầm tránh mắt Quân đoàn Vong cốt, ngọn đèn dầu leo lét soi sáng kho tiếp tế cuối cùng của đội kháng chiến.',
        'room_outer_sewer illusion ambient verbatim',
      );
      assert(
        !sewerIllusion.text.includes('Thánh Viện'),
        'room_outer_sewer illusion ambient never leaks Thánh Viện',
      );

      const [sewerGlitch] = ps.translateEvents(
        [{ type: 'ROOM_AMBIENT_OBSERVED', roomId: 'room_outer_sewer', position: { x: 1, y: 3 } }],
        45,
        'UNDECIDED',
      );
      assertEqual(sewerGlitch.isGlitch, true, 'sewer glitch sets isGlitch');
      assertEqual(
        sewerGlitch.fakeText,
        '[KHÔI PHỤC MÀN CHE: Trong căn hầm tránh mắt Quân đoàn Vong cốt, ngọn đèn dầu leo lét soi sáng kho tiếp tế cuối cùng của đội kháng chiến.]',
        'sewer glitch resolved text verbatim',
      );
    },
  },
  {
    name: 'Phase 7A v0.5.0: Hub NPC visuals, zero Thánh Viện leak in KEEP/70-UNDECIDED, and all 6 Hub NPC dialogues (including Tier 6 Chúng ta/Ta & undead_outsider)',
    run: () => {
      const engine = new GameEngine('human', 'brawler');
      const state = engine.getState();
      state.currentRoomId = 'room_outer_sewer';
      state.player.roomId = 'room_outer_sewer';
      state.lucidity = 70;
      state.filterChoice = 'KEEP';

      // 1. Even in KEEP, Hub NPCs are peaceful talkable (teal [...]) and NEVER leak Thánh Viện
      const keepPacket = ps.buildDisplayPacket(state, []);
      assertEqual(
        keepPacket.entityVisuals.sanctum_agent_01.isPeacefulTalkable,
        true,
        'sanctum_agent_01 isPeacefulTalkable true in KEEP',
      );
      assertEqual(
        keepPacket.entityVisuals.sewer_broker_01.isPeacefulTalkable,
        true,
        'sewer_broker_01 isPeacefulTalkable true in KEEP',
      );
      assertEqual(
        keepPacket.roomVisualSummary.hasPeacefulTalkable,
        true,
        'outer sewer KEEP shows peaceful talkable legend',
      );
      assertEqual(
        keepPacket.roomVisualSummary.hasRegularEntity,
        false,
        'outer sewer KEEP has no hostile red entities',
      );

      const sanctumKeepInspect = ps.inspectEntity(state, 'sanctum_agent_01')!;
      assertEqual(
        sanctumKeepInspect.displayName,
        'Liên Lạc Viên Kháng Chiến',
        'sanctum_agent_01 KEEP inspect shows illusion name',
      );
      assertEqual(
        sanctumKeepInspect.statusLabel,
        'Hòa bình — Tiếp cận để giao tiếp',
        'sanctum_agent_01 KEEP inspect shows peaceful talk label',
      );
      assert(
        !JSON.stringify(sanctumKeepInspect).includes('Thánh Viện'),
        'sanctum_agent_01 KEEP inspect never leaks Thánh Viện',
      );

      // 70-UNDECIDED guard
      state.filterChoice = 'UNDECIDED';
      const sanctumThresholdInspect = ps.inspectEntity(state, 'sanctum_agent_01')!;
      assertEqual(
        sanctumThresholdInspect.displayName,
        'Liên Lạc Viên Kháng Chiến',
        'sanctum_agent_01 70-UNDECIDED inspect never leaks Thánh Viện before BREAK',
      );

      // BREAK reveals Phái Viên Ngầm Thánh Viện
      state.filterChoice = 'BREAK';
      const sanctumBreakInspect = ps.inspectEntity(state, 'sanctum_agent_01')!;
      assertEqual(
        sanctumBreakInspect.displayName,
        'Phái Viên Ngầm Thánh Viện',
        'sanctum_agent_01 BREAK inspect reveals truth name',
      );

      // 2. All 6 Hub NPC dialogues verbatim per STYLE_GLOSSARY 8.2
      const [smithCitizen] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'dwarf_smith_01', hasBadge: false, legalStatus: 'CITIZEN' }],
        75,
        'BREAK',
      );
      assertEqual(
        smithCitizen.text,
        'Thợ Rèn Trưởng Người Lùn: "Tôi không rảnh bàn chuyện ai ngồi trên ngai, lữ khách. Còn các ngài Tuần vệ giữ yên đường buôn thì lò rèn của tôi còn đỏ lửa — ngoài Biên Trấn Bỏ Hoang hay vướng mảnh tinh thể lạ làm loạn mắt lính gác, khuân về được thì tôi trả bạc sòng phẳng."',
        'dwarf_smith_01 CITIZEN dialogue verbatim',
      );

      const [smithEnvoy] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'dwarf_smith_01', hasBadge: false, legalStatus: 'ENVOY' }],
        75,
        'BREAK',
      );
      assertEqual(
        smithEnvoy.text,
        'Thợ Rèn Trưởng Người Lùn: "Mật thư Thượng đỉnh đã nhắn Đặc sứ tạm lưu chân phố chợ chờ triệu kiến ở Công Đường. Cần lương thảo hay nghỉ sức trước khi ra Biên Trấn Bỏ Hoang thu hồi mảnh tinh thể rạn, tôi phục vụ đúng giá."',
        'dwarf_smith_01 ENVOY dialogue verbatim',
      );

      const [guardCitizen] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'market_guard_01', hasBadge: false, legalStatus: 'CITIZEN' }],
        75,
        'BREAK',
      );
      assert(
        guardCitizen.text.startsWith('Tuần Vệ Đầu Phố: "Khu phố giao thương thuộc diện bảo hộ cấp một.'),
        'market_guard_01 CITIZEN dialogue',
      );

      const [guardEnvoy] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'market_guard_01', hasBadge: false, legalStatus: 'ENVOY' }],
        75,
        'BREAK',
      );
      assertEqual(
        guardEnvoy.text,
        'Tuần Vệ Đầu Phố: "Quy chế Đặc sứ đã được xác nhận. Phố giao thương an toàn — mật lệnh Thượng đỉnh sẽ chuyển tới khi Công Đường mở phiên."',
        'market_guard_01 ENVOY dialogue verbatim',
      );

      const [wardenConvict] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'beast_warden_01', hasBadge: false, legalStatus: 'CONVICT' }],
        75,
        'BREAK',
      );
      assertEqual(
        wardenConvict.text,
        'Đội Trưởng Biên Ải Thú Nhân: "Đừng nhìn cái cùm sắt rồi trách Đế luật, phạm nhân. Trước thời các ngài Bất tử, đám quý tộc nhân loại treo đầu tộc tôi ngoài cổng thành còn chẳng cần mở phiên xử — cầm khẩu phần rồi ra Biên Trấn Bỏ Hoang dọn bọn đào tẩu, thu mảnh dị vật về là đủ hạn ngạch xóa án."',
        'beast_warden_01 CONVICT dialogue verbatim',
      );

      const [wardenCitizen] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'beast_warden_01', hasBadge: false, legalStatus: 'CITIZEN' }],
        75,
        'BREAK',
      );
      assertEqual(
        wardenCitizen.text,
        'Đội Trưởng Biên Ải Thú Nhân: "Lữ khách xuống tận trạm biên ải làm gì? Muốn mua khẩu phần hay ra Biên Trấn Bỏ Hoang dọn mảnh dị vật gây nhiễu thì cứ qua cổng Đông — tôi ghi sổ công vụ sòng phẳng."',
        'beast_warden_01 CITIZEN dialogue verbatim',
      );

      const [penalGuardBreak] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'penal_guard_01', hasBadge: false, legalStatus: 'CONVICT' }],
        75,
        'BREAK',
      );
      assertEqual(
        penalGuardBreak.text,
        'Tuần Vệ Tân Tuyển: "Biên chế biên trấn đang thi hành nhiệm vụ. Tuân thủ điều lệnh của Đội Trưởng Biên Ải — không được vượt rào khi chưa có lệnh."',
        'penal_guard_01 BREAK dialogue verbatim',
      );

      const [brokerBreak] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'sewer_broker_01', hasBadge: false, legalStatus: 'OUTLAW' }],
        75,
        'BREAK',
      );
      assert(
        brokerBreak.text.startsWith('Kẻ Môi Giới Cống Ngầm: "Tôi không hỏi lữ khách giết ai trên kia'),
        'sewer_broker_01 BREAK dialogue',
      );

      const [brokerKeep] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'sewer_broker_01', hasBadge: false, legalStatus: 'OUTLAW' }],
        70,
        'KEEP',
      );
      assertEqual(
        brokerKeep.text,
        'Tay Buôn Hầm Ngầm: "Tôi chỉ buôn lương khô và chỗ ngả lưng tránh mắt Quân đoàn Vong cốt, lữ khách. Có bạc thì đổi đồ, còn muốn nhận lệnh thanh tẩy hay nộp Mảnh Đá Tà Khí thì sang góc kia gặp Liên Lạc Viên Kháng Chiến."',
        'sewer_broker_01 KEEP dialogue verbatim',
      );
      assert(!brokerKeep.text.includes('Thánh Viện'), 'sewer_broker_01 KEEP never leaks Thánh Viện');

      // 3. sanctum_agent_01 Tier 6 pronoun shift: KEEP (Chúng ta – Ngươi, zero Thánh Viện) vs BREAK (Ta – Ngươi) vs undead_outsider
      const [sanctumKeep] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'sanctum_agent_01', hasBadge: false, raceId: 'human', legalStatus: 'OUTLAW' }],
        70,
        'KEEP',
        'human',
      );
      assertEqual(
        sanctumKeep.text,
        'Liên Lạc Viên Kháng Chiến: "Mừng ngươi thoát khỏi bẫy của lũ vong cốt. Cầm lấy tiếp tế đi — Vương triều Xác chết vẫn đang giam giữ Mảnh Đá Tà Khí ngoài Biên Trấn Bỏ Hoang, chúng ta cần ngươi thu hồi trước khi lũ cốt ma kịp dựng lại tế lễ."',
        'sanctum_agent_01 KEEP dialogue uses Chúng ta – Ngươi verbatim',
      );
      assert(!sanctumKeep.text.includes('Thánh Viện'), 'sanctum_agent_01 KEEP never leaks Thánh Viện');

      const [sanctumBreakHuman] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'sanctum_agent_01', hasBadge: false, raceId: 'human', legalStatus: 'OUTLAW' }],
        75,
        'BREAK',
        'human',
      );
      assertEqual(
        sanctumBreakHuman.text,
        'Phái Viên Ngầm Thánh Viện: "Ngươi xé được Màn Che mà vẫn sống bước xuống đây sao? Đừng nhìn ta bằng ánh mắt đó — không bẩn tay thì người sống mãi mãi chỉ là đám cừu đóng thuế trong chuồng của người chết. Cầm tiếp tế rồi ra Biên Trấn Bỏ Hoang lấy mảnh Báu Vật về cho ta."',
        'sanctum_agent_01 BREAK human uses Ta – Ngươi verbatim',
      );

      const [sanctumBreakUndead] = ps.translateEvents(
        [{ type: 'NPC_TALKED', entityId: 'sanctum_agent_01', hasBadge: false, raceId: 'undead_outsider', legalStatus: 'OUTLAW' }],
        75,
        'BREAK',
        'undead_outsider',
      );
      assertEqual(
        sanctumBreakUndead.text,
        'Phái Viên Ngầm Thánh Viện: "Thứ thân xác lạnh ngắt của ngươi khiến ta ghê tởm... nhưng ít ra ngươi không mang xích Đế luật. Đừng hiểu lầm — ta chỉ cấp tiếp tế để ngươi ra Biên Trấn Bỏ Hoang mang mảnh Báu Vật về phá sập hàng rào trên kia."',
        'sanctum_agent_01 BREAK undead_outsider dialogue verbatim',
      );
      assert(!sanctumBreakUndead.text.includes('""'), 'no double quotes in Hub NPC dialogue');
    },
  },
  {
    name: 'Phase 7A v0.5.0: TRIBUNAL_TRANSITIONED, 4 new GATE_LOCKED reasons, INVENTORY_FULL, Hub economy events, and border_ration_pack DisplayItem',
    run: () => {
      // 1. TRIBUNAL_TRANSITIONED (all 4 resolutions + KEEP/BREAK OUTLAW_ESCAPE)
      const [citLog] = ps.translateEvents(
        [{ type: 'TRIBUNAL_TRANSITIONED', resolution: 'CITIZEN', targetRoomId: 'room_market_street', silverGranted: 25 }],
        75,
        'BREAK',
      );
      assertEqual(
        citLog.text,
        'Con dấu Pháp Đình đóng xuống trang giấy da. Đế luật cấp quy chế Công dân Dị giới cùng 25 Bạc định cư — cổng Đông mở lối dẫn ngươi thẳng vào Phố Giao Thương Nội Thành.',
        'TRIBUNAL_TRANSITIONED CITIZEN verbatim',
      );

      const [envoyLog] = ps.translateEvents(
        [{ type: 'TRIBUNAL_TRANSITIONED', resolution: 'ENVOY', targetRoomId: 'room_market_street', silverGranted: 40 }],
        75,
        'BREAK',
      );
      assertEqual(
        envoyLog.text,
        'Ánh sáng nguyên bản từ Lăng Kính Thực Tại khiến Phán Quan lập mật tấu khẩn gửi Thượng đỉnh. Đế luật cấp 40 Bạc công phí Đặc sứ — mời ngươi tạm lưu chân tại Phố Giao Thương Nội Thành chờ phiên triệu kiến.',
        'TRIBUNAL_TRANSITIONED ENVOY verbatim',
      );

      const [convictLog] = ps.translateEvents(
        [{ type: 'TRIBUNAL_TRANSITIONED', resolution: 'CONVICT', targetRoomId: 'room_penal_outpost', silverGranted: 15 }],
        75,
        'BREAK',
      );
      assertEqual(
        convictLog.text,
        'Bản án khổ sai biên trấn được đóng dấu xác nhận. Hai hàng Tuần vệ áp giải ngươi ra Trạm Biên Ải Khổ Sai kèm 15 Bạc tiếp tế tối thiểu để bắt đầu hạn ngạch chuộc tội.',
        'TRIBUNAL_TRANSITIONED CONVICT verbatim',
      );

      const [outlawBreakLog] = ps.translateEvents(
        [{ type: 'TRIBUNAL_TRANSITIONED', resolution: 'OUTLAW_ESCAPE', targetRoomId: 'room_outer_sewer', silverGranted: 20 }],
        75,
        'BREAK',
      );
      assertEqual(
        outlawBreakLog.text,
        'Phán Quan Pháp Chế gục ngã giữa hồi chuông giới nghiêm vang dội khắp Nội Thành. Giữa cơn hỗn loạn, ngươi vơ vội 20 Bạc rồi lao qua lối cống vỡ bên hông sảnh, rơi thẳng xuống Hầm Cống Ngoại Vi.',
        'TRIBUNAL_TRANSITIONED OUTLAW_ESCAPE BREAK verbatim',
      );

      const [outlawKeepLog] = ps.translateEvents(
        [{ type: 'TRIBUNAL_TRANSITIONED', resolution: 'OUTLAW_ESCAPE', targetRoomId: 'room_outer_sewer', silverGranted: 20 }],
        70,
        'KEEP',
      );
      assertEqual(
        outlawKeepLog.text,
        '[HỆ THỐNG]: Đại Tư Tế Vong Cốt đã bị thanh tẩy! Phát hiện Quân đoàn Vong cốt bao vây đại sảnh — thu hồi 20 Bạc chiến lợi phẩm và rút gấp qua lối ngầm xuống Hầm Trú Ẩn Đội Kháng Chiến!',
        'TRIBUNAL_TRANSITIONED OUTLAW_ESCAPE KEEP verbatim',
      );

      // 2. 4 new GATE_LOCKED reasons
      const [tribunalConcluded] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_market_street', reason: 'TRIBUNAL_CONCLUDED' }],
        75,
        'BREAK',
      );
      assertEqual(
        tribunalConcluded.text,
        'Cổng Tiền Sảnh Pháp Đình đã đóng chốt sau khi tuyên án — không được tự ý quay lại.',
        'GATE_LOCKED TRIBUNAL_CONCLUDED verbatim',
      );

      const [convictBarred] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_penal_outpost', reason: 'CONVICT_BARRED' }],
        75,
        'BREAK',
      );
      assertEqual(
        convictBarred.text,
        'Tuần vệ cổng Nội Thành chặn bước: Phạm nhân đang mang án khổ sai không được phép tiến vào Phố Giao Thương trước khi xóa án tích.',
        'GATE_LOCKED CONVICT_BARRED verbatim',
      );

      const [outlawLockTruth] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_outer_sewer', reason: 'OUTLAW_LOCKDOWN' }],
        75,
        'BREAK',
      );
      assertEqual(
        outlawLockTruth.text,
        'Lệnh truy nã tối cao đang phong tỏa lối lên mặt đất — bước ra khỏi Hầm Cống lúc này là tự nộp mạng cho Tuần vệ.',
        'GATE_LOCKED OUTLAW_LOCKDOWN BREAK verbatim',
      );

      const [outlawLockKeep] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_outer_sewer', reason: 'OUTLAW_LOCKDOWN' }],
        70,
        'KEEP',
      );
      assertEqual(
        outlawLockKeep.text,
        '[HỆ THỐNG]: Lối lên sào huyệt Nội thành đang bị Quân đoàn Vong cốt phong tỏa dày đặc — hãy di chuyển theo tuyến ngầm tới vùng biên!',
        'GATE_LOCKED OUTLAW_LOCKDOWN KEEP verbatim',
      );

      const [unbriefedTruth] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_market_street', reason: 'EXPEDITION_UNBRIEFED' }],
        75,
        'BREAK',
      );
      assertEqual(
        unbriefedTruth.text,
        'Chưa nhận ủy thác hay lệnh di chuyển ngoài thành — hãy nói chuyện với người phụ trách trong khu vực trước khi tiến ra Biên Trấn Bỏ Hoang.',
        'GATE_LOCKED EXPEDITION_UNBRIEFED BREAK verbatim',
      );

      const [unbriefedKeep] = ps.translateEvents(
        [{ type: 'GATE_LOCKED', roomId: 'room_outer_sewer', reason: 'EXPEDITION_UNBRIEFED' }],
        70,
        'KEEP',
      );
      assertEqual(
        unbriefedKeep.text,
        '[HỆ THỐNG]: Chưa nhận chỉ thị nhiệm vụ tại căn hầm — hãy gặp Liên Lạc Viên Kháng Chiến hoặc Tay Buôn Hầm Ngầm trước khi xuất phát!',
        'GATE_LOCKED EXPEDITION_UNBRIEFED KEEP verbatim',
      );

      // 3. INVENTORY_FULL & Hub economy + departure logs
      const [bagFullTruth] = ps.translateEvents(
        [{ type: 'INVENTORY_FULL', maxSlots: 6 }],
        75,
        'BREAK',
      );
      assertEqual(
        bagFullTruth.text,
        'Hành trang đã đầy (6/6 ô) — không thể mang thêm vật phẩm.',
        'INVENTORY_FULL BREAK verbatim',
      );

      const [bagFullKeep] = ps.translateEvents(
        [{ type: 'INVENTORY_FULL', maxSlots: 6 }],
        70,
        'KEEP',
      );
      assertEqual(
        bagFullKeep.text,
        '[HỆ THỐNG]: Hành trang đã đạt giới hạn 6/6 ô — hãy sử dụng bớt vật phẩm trước khi thu hồi.',
        'INVENTORY_FULL KEEP verbatim',
      );

      const [buyTruth] = ps.translateEvents(
        [{ type: 'HUB_RATION_BOUGHT', entityId: 'dwarf_smith_01', itemId: 'border_ration_pack', cost: 15, remainingSilver: 10 }],
        75,
        'BREAK',
      );
      assertEqual(
        buyTruth.text,
        'Mua Gói Lương Khô & Dược Cốt Biên Trấn (-15 Bạc).',
        'HUB_RATION_BOUGHT BREAK verbatim',
      );

      const [buyKeep] = ps.translateEvents(
        [{ type: 'HUB_RATION_BOUGHT', entityId: 'sewer_broker_01', itemId: 'border_ration_pack', cost: 15, remainingSilver: 5 }],
        70,
        'KEEP',
      );
      assertEqual(
        buyKeep.text,
        'Đổi Bọc Tế Phẩm Hỗn Tạp (-15 Bạc).',
        'HUB_RATION_BOUGHT KEEP verbatim',
      );

      const [claimTruth] = ps.translateEvents(
        [{ type: 'HUB_SUPPLY_CLAIMED', entityId: 'beast_warden_01', itemId: 'border_ration_pack' }],
        75,
        'BREAK',
      );
      assertEqual(
        claimTruth.text,
        'Nhận tiếp tế miễn phí: Gói Lương Khô & Dược Cốt Biên Trấn.',
        'HUB_SUPPLY_CLAIMED BREAK verbatim',
      );

      const [claimKeep] = ps.translateEvents(
        [{ type: 'HUB_SUPPLY_CLAIMED', entityId: 'sanctum_agent_01', itemId: 'border_ration_pack' }],
        70,
        'KEEP',
      );
      assertEqual(
        claimKeep.text,
        'Nhận tiếp tế kháng chiến: Bọc Tế Phẩm Hỗn Tạp.',
        'HUB_SUPPLY_CLAIMED KEEP verbatim',
      );

      const [restTruth] = ps.translateEvents(
        [{ type: 'HUB_RESTED', entityId: 'dwarf_smith_01', cost: 10, healAmount: 40, maxHp: 110, remainingSilver: 15, playerPosition: { x: 4, y: 4 } }],
        75,
        'BREAK',
      );
      assertEqual(
        restTruth.text,
        'Nghỉ chân hồi phục đầy 110 HP (-10 Bạc).',
        'HUB_RESTED BREAK verbatim',
      );

      const [restKeep] = ps.translateEvents(
        [{ type: 'HUB_RESTED', entityId: 'sewer_broker_01', cost: 10, healAmount: 40, maxHp: 130, remainingSilver: 10, playerPosition: { x: 2, y: 3 } }],
        70,
        'KEEP',
      );
      assertEqual(
        restKeep.text,
        'Tạm ẩn mình phục hồi đầy 130 HP (-10 Bạc).',
        'HUB_RESTED KEEP verbatim',
      );

      const [departTruth] = ps.translateEvents(
        [{ type: 'EXPEDITION_DEPARTED', fromRoomId: 'room_market_street', legalStatus: 'ENVOY' }],
        75,
        'BREAK',
      );
      assertEqual(
        departTruth.text,
        'Bước qua cổng Đông, rời khỏi vòng kiểm soát Nội Thành để tiến về Biên Trấn Bỏ Hoang.',
        'EXPEDITION_DEPARTED BREAK verbatim',
      );

      const [departKeep] = ps.translateEvents(
        [{ type: 'EXPEDITION_DEPARTED', fromRoomId: 'room_outer_sewer', legalStatus: 'OUTLAW' }],
        70,
        'KEEP',
      );
      assertEqual(
        departKeep.text,
        '[HỆ THỐNG]: Rời khỏi hầm trú ẩn — bắt đầu chiến dịch thanh tẩy tại Biên Trấn Bỏ Hoang!',
        'EXPEDITION_DEPARTED KEEP verbatim',
      );

      const silentHubLogs = ps.translateEvents(
        [
          { type: 'HUB_SERVICE_OPENED', entityId: 'dwarf_smith_01' },
          { type: 'HUB_SERVICE_CLOSED', entityId: 'dwarf_smith_01' },
        ],
        75,
        'BREAK',
      );
      assertEqual(silentHubLogs.length, 0, 'HUB_SERVICE_OPENED/CLOSED do not emit noisy log entries');

      // 4. border_ration_pack DisplayItem (+10 Thích Nghi for human -> 45 HP; 35 HP for others)
      const [humanRation] = ps.getDisplayInventory(['border_ration_pack'], 75, 'BREAK', 'human');
      assertEqual(humanRation.name, 'Gói Lương Khô & Dược Cốt Biên Trấn', 'border_ration_pack truth name');
      assertEqual(humanRation.effectiveHealAmount, 45, 'human border_ration_pack effective 45 HP');
      assertEqual(humanRation.actionLabel, 'Sử dụng (+45 HP · 1 lượt)', 'human ration actionLabel');
      assert(humanRation.description.endsWith(' (+10 Thích Nghi)'), 'human ration appends Thích Nghi');

      const [keepRation] = ps.getDisplayInventory(['border_ration_pack'], 70, 'KEEP', 'dark_elf');
      assertEqual(keepRation.name, 'Bọc Tế Phẩm Hỗn Tạp', 'border_ration_pack illusion name');
      assertEqual(keepRation.effectiveHealAmount, 35, 'dark_elf border_ration_pack effective 35 HP');
      assertEqual(keepRation.actionLabel, 'Sử dụng (+35 HP · 1 lượt)', 'dark_elf ration actionLabel');
    },
  },
  {
    name: 'Phase 7A v0.5.0: DisplayPacket.inventoryHeaderLabel & hubPrompt labels/disabled reasons across all 4 Hub reps',
    run: () => {
      const engine = new GameEngine('human', 'brawler');
      const state = engine.getState();

      // 1. Initial inventoryHeaderLabel
      let packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.inventoryHeaderLabel, 'HÀNH TRANG (1/6) · 0 Bạc', 'initial inventory header');
      assertEqual(packet.hubPrompt, null, 'hubPrompt null when no Hub NPC active');

      // 2. dwarf_smith_01 (ENVOY, 40 Bạc, full HP): BUY_RATION enabled, REST_HEAL disabled ('HP đã đầy'), CLOSE enabled
      state.currentRoomId = 'room_market_street';
      state.player.roomId = 'room_market_street';
      state.filterChoice = 'BREAK';
      state.legalStatus = 'ENVOY';
      state.silver = 40;
      state.activeHubNpcId = 'dwarf_smith_01';
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.inventoryHeaderLabel, 'HÀNH TRANG (1/6) · 40 Bạc', 'header updates with silver');
      assertEqual(packet.hubPrompt?.npcName, 'Thợ Rèn Trưởng Người Lùn', 'smith npcName');
      assertEqual(packet.hubPrompt?.options.length, 3, 'smith offers BUY, REST, CLOSE');
      assertEqual(
        packet.hubPrompt?.options[0].label,
        'Mua tiếp tế — 15 Bạc · +35 HP',
        'smith BUY truth label verbatim',
      );
      assertEqual(packet.hubPrompt?.options[0].disabled, false, 'smith BUY enabled with 40 Bạc');
      assertEqual(
        packet.hubPrompt?.options[1].label,
        'Nghỉ hồi sức — 10 Bạc · Đầy HP',
        'smith REST label verbatim',
      );
      assertEqual(packet.hubPrompt?.options[1].disabled, true, 'smith REST disabled at full HP');
      assertEqual(packet.hubPrompt?.options[1].disabledReason, 'HP đã đầy', 'REST full HP reason verbatim');
      assertEqual(packet.hubPrompt?.options[2].label, 'Rời đi', 'CLOSE label verbatim');

      // Low silver + wounded -> BUY & REST both show 'Không đủ Bạc'
      state.silver = 5;
      state.player.hp = 50;
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.hubPrompt?.options[0].disabledReason, 'Không đủ Bạc', 'BUY no silver reason');
      assertEqual(packet.hubPrompt?.options[1].disabledReason, 'Không đủ Bạc', 'REST no silver reason');

      // Enough silver + full bag 6/6 -> BUY shows 'Túi đồ đầy 6/6', REST enabled
      state.silver = 25;
      state.inventory = ['world_relic', 'warm_bread', 'warm_bread', 'warm_bread', 'warm_bread', 'warm_bread'];
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.inventoryHeaderLabel, 'HÀNH TRANG (6/6) · 25 Bạc', 'full bag header');
      assertEqual(packet.hubPrompt?.options[0].disabledReason, 'Túi đồ đầy 6/6', 'BUY full bag reason');
      assertEqual(packet.hubPrompt?.options[1].disabled, false, 'REST enabled when wounded with 25 Bạc');

      // 3. beast_warden_01: CONVICT gets CLAIM_FREE_SUPPLY (4 options); CITIZEN does NOT (3 options)
      state.currentRoomId = 'room_penal_outpost';
      state.player.roomId = 'room_penal_outpost';
      state.activeHubNpcId = 'beast_warden_01';
      state.legalStatus = 'CONVICT';
      state.inventory = ['world_relic'];
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.hubPrompt?.options.length, 4, 'warden CONVICT offers CLAIM + BUY + REST + CLOSE');
      assertEqual(
        packet.hubPrompt?.options[0].label,
        'Nhận tiếp tế — 0 Bạc · 1 lần',
        'CLAIM label verbatim',
      );
      assertEqual(packet.hubPrompt?.options[0].disabled, false, 'CONVICT CLAIM enabled before claiming');

      state.claimedFreeSupplyIds = ['beast_warden_01'];
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.hubPrompt?.options[0].disabled, true, 'CLAIM disabled after claiming');
      assertEqual(
        packet.hubPrompt?.options[0].disabledReason,
        'Đã nhận tiếp tế',
        'CLAIM already claimed reason verbatim',
      );

      state.legalStatus = 'CITIZEN';
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.hubPrompt?.options.length, 3, 'warden CITIZEN omits CLAIM_FREE_SUPPLY');

      // 4. sewer_broker_01 in KEEP uses illusion BUY label ('Đổi Bọc Tế Phẩm — 15 Bạc · +35 HP')
      state.currentRoomId = 'room_outer_sewer';
      state.player.roomId = 'room_outer_sewer';
      state.legalStatus = 'OUTLAW';
      state.filterChoice = 'KEEP';
      state.activeHubNpcId = 'sewer_broker_01';
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.hubPrompt?.npcName, 'Tay Buôn Hầm Ngầm', 'broker KEEP npcName');
      assertEqual(
        packet.hubPrompt?.options[0].label,
        'Đổi Bọc Tế Phẩm — 15 Bạc · +35 HP',
        'broker KEEP BUY label verbatim',
      );

      // 5. sanctum_agent_01 offers ONLY CLAIM_FREE_SUPPLY + CLOSE (never BUY/REST) and zero Thánh Viện leak in KEEP
      state.activeHubNpcId = 'sanctum_agent_01';
      state.claimedFreeSupplyIds = [];
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.hubPrompt?.npcName, 'Liên Lạc Viên Kháng Chiến', 'sanctum KEEP npcName');
      assertEqual(packet.hubPrompt?.options.length, 2, 'sanctum offers ONLY CLAIM + CLOSE');
      assertEqual(packet.hubPrompt?.options[0].choice, 'CLAIM_FREE_SUPPLY', 'sanctum option 0 is CLAIM');
      assertEqual(packet.hubPrompt?.options[1].choice, 'CLOSE_HUB_MENU', 'sanctum option 1 is CLOSE');
      assert(
        !JSON.stringify(packet.hubPrompt).includes('Thánh Viện'),
        'sanctum KEEP hubPrompt never leaks Thánh Viện',
      );

      state.filterChoice = 'BREAK';
      packet = ps.buildDisplayPacket(state, []);
      assertEqual(packet.hubPrompt?.npcName, 'Phái Viên Ngầm Thánh Viện', 'sanctum BREAK npcName');
    },
  },
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} PERCEPTION SERVICE TEST SUITES PASSED`);
