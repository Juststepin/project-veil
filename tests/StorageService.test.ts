import { SoundService } from '../src/ui/SoundService';
import {
  META_SCHEMA_VERSION,
  META_STORAGE_KEY,
  StorageService,
  type StorageLike,
} from '../src/ui/StorageService';

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

class MemoryStorage implements StorageLike {
  public data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'StorageService initializes default schemaVersion 1, persists unlockedEndings/completedBuilds/muted, and deduplicates up to 3 endings & 9 builds',
    run: () => {
      const backing = new MemoryStorage();
      const service = new StorageService(backing);

      const initial = service.loadMeta();
      assertEqual(initial.schemaVersion, META_SCHEMA_VERSION, 'schemaVersion is 1');
      assertEqual(initial.unlockedEndings.length, 0, 'starts with 0 unlocked endings');
      assertEqual(initial.completedBuilds.length, 0, 'starts with 0 completed builds');
      assertEqual(initial.muted, false, 'starts unmuted');

      // Record endings & builds (including duplicates)
      service.recordEnding('SUMMONER_BLADE', 'human', 'brawler');
      service.recordEnding('SUMMONER_BLADE', 'human', 'brawler');
      service.recordEnding('RULE_BREAKER', 'dark_elf', 'spellblade');
      service.recordEnding('AWAKENED', 'undead_outsider', 'iron_vanguard');
      service.setMuted(true);

      // Reload from a brand-new StorageService instance over the same backing store
      const reloaded = new StorageService(backing).loadMeta();
      assertEqual(
        JSON.stringify(reloaded.unlockedEndings),
        JSON.stringify(['SUMMONER_BLADE', 'RULE_BREAKER', 'AWAKENED']),
        'all 3 endings persisted and deduplicated',
      );
      assertEqual(
        JSON.stringify(reloaded.completedBuilds),
        JSON.stringify([
          'human:brawler',
          'dark_elf:spellblade',
          'undead_outsider:iron_vanguard',
        ]),
        'completed builds persisted and deduplicated',
      );
      assertEqual(reloaded.muted, true, 'muted persisted true');
      assert(backing.getItem(META_STORAGE_KEY) !== null, 'stored under project_veil_meta_v1');

      // Complete all 9 valid builds -> bounded at 9
      const races = ['human', 'dark_elf', 'undead_outsider'] as const;
      const classes = ['brawler', 'iron_vanguard', 'spellblade'] as const;
      for (const r of races) {
        for (const c of classes) {
          service.recordEnding('AWAKENED', r, c);
        }
      }
      assertEqual(service.loadMeta().completedBuilds.length, 9, 'completedBuilds reaches exact 9/9');
    },
  },
  {
    name: 'StorageService auto-resets cleanly on corrupted JSON, wrong schemaVersion, or invalid fields without crashing',
    run: () => {
      const backing = new MemoryStorage();

      // 1. Corrupted JSON string
      backing.setItem(META_STORAGE_KEY, '{corrupted_json!!!');
      const fromCorrupt = new StorageService(backing).loadMeta();
      assertEqual(fromCorrupt.schemaVersion, 1, 'corrupt JSON resets to schemaVersion 1');
      assertEqual(fromCorrupt.unlockedEndings.length, 0, 'corrupt JSON resets unlockedEndings');
      assertEqual(fromCorrupt.completedBuilds.length, 0, 'corrupt JSON resets completedBuilds');
      assertEqual(fromCorrupt.muted, false, 'corrupt JSON resets muted');
      assertEqual(
        JSON.parse(backing.getItem(META_STORAGE_KEY)!).schemaVersion,
        1,
        'corrupt JSON entry in storage was repaired cleanly',
      );

      // 2. Wrong schemaVersion (e.g. v2 or v0)
      backing.setItem(
        META_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 2,
          unlockedEndings: ['AWAKENED'],
          completedBuilds: ['human:brawler'],
          muted: true,
        }),
      );
      const fromWrongVer = new StorageService(backing).loadMeta();
      assertEqual(fromWrongVer.unlockedEndings.length, 0, 'wrong schemaVersion resets endings');
      assertEqual(fromWrongVer.muted, false, 'wrong schemaVersion resets muted');

      // 3. Invalid ending key or malformed build key
      backing.setItem(
        META_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          unlockedEndings: ['UNKNOWN_ENDING'],
          completedBuilds: ['human:brawler'],
          muted: false,
        }),
      );
      assertEqual(
        new StorageService(backing).loadMeta().completedBuilds.length,
        0,
        'invalid ending key triggers clean reset',
      );

      backing.setItem(
        META_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          unlockedEndings: ['AWAKENED'],
          completedBuilds: ['invalid_race:brawler'],
          muted: false,
        }),
      );
      assertEqual(
        new StorageService(backing).loadMeta().unlockedEndings.length,
        0,
        'invalid build key triggers clean reset',
      );
    },
  },
  {
    name: 'StorageService & SoundService degrade safely to no-op/memory fallback when localStorage throws or Web Audio is absent',
    run: () => {
      const throwingStorage: StorageLike = {
        getItem() {
          throw new Error('SecurityError: localStorage blocked');
        },
        setItem() {
          throw new Error('QuotaExceededError');
        },
      };

      const storage = new StorageService(throwingStorage);
      assertEqual(storage.isMuted(), false, 'default unmuted when storage throws');
      storage.setMuted(true);
      assertEqual(storage.isMuted(), true, 'in-memory fallback retains muted=true');
      const updated = storage.recordEnding('RULE_BREAKER', 'dark_elf', 'brawler');
      assertEqual(updated.unlockedEndings.length, 1, 'in-memory fallback retains unlocked ending');
      assertEqual(updated.completedBuilds.length, 1, 'in-memory fallback retains completed build');

      // SoundService safe no-op check in Node environment (no window / AudioContext)
      const sound = new SoundService(false);
      assertEqual(sound.isMuted(), false, 'SoundService starts unmuted');
      sound.playGlitchPulse();
      sound.playForEvents([
        { type: 'PLAYER_MOVED', to: { x: 2, y: 3 } },
        {
          type: 'ATTACKED',
          attackerId: 'player',
          targetId: 'patrol_01',
          damage: 24,
          targetRemainingHp: 26,
          triggeredTraitId: 'riposte_strike',
          bonusDamage: 10,
        },
        {
          type: 'RELIC_ACTIVATED',
          mode: 'KEEP',
          healAmount: 20,
          targetId: 'patrol_01',
          damage: 35,
          targetPosition: { x: 5, y: 4 },
        },
        {
          type: 'ENEMY_ATTACKED',
          attackerId: 'patrol_01',
          damage: 6,
          playerRemainingHp: 94,
          riposteArmed: true,
        },
        { type: 'GAME_ENDED', endingId: 'SUMMONER_BLADE' },
      ]);
      sound.setMuted(true);
      assertEqual(sound.isMuted(), true, 'SoundService updates muted state cleanly');
    },
  },
  {
    name: 'SoundService resumes iOS Safari WebKit AudioContext from state="interrupted" on unlock(), play(), and persistent touchend gesture',
    run: () => {
      const globalScope = globalThis as unknown as { window?: unknown };
      const hadWindow = Object.prototype.hasOwnProperty.call(globalScope, 'window');
      const prevWindow = globalScope.window;

      let resumeCalls = 0;
      let latestCtx: MockAudioContext | null = null;
      const listeners = new Map<string, EventListener>();

      class MockAudioContext {
        public state = 'interrupted';
        public currentTime = 0;
        public sampleRate = 44100;
        public destination = {};

        constructor() {
          latestCtx = this;
        }

        resume(): Promise<void> {
          resumeCalls += 1;
          this.state = 'running';
          return Promise.resolve();
        }

        createOscillator() {
          return {
            type: 'sine',
            frequency: {
              setValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
            connect() {},
            start() {},
            stop() {},
          };
        }

        createGain() {
          return {
            gain: {
              setValueAtTime() {},
              linearRampToValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
            connect() {},
          };
        }
      }

      try {
        globalScope.window = {
          AudioContext: MockAudioContext,
          addEventListener(type: string, handler: EventListener) {
            listeners.set(type, handler);
          },
          removeEventListener(type: string, handler: EventListener) {
            if (listeners.get(type) === handler) {
              listeners.delete(type);
            }
          },
        };

        // 1. unlock() & play() must resume an AudioContext in iOS WebKit "interrupted" state
        const sound = new SoundService(false);
        sound.unlock();
        assert(latestCtx !== null, 'AudioContext created on unlock()');
        assertEqual(
          resumeCalls,
          1,
          'unlock() calls resume() when AudioContext state is interrupted',
        );
        assertEqual(latestCtx!.state, 'running', 'AudioContext transitions to running after unlock()');

        // Simulate iOS screen lock / tab switch putting existing AudioContext into "interrupted"
        latestCtx!.state = 'interrupted';
        sound.play('step');
        assertEqual(
          resumeCalls,
          2,
          'play() calls resume() when AudioContext state is interrupted',
        );
        assertEqual(latestCtx!.state, 'running', 'AudioContext transitions back to running on play()');

        // Closed context must never call resume()
        latestCtx!.state = 'closed';
        sound.unlock();
        sound.play('step');
        assertEqual(resumeCalls, 2, 'closed AudioContext does not call resume()');

        // 2. Persistent touchend listener remains active across session for repeated WebView/Zalo interruptions
        listeners.clear();
        const touchSound = new SoundService(false);
        assert(
          listeners.has('touchend'),
          'installInteractionUnlock registers touchend listener for iOS Safari',
        );
        const onTouchend = listeners.get('touchend')!;
        onTouchend({} as Event);
        assertEqual(resumeCalls, 3, 'first touchend gesture unlocks interrupted AudioContext');
        assert(
          listeners.has('touchend'),
          'touchend listener stays attached across session in case WebView re-interrupts later',
        );

        // Simulate switching to Zalo/Messenger and coming back -> second touchend unlocks again
        latestCtx!.state = 'interrupted';
        onTouchend({} as Event);
        assertEqual(resumeCalls, 4, 'subsequent touchend unlocks re-interrupted AudioContext');
        assertEqual(touchSound.isMuted(), false, 'touchSound remains unmuted');
      } finally {
        if (hadWindow) {
          globalScope.window = prevWindow;
        } else {
          delete globalScope.window;
        }
      }
    },
  },
  {
    name: 'v0.3.1 Audio Polish: play("step") awaits async resume().then() before reading fresh currentTime, visibilitychange resumes after unlock, and step/glitch EQ routes cleanly',
    run: async () => {
      const globalScope = globalThis as unknown as { window?: unknown; document?: unknown };
      const hadWindow = Object.prototype.hasOwnProperty.call(globalScope, 'window');
      const prevWindow = globalScope.window;
      const hadDocument = Object.prototype.hasOwnProperty.call(globalScope, 'document');
      const prevDocument = globalScope.document;

      let resumeCalls = 0;
      let pendingResolve: (() => void) | null = null;
      let latestCtx: AsyncMockAudioContext | null = null;
      const oscStartTimes: number[] = [];
      const oscInitialFreqs: number[] = [];
      const squareOscTargets: unknown[] = [];
      const docListeners = new Map<string, EventListener>();
      const mockDoc = {
        visibilityState: 'hidden',
        addEventListener(type: string, handler: EventListener) {
          docListeners.set(type, handler);
        },
        removeEventListener(type: string, handler: EventListener) {
          if (docListeners.get(type) === handler) {
            docListeners.delete(type);
          }
        },
      };

      class AsyncMockAudioContext {
        public state = 'suspended';
        public currentTime = 1.0;
        public sampleRate = 44100;
        public destination = { kind: 'destination' };

        constructor() {
          latestCtx = this;
        }

        resume(): Promise<void> {
          resumeCalls += 1;
          return new Promise<void>((resolve) => {
            pendingResolve = resolve;
          });
        }

        createOscillator() {
          const oscNode = {
            type: 'sine',
            frequency: {
              setValueAtTime(val: number) {
                oscInitialFreqs.push(val);
              },
              exponentialRampToValueAtTime() {},
            },
            connect(target: unknown) {
              if (oscNode.type === 'square') {
                squareOscTargets.push(target);
              }
            },
            start(when = 0) {
              oscStartTimes.push(when);
            },
            stop() {},
          };
          return oscNode;
        }

        createGain() {
          return {
            kind: 'gain',
            gain: {
              setValueAtTime() {},
              linearRampToValueAtTime() {},
              exponentialRampToValueAtTime() {},
            },
            connect() {},
          };
        }

        createBiquadFilter() {
          return {
            kind: 'filter',
            type: 'bandpass',
            frequency: { setValueAtTime() {} },
            Q: { setValueAtTime() {} },
            connect() {},
          };
        }

        createBuffer(_channels: number, length: number, _sampleRate: number) {
          return {
            getChannelData: () => new Float32Array(length),
          };
        }

        createBufferSource() {
          return {
            buffer: null as unknown,
            connect() {},
            start() {},
            stop() {},
          };
        }
      }

      try {
        globalScope.window = {
          AudioContext: AsyncMockAudioContext,
          addEventListener() {},
          removeEventListener() {},
        };
        globalScope.document = mockDoc;

        const sound = new SoundService(false);
        assert(
          docListeners.has('visibilitychange'),
          'SoundService registers document visibilitychange listener',
        );

        // Before user has unlocked audio once, visibilitychange should NOT prematurely create/resume context
        mockDoc.visibilityState = 'visible';
        docListeners.get('visibilitychange')!({} as Event);
        assertEqual(resumeCalls, 0, 'visibilitychange is a no-op before first user unlock');

        // Trigger play('step') while AudioContext is 'suspended' and resume() is still pending
        sound.play('step');
        assert(latestCtx !== null, 'AudioContext instantiated on play("step")');
        assertEqual(resumeCalls, 1, 'play("step") initiates async resume()');
        assertEqual(
          oscStartTimes.length,
          0,
          'osc.start must NOT be called before async resume() resolves (prevents swallowing 60ms step)',
        );

        // Advance hardware clock while app wakes up, then resolve resume()
        latestCtx!.currentTime = 4.25;
        latestCtx!.state = 'running';
        pendingResolve!();
        await Promise.resolve();
        await Promise.resolve();

        assert(
          oscStartTimes.length >= 2,
          'play("step") starts both sub-body and mid-harmonic (~190Hz) oscillators after resume()',
        );
        for (const startedAt of oscStartTimes) {
          assertEqual(
            startedAt,
            4.25,
            'play("step") schedules oscillator using fresh ctx.currentTime after resume() resolves',
          );
        }
        assert(
          oscInitialFreqs.some((hz) => hz >= 170 && hz <= 220),
          'play("step") includes ~190Hz mid-range layer for phone speakers',
        );

        // Verify play('glitch') routes square wave through BiquadFilterNode rather than directly into gain
        sound.play('glitch');
        assertEqual(squareOscTargets.length, 1, 'play("glitch") connects square oscillator');
        assertEqual(
          (squareOscTargets[0] as { kind?: string }).kind,
          'filter',
          'play("glitch") routes square oscillator through filter to tame headphone harshness',
        );

        // Verify RELIC_ACTIVATED schedules both traitHit (2 osc) and heal (2 osc)
        const oscCountBeforeRelic = oscStartTimes.length;
        sound.playForEvents([
          {
            type: 'RELIC_ACTIVATED',
            mode: 'KEEP',
            healAmount: 20,
            targetId: 'patrol_01',
            damage: 35,
            targetPosition: { x: 5, y: 4 },
          },
        ]);
        assert(
          oscStartTimes.length >= oscCountBeforeRelic + 4,
          'RELIC_ACTIVATED schedules both traitHit and heal oscillators',
        );

        // Phase 7A: HUB_RATION_BOUGHT / HUB_SUPPLY_CLAIMED -> pickup (2 osc), HUB_RESTED -> heal (2 osc)
        const oscBeforeHubBuy = oscStartTimes.length;
        sound.playForEvents([
          {
            type: 'HUB_RATION_BOUGHT',
            entityId: 'dwarf_smith_01',
            itemId: 'border_ration_pack',
            cost: 15,
            remainingSilver: 25,
          },
        ]);
        assert(
          oscStartTimes.length >= oscBeforeHubBuy + 2,
          'HUB_RATION_BOUGHT schedules pickup chime oscillators',
        );

        const oscBeforeHubRest = oscStartTimes.length;
        sound.playForEvents([
          {
            type: 'HUB_RESTED',
            entityId: 'dwarf_smith_01',
            cost: 10,
            healAmount: 30,
            maxHp: 110,
            remainingSilver: 15,
            playerPosition: { x: 4, y: 4 },
          },
        ]);
        assert(
          oscStartTimes.length >= oscBeforeHubRest + 2,
          'HUB_RESTED schedules heal oscillators',
        );

        // Simulate app switch (interrupted) -> returning to visible tab triggers proactive resume()
        latestCtx!.state = 'interrupted';
        mockDoc.visibilityState = 'visible';
        docListeners.get('visibilitychange')!({} as Event);
        assertEqual(
          resumeCalls,
          2,
          'visibilitychange proactively calls resume() when returning to tab after prior unlock',
        );
      } finally {
        if (hadWindow) {
          globalScope.window = prevWindow;
        } else {
          delete globalScope.window;
        }
        if (hadDocument) {
          globalScope.document = prevDocument;
        } else {
          delete globalScope.document;
        }
      }
    },
  },
  {
    name: 'Phase 6 v0.4: StorageService preserves v0.3.1 localStorage progress (3/3 -> 3/4) on project_veil_meta_v1 and unlocks SOVEREIGN_PACT (4/4)',
    run: () => {
      const backing = new MemoryStorage();
      // Exact v0.3.1 payload persisted under project_veil_meta_v1 (schemaVersion: 1)
      backing.setItem(
        META_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: 1,
          unlockedEndings: ['SUMMONER_BLADE', 'RULE_BREAKER', 'AWAKENED'],
          completedBuilds: ['human:brawler', 'dark_elf:spellblade'],
          muted: true,
        }),
      );

      const service = new StorageService(backing);
      const migrated = service.loadMeta();
      assertEqual(migrated.schemaVersion, 1, 'schemaVersion stays 1');
      assertEqual(
        JSON.stringify(migrated.unlockedEndings),
        JSON.stringify(['SUMMONER_BLADE', 'RULE_BREAKER', 'AWAKENED']),
        'v0.3.1 3/3 unlocked endings preserved intact as 3/4',
      );
      assertEqual(
        JSON.stringify(migrated.completedBuilds),
        JSON.stringify(['human:brawler', 'dark_elf:spellblade']),
        'v0.3.1 completedBuilds preserved intact',
      );
      assertEqual(migrated.muted, true, 'v0.3.1 muted preference preserved intact');
      assert(
        !migrated.unlockedEndings.includes('SOVEREIGN_PACT'),
        '4th ending starts locked on migrated v0.3.1 profile',
      );

      // Unlock SOVEREIGN_PACT -> reaches 4/4 deduplicated
      service.recordEnding('SOVEREIGN_PACT', 'undead_outsider', 'iron_vanguard');
      service.recordEnding('SOVEREIGN_PACT', 'undead_outsider', 'iron_vanguard');
      const fullMeta = new StorageService(backing).loadMeta();
      assertEqual(
        JSON.stringify(fullMeta.unlockedEndings),
        JSON.stringify([
          'SUMMONER_BLADE',
          'RULE_BREAKER',
          'AWAKENED',
          'SOVEREIGN_PACT',
        ]),
        'reaches 4/4 unlocked endings cleanly',
      );
      assertEqual(fullMeta.completedBuilds.length, 3, 'completedBuilds incremented to 3/9');
    },
  },
];

for (const test of tests) {
  await test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} STORAGE & SOUND SERVICE TEST SUITES PASSED`);
