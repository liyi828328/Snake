import { describe, expect, it } from 'vitest';

import { SynthAudio } from './audio';
import type { GameEvent } from '../game/types';

type AutomationCall = readonly [
  operation: 'set' | 'exponentialRamp',
  value: number,
  at: number,
];

class FakeAudioParam {
  readonly calls: AutomationCall[] = [];

  setValueAtTime(value: number, at: number): FakeAudioParam {
    this.calls.push(['set', value, at]);
    return this;
  }

  exponentialRampToValueAtTime(value: number, at: number): FakeAudioParam {
    this.calls.push(['exponentialRamp', value, at]);
    return this;
  }
}

class FakeOscillator {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeAudioParam();
  readonly connections: unknown[] = [];
  readonly starts: number[] = [];
  readonly stops: number[] = [];

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }

  start(at: number): void {
    this.starts.push(at);
  }

  stop(at: number): void {
    this.stops.push(at);
  }
}

class FakeGain {
  readonly gain = new FakeAudioParam();
  readonly connections: unknown[] = [];

  connect(destination: unknown): unknown {
    this.connections.push(destination);
    return destination;
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running';
  currentTime = 4;
  readonly destination = {};
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  resumeCalls = 0;
  throwOnCreateOscillator = false;

  async resume(): Promise<void> {
    this.resumeCalls += 1;
  }

  createOscillator(): FakeOscillator {
    if (this.throwOnCreateOscillator) {
      throw new Error('创建 oscillator 失败');
    }
    const oscillator = new FakeOscillator();
    this.oscillators.push(oscillator);
    return oscillator;
  }

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

function expectTone(
  context: FakeAudioContext,
  type: OscillatorType,
  startFrequency: number,
  endFrequency: number,
  duration: number,
): void {
  const oscillator = context.oscillators[0]!;
  expect(oscillator.type).toBe(type);
  expect(oscillator.frequency.calls[0]).toEqual(['set', startFrequency, 4]);
  expect(oscillator.frequency.calls[1]?.slice(0, 2)).toEqual([
    'exponentialRamp',
    endFrequency,
  ]);
  expect(oscillator.frequency.calls[1]?.[2]).toBeCloseTo(4 + duration);
}

describe('合成音效', () => {
  it('保存并更新静音状态', () => {
    const audio = new SynthAudio(true);

    expect(audio.isMuted()).toBe(true);

    audio.setMuted(false);

    expect(audio.isMuted()).toBe(false);
  });

  it('解锁前不创建上下文且多次解锁只创建一次', async () => {
    let factoryCalls = 0;
    const audio = new SynthAudio(false, () => {
      factoryCalls += 1;
      return { state: 'running' } as unknown as AudioContext;
    });

    expect(factoryCalls).toBe(0);

    await audio.unlock();
    await audio.unlock();

    expect(factoryCalls).toBe(1);
  });

  it('解锁已暂停的上下文时等待恢复', async () => {
    let resumeCalls = 0;
    const context = {
      state: 'suspended',
      resume: async () => {
        resumeCalls += 1;
      },
    } as unknown as AudioContext;
    const audio = new SynthAudio(false, () => context);

    await audio.unlock();

    expect(resumeCalls).toBe(1);
  });

  it('上下文恢复失败时向解锁调用者拒绝', async () => {
    const failure = new Error('恢复失败');
    const context = {
      state: 'suspended',
      resume: async () => Promise.reject(failure),
    } as unknown as AudioContext;
    const audio = new SynthAudio(false, () => context);

    await expect(audio.unlock()).rejects.toBe(failure);
  });

  it('未解锁时播放不会提前创建上下文', () => {
    let factoryCalls = 0;
    const audio = new SynthAudio(false, () => {
      factoryCalls += 1;
      return new FakeAudioContext() as unknown as AudioContext;
    });

    audio.playStart();

    expect(factoryCalls).toBe(0);
  });

  it('静音时不会创建 oscillator', async () => {
    const context = new FakeAudioContext();
    const audio = new SynthAudio(true, () => context as unknown as AudioContext);
    await audio.unlock();

    audio.playStart();

    expect(context.oscillators).toHaveLength(0);
  });

  it('解除静音后开始音效生成完整频率与增益包络', async () => {
    const context = new FakeAudioContext();
    const audio = new SynthAudio(true, () => context as unknown as AudioContext);
    await audio.unlock();
    audio.setMuted(false);

    audio.playStart();

    expect(context.oscillators).toHaveLength(1);
    expect(context.gains).toHaveLength(1);
    const oscillator = context.oscillators[0]!;
    const gain = context.gains[0]!;
    expect(oscillator.type).toBe('triangle');
    expect(oscillator.frequency.calls).toEqual([
      ['set', 260, 4],
      ['exponentialRamp', 620, 4.12],
    ]);
    expect(gain.gain.calls).toEqual([
      ['set', 0.0001, 4],
      ['exponentialRamp', 0.12, 4.01],
      ['exponentialRamp', 0.0001, 4.12],
    ]);
    expect(oscillator.connections).toEqual([gain]);
    expect(gain.connections).toEqual([context.destination]);
    expect(oscillator.starts).toEqual([4]);
    expect(oscillator.stops[0]).toBeCloseTo(4.14);
  });

  it.each([
    [
      '吃到食物',
      { type: 'foodEaten', at: { x: 2, y: 3 }, score: 1 },
      'sine',
      520,
      760,
      0.08,
    ],
    [
      '速度提升',
      { type: 'speedChanged', level: 2, tickMs: 120 },
      'triangle',
      640,
      1040,
      0.14,
    ],
    ['游戏结束', { type: 'gameOver', at: { x: 4, y: 5 } }, 'sawtooth', 180, 55, 0.28],
    ['完成游戏', { type: 'completed', score: 99 }, 'triangle', 520, 1320, 0.42],
  ] as const)(
    '%s 事件产生指定音色和频率',
    async (_label, event, type, startFrequency, endFrequency, duration) => {
      const context = new FakeAudioContext();
      const audio = new SynthAudio(false, () => context as unknown as AudioContext);
      await audio.unlock();

      audio.playEvent(event as GameEvent);

      expectTone(context, type, startFrequency, endFrequency, duration);
    },
  );

  it('暂停音效产生短促的方波降调', async () => {
    const context = new FakeAudioContext();
    const audio = new SynthAudio(false, () => context as unknown as AudioContext);
    await audio.unlock();

    audio.playPause();

    expectTone(context, 'square', 300, 220, 0.06);
  });

  it('转向音效在四十五毫秒内限流且边界时刻允许播放', async () => {
    const context = new FakeAudioContext();
    let now = 1_000;
    const audio = new SynthAudio(
      false,
      () => context as unknown as AudioContext,
      () => now,
    );
    await audio.unlock();

    audio.playTurn();
    expect(context.oscillators).toHaveLength(1);
    expectTone(context, 'sine', 420, 480, 0.035);

    now = 1_044;
    audio.playTurn();
    expect(context.oscillators).toHaveLength(1);

    now = 1_045;
    audio.playTurn();
    expect(context.oscillators).toHaveLength(2);
  });

  it('合成节点抛错不会向游戏调用者传播', async () => {
    const context = new FakeAudioContext();
    context.throwOnCreateOscillator = true;
    const audio = new SynthAudio(false, () => context as unknown as AudioContext);
    await audio.unlock();

    expect(() => audio.playStart()).not.toThrow();
  });
});
