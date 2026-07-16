export interface Preferences {
  readonly bestScore: number;
  readonly muted: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  bestScore: 0,
  muted: false,
};

const STORAGE_KEY = 'neon-snake-preferences-v1';

function normalize(value: unknown): Preferences {
  if (typeof value !== 'object' || value === null) {
    return { ...DEFAULT_PREFERENCES };
  }

  const candidate = value as {
    readonly bestScore?: unknown;
    readonly muted?: unknown;
  };
  const bestScore =
    typeof candidate.bestScore === 'number' &&
    Number.isSafeInteger(candidate.bestScore) &&
    candidate.bestScore >= 0
      ? candidate.bestScore
      : 0;

  return {
    bestScore,
    muted: candidate.muted === true,
  };
}

export class PreferenceStore {
  private memory: Preferences = DEFAULT_PREFERENCES;

  constructor(private readonly storage: Storage | null) {}

  read(): Preferences {
    try {
      const stored = this.storage?.getItem(STORAGE_KEY);
      if (stored != null) {
        this.memory = normalize(JSON.parse(stored));
      }
    } catch {
      // 保留最后一次可用的内存值。
    }

    return { ...this.memory };
  }

  write(preferences: Preferences): void {
    this.memory = normalize(preferences);
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.memory));
    } catch {
      // 内存值仍然可用，持久化失败不影响游戏。
    }
  }
}
