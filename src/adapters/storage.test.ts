import { describe, expect, it } from 'vitest';

import { PreferenceStore } from './storage';

function createLocalStorage(): Storage {
  const values = new Map<string, string>();

  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe('偏好存储', () => {
  it('没有持久化存储时使用默认值并在内存中读写', () => {
    const store = new PreferenceStore(null);

    expect(store.read()).toEqual({ bestScore: 0, muted: false });

    store.write({ bestScore: 12, muted: true });

    expect(store.read()).toEqual({ bestScore: 12, muted: true });
  });

  it('写入固定键后新实例可以从持久化存储读取', () => {
    const localStorage = createLocalStorage();
    const writer = new PreferenceStore(localStorage);
    writer.write({ bestScore: 23, muted: true });

    expect(localStorage.getItem('neon-snake-preferences-v1')).toBe(
      JSON.stringify({ bestScore: 23, muted: true }),
    );
    expect(new PreferenceStore(localStorage).read()).toEqual({
      bestScore: 23,
      muted: true,
    });
  });

  it.each(['', '{不是合法 JSON'])('损坏的持久化值 %j 返回当前内存值', (damaged) => {
    const localStorage = createLocalStorage();
    const store = new PreferenceStore(localStorage);
    store.write({ bestScore: 8, muted: false });
    localStorage.setItem('neon-snake-preferences-v1', damaged);

    expect(() => store.read()).not.toThrow();
    expect(store.read()).toEqual({ bestScore: 8, muted: false });
  });

  it('读取持久化存储抛错时回退到当前内存值', () => {
    const throwingStorage = createLocalStorage();
    throwingStorage.getItem = () => {
      throw new Error('无法读取');
    };
    const store = new PreferenceStore(throwingStorage);

    expect(() => store.read()).not.toThrow();
    expect(store.read()).toEqual({ bestScore: 0, muted: false });
  });

  it('写入持久化存储抛错时仍保留新的内存值', () => {
    const throwingStorage = createLocalStorage();
    throwingStorage.setItem = () => {
      throw new Error('无法写入');
    };
    const store = new PreferenceStore(throwingStorage);

    expect(() => store.write({ bestScore: 15, muted: true })).not.toThrow();
    expect(store.read()).toEqual({ bestScore: 15, muted: true });
  });

  it('写入参数和读取结果被外部修改都不会污染内存值', () => {
    const store = new PreferenceStore(null);
    const input = { bestScore: 31, muted: true };
    store.write(input);

    input.bestScore = 99;
    const result = store.read() as { bestScore: number; muted: boolean };
    result.muted = false;

    expect(store.read()).toEqual({ bestScore: 31, muted: true });
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('写入非法最高分 %s 时归一化为零', (bestScore) => {
    const localStorage = createLocalStorage();
    const store = new PreferenceStore(localStorage);

    store.write({ bestScore, muted: false });

    expect(store.read()).toEqual({ bestScore: 0, muted: false });
    expect(JSON.parse(localStorage.getItem('neon-snake-preferences-v1')!)).toEqual({
      bestScore: 0,
      muted: false,
    });
  });

  it.each([false, 0, 1, 'true', null, undefined])(
    '只有布尔值 true 才会启用静音：%s',
    (muted) => {
      const store = new PreferenceStore(null);

      store.write({ bestScore: 6, muted } as unknown as Parameters<
        PreferenceStore['write']
      >[0]);

      expect(store.read()).toEqual({ bestScore: 6, muted: false });
    },
  );

  it('从持久化存储读取时也会归一化字段', () => {
    const localStorage = createLocalStorage();
    localStorage.setItem(
      'neon-snake-preferences-v1',
      JSON.stringify({ bestScore: -7, muted: 'true' }),
    );

    expect(new PreferenceStore(localStorage).read()).toEqual({
      bestScore: 0,
      muted: false,
    });
  });
});
