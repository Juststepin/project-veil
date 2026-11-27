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
    name: 'Modes, Veil HUD labels, and all 4 v0.4 Ending variants (+ AWAKENED Chuộc Tội) match STYLE_GLOSSARY 7.5 verbatim',
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
      assertEqual(
        keepEnding?.body,
        '‘Đại Tư Tế Vong Cốt’ — kẻ thực chất là Phán Quan Pháp Chế giữ trật tự Nội Thành — gục xuống dưới uy lực tàn bạo của Khế Ước Triệu Hồi. Giữa đại sảnh đá loang máu, Hệ thống lạnh lùng ban phát lời khen thưởng — còn phía sau cánh cửa Pháp Đình vừa sụp đổ, cả một đô thành người sống đang run rẩy trước lưỡi gươm ‘thanh tẩy’ mù quáng của ngươi.',
        'Ending 1 KEEP body verbatim',
      );

      const ruleBreakerEnding = ps.getEndingDisplay('SUMMONER_BLADE', 'BREAK');
      assertEqual(
        ruleBreakerEnding?.title,
        'Kết cục 2: Kẻ Phá Luật',
        'Ending 2 RULE_BREAKER title',
      );
      assertEqual(
        ruleBreakerEnding?.body,
        'Phán Quan Pháp Chế ngã xuống trước thềm đại sảnh. Ngươi đã rũ bỏ xiềng xích của Thánh Viện, nhưng cũng khước từ cúi đầu trước Đế luật lạnh băng của Bất Tử Giả. Hồi chuông giới nghiêm vang vọng khắp Nội Thành — từ giây phút này, cả Kẻ Triệu Hồi lẫn Đế Quốc Vĩnh Hằng đều ghi tên ngươi vào danh sách hiểm họa tối cao.',
        'Ending 2 RULE_BREAKER body verbatim',
      );

      const awakenedClean = ps.getEndingDisplay('AWAKENED', 'BREAK', {
        guardsKilled: 2,
        civiliansKilled: 0,
      });
      assertEqual(
        awakenedClean?.title,
        'Kết cục 3: Người Xé Màn Sương',
        'Ending 3 AWAKENED title',
      );
      assertEqual(
        awakenedClean?.body,
        'Con dấu Pháp Đình đóng xuống trang giấy da. Không lời tung hô, chỉ có trật tự nghiêm minh của Đế luật mở lối cho ngươi bước vào khu phố Nội Thành — nơi con người và Bất Tử Giả cùng vận hành một đế chế không tiếng cướp bóc. Màn Che đã rách; cuộc đời mới của một công dân dị giới dưới bóng Đế Quốc chỉ vừa bắt đầu.',
        'Ending 3 AWAKENED clean body verbatim',
      );

      const awakenedPenal = ps.getEndingDisplay('AWAKENED', 'BREAK', {
        guardsKilled: 0,
        civiliansKilled: 1,
      });
      assertEqual(
        awakenedPenal?.title,
        'Kết cục 3: Người Xé Màn Sương',
        'Ending 3 AWAKENED penal title',
      );
      assertEqual(
        awakenedPenal?.body,
        'Bản án khổ sai biên trấn được đóng dấu xác nhận. Ngươi giữ được mạng sống sau khi xé toạc Màn Che, nhưng món nợ máu với công dân Đế Quốc sẽ phải trả bằng nhiều năm tháng trấn giữ vùng biên. Giữa xiềng sắt lạnh lẽo của Đế luật, ít nhất đôi mắt ngươi đã không còn bị kẻ khác dẫn đường.',
        'Ending 3 AWAKENED Chuộc Tội body verbatim',
      );

      const pactEnding = ps.getEndingDisplay('SOVEREIGN_PACT', 'BREAK', {
        guardsKilled: 0,
        civiliansKilled: 0,
      });
      assertEqual(
        pactEnding?.title,
        'Kết cục 4: Khế Ước Ngang Hàng',
        'Ending 4 SOVEREIGN_PACT title',
      );
      assertEqual(
        pactEnding?.body,
        'Ánh sáng nguyên bản từ Lăng Kính Thực Tại phản chiếu lên lớp giáp xương của Phán Quan Pháp Chế. Lần đầu tiên, vị quan chấp pháp rời khỏi bục cao, lập mật tấu khẩn gửi thẳng Thượng đỉnh Đế Quốc. Không phải tù nhân, cũng chẳng phải quân cờ — ngươi bước vào Nội Thành với tư cách Đặc sứ nắm giữ Báu Vật Thế Giới, sẵn sàng lật ngược bàn cờ hai trăm năm của Thánh Viện Triệu Hồi.',
        'Ending 4 SOVEREIGN_PACT body verbatim',
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
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} PERCEPTION SERVICE TEST SUITES PASSED`);
