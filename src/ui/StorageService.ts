import type { ClassId, RaceId } from '../core/types';
import type { CodexEndingKey } from '../perception/PerceptionService';

export const META_STORAGE_KEY = 'project_veil_meta_v1';
export const META_SCHEMA_VERSION = 1 as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface VeilMetaData {
  schemaVersion: 1;
  unlockedEndings: CodexEndingKey[];
  completedBuilds: string[];
  muted: boolean;
}

const VALID_ENDINGS = new Set<CodexEndingKey>([
  'SUMMONER_BLADE',
  'RULE_BREAKER',
  'AWAKENED',
]);

const VALID_RACES = new Set<RaceId>(['human', 'dark_elf', 'undead_outsider']);
const VALID_CLASSES = new Set<ClassId>(['brawler', 'iron_vanguard', 'spellblade']);

function createDefaultMeta(): VeilMetaData {
  return {
    schemaVersion: META_SCHEMA_VERSION,
    unlockedEndings: [],
    completedBuilds: [],
    muted: false,
  };
}

function cloneMeta(meta: VeilMetaData): VeilMetaData {
  return {
    schemaVersion: META_SCHEMA_VERSION,
    unlockedEndings: [...meta.unlockedEndings],
    completedBuilds: [...meta.completedBuilds],
    muted: meta.muted,
  };
}

export function formatBuildCompletionKey(raceId: RaceId, classId: ClassId): string {
  return `${raceId}:${classId}`;
}

function isValidBuildKey(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split(':');
  if (parts.length !== 2) return false;
  return (
    VALID_RACES.has(parts[0] as RaceId) && VALID_CLASSES.has(parts[1] as ClassId)
  );
}

function parseAndValidateMeta(raw: string): VeilMetaData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  if (record.schemaVersion !== META_SCHEMA_VERSION) {
    return null;
  }
  if (!Array.isArray(record.unlockedEndings) || !Array.isArray(record.completedBuilds)) {
    return null;
  }
  if (typeof record.muted !== 'boolean') {
    return null;
  }

  const unlockedEndings: CodexEndingKey[] = [];
  for (const item of record.unlockedEndings) {
    if (typeof item !== 'string' || !VALID_ENDINGS.has(item as CodexEndingKey)) {
      return null;
    }
    const endingKey = item as CodexEndingKey;
    if (!unlockedEndings.includes(endingKey)) {
      unlockedEndings.push(endingKey);
    }
  }

  const completedBuilds: string[] = [];
  for (const item of record.completedBuilds) {
    if (!isValidBuildKey(item)) {
      return null;
    }
    if (!completedBuilds.includes(item)) {
      completedBuilds.push(item);
    }
  }

  return {
    schemaVersion: META_SCHEMA_VERSION,
    unlockedEndings,
    completedBuilds,
    muted: record.muted,
  };
}

function resolveDefaultBrowserStorage(): StorageLike | null {
  try {
    if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
      return globalThis.localStorage ?? null;
    }
  } catch {
    // Blocked localStorage access (e.g. strict privacy sandbox)
  }
  return null;
}

export class StorageService {
  private storage: StorageLike | null;
  private memoryFallback: VeilMetaData = createDefaultMeta();

  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? resolveDefaultBrowserStorage() : storage;
    this.memoryFallback = this.readValidatedOrReset();
  }

  loadMeta(): VeilMetaData {
    this.memoryFallback = this.readValidatedOrReset();
    return cloneMeta(this.memoryFallback);
  }

  isMuted(): boolean {
    return this.loadMeta().muted;
  }

  setMuted(muted: boolean): VeilMetaData {
    const current = this.readValidatedOrReset();
    const next: VeilMetaData = {
      ...current,
      muted: Boolean(muted),
    };
    this.persist(next);
    return cloneMeta(next);
  }

  recordEnding(
    endingKey: CodexEndingKey,
    raceId: RaceId,
    classId: ClassId,
  ): VeilMetaData {
    const current = this.readValidatedOrReset();
    const unlockedEndings = [...current.unlockedEndings];
    if (VALID_ENDINGS.has(endingKey) && !unlockedEndings.includes(endingKey)) {
      unlockedEndings.push(endingKey);
    }

    const completedBuilds = [...current.completedBuilds];
    const buildKey = formatBuildCompletionKey(raceId, classId);
    if (isValidBuildKey(buildKey) && !completedBuilds.includes(buildKey)) {
      completedBuilds.push(buildKey);
    }

    const next: VeilMetaData = {
      schemaVersion: META_SCHEMA_VERSION,
      unlockedEndings,
      completedBuilds,
      muted: current.muted,
    };
    this.persist(next);
    return cloneMeta(next);
  }

  resetMeta(): VeilMetaData {
    const fresh = createDefaultMeta();
    this.persist(fresh);
    return cloneMeta(fresh);
  }

  private readValidatedOrReset(): VeilMetaData {
    if (!this.storage) {
      return cloneMeta(this.memoryFallback);
    }

    try {
      const raw = this.storage.getItem(META_STORAGE_KEY);
      if (raw === null) {
        return cloneMeta(this.memoryFallback);
      }

      const validated = parseAndValidateMeta(raw);
      if (validated) {
        this.memoryFallback = validated;
        return cloneMeta(validated);
      }

      const reset = createDefaultMeta();
      this.persist(reset);
      return cloneMeta(reset);
    } catch {
      return cloneMeta(this.memoryFallback);
    }
  }

  private persist(meta: VeilMetaData): void {
    this.memoryFallback = cloneMeta(meta);
    if (!this.storage) return;
    try {
      this.storage.setItem(META_STORAGE_KEY, JSON.stringify(this.memoryFallback));
    } catch {
      // QuotaExceededError or SecurityError -> keep in-memory copy cleanly
    }
  }
}
