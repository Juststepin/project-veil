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

const tests: Array<{ name: string; run: () => void }> = [
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
    name: 'SoundService resumes iOS Safari WebKit AudioContext from state="interrupted" on unlock(), play(), and touchend gesture',
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
          'play() calls resume() via ensureContext() when AudioContext state is interrupted',
        );
        assertEqual(latestCtx!.state, 'running', 'AudioContext transitions back to running on play()');

        // Closed context must never call resume()
        latestCtx!.state = 'closed';
        sound.unlock();
        sound.play('step');
        assertEqual(resumeCalls, 2, 'closed AudioContext does not call resume()');

        // 2. First-interaction touchend listener unlocks interrupted context and cleans up all gesture listeners
        listeners.clear();
        const touchSound = new SoundService(false);
        assert(
          listeners.has('touchend'),
          'installFirstInteractionUnlock registers touchend listener for iOS Safari',
        );
        const onTouchend = listeners.get('touchend')!;
        onTouchend({} as Event);
        assertEqual(resumeCalls, 3, 'touchend gesture unlocks interrupted AudioContext');
        assert(!listeners.has('touchend'), 'touchend listener removed once state === running');
        assert(!listeners.has('pointerdown'), 'pointerdown listener removed once state === running');
        assert(!listeners.has('keydown'), 'keydown listener removed once state === running');
        assert(!listeners.has('click'), 'click listener removed once state === running');
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
];

for (const test of tests) {
  test.run();
  console.log(`PASS: ${test.name}`);
}

console.log(`\nALL ${tests.length} STORAGE & SOUND SERVICE TEST SUITES PASSED`);
