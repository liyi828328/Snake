import { describe, expect, it } from 'vitest';

import { QUALITY_PROFILES, QualityGovernor, selectProfile } from './quality';
import { THEME } from './theme';

describe('自适应视觉质量', () => {
  it('减少动态仅覆盖当前档位且关闭后恢复 governor 档位', () => {
    const governor = new QualityGovernor('high', false);

    expect(selectProfile(true, governor.profile)).toBe(QUALITY_PROFILES.low);
    expect(selectProfile(false, governor.profile)).toBe(QUALITY_PROFILES.high);
    expect(governor.level).toBe('high');
  });

  it('提供高、中、低三档固定渲染配置', () => {
    expect(QUALITY_PROFILES).toEqual({
      high: {
        particleLimit: 160,
        backgroundParticles: 72,
        blurQuality: 3,
        shake: true,
      },
      medium: {
        particleLimit: 96,
        backgroundParticles: 40,
        blurQuality: 2,
        shake: true,
      },
      low: {
        particleLimit: 24,
        backgroundParticles: 14,
        blurQuality: 1,
        shake: false,
      },
    });
  });

  it('高质量连续九十帧平均十八毫秒时降为中质量', () => {
    const governor = new QualityGovernor();

    for (let frame = 0; frame < 90; frame += 1) {
      governor.sample(18);
    }

    expect(governor.level).toBe('medium');
  });

  it('中质量连续九十帧平均二十毫秒时降为低质量', () => {
    const governor = new QualityGovernor('medium');

    for (let frame = 0; frame < 90; frame += 1) {
      governor.sample(20);
    }

    expect(governor.level).toBe('low');
  });

  it('高质量平均帧时恰好十四毫秒时不降级', () => {
    const governor = new QualityGovernor();

    for (let frame = 0; frame < 90; frame += 1) {
      governor.sample(14);
    }

    expect(governor.level).toBe('high');
  });

  it('中质量平均帧时恰好十九毫秒时不降级', () => {
    const governor = new QualityGovernor('medium');

    for (let frame = 0; frame < 90; frame += 1) {
      governor.sample(19);
    }

    expect(governor.level).toBe('medium');
  });

  it('中质量连续二百四十个快速有效帧后升为高质量', () => {
    const governor = new QualityGovernor('medium');

    for (let frame = 0; frame < 240; frame += 1) {
      governor.sample(7);
    }

    expect(governor.level).toBe('high');
  });

  it('低质量一批快速帧只升一级且提升后重新计数', () => {
    const governor = new QualityGovernor('low');

    for (let frame = 0; frame < 240; frame += 1) {
      governor.sample(7);
    }

    expect(governor.level).toBe('medium');

    for (let frame = 0; frame < 239; frame += 1) {
      governor.sample(7);
    }

    expect(governor.level).toBe('medium');
    governor.sample(7);
    expect(governor.level).toBe('high');
  });

  it('快速帧中插入九毫秒有效帧会重置连续计数', () => {
    const governor = new QualityGovernor('medium');

    for (let frame = 0; frame < 239; frame += 1) {
      governor.sample(7);
    }

    governor.sample(9);
    expect(governor.level).toBe('medium');

    for (let frame = 0; frame < 239; frame += 1) {
      governor.sample(7);
    }

    expect(governor.level).toBe('medium');
    governor.sample(7);
    expect(governor.level).toBe('high');
  });

  it('减少动态效果时固定使用低质量配置且永不升级', () => {
    const governor = new QualityGovernor('high', true);

    expect(governor.level).toBe('low');
    expect(governor.profile).toMatchObject({
      particleLimit: 24,
      blurQuality: 1,
      shake: false,
    });

    for (let frame = 0; frame < 480; frame += 1) {
      governor.sample(7);
    }

    expect(governor.level).toBe('low');
    expect(governor.profile).toBe(QUALITY_PROFILES.low);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -1,
    0,
  ])('无效帧时 %s 不进入平均窗口也不打断连续快帧', (invalidFrameMs) => {
    const slowGovernor = new QualityGovernor();

    for (let frame = 0; frame < 89; frame += 1) {
      slowGovernor.sample(18);
    }

    slowGovernor.sample(invalidFrameMs);
    expect(slowGovernor.level).toBe('high');
    slowGovernor.sample(18);
    expect(slowGovernor.level).toBe('medium');

    const fastGovernor = new QualityGovernor('medium');

    for (let frame = 0; frame < 239; frame += 1) {
      fastGovernor.sample(7);
    }

    fastGovernor.sample(invalidFrameMs);
    expect(fastGovernor.level).toBe('medium');
    fastGovernor.sample(7);
    expect(fastGovernor.level).toBe('high');
  });

  it('提供霓虹主题色与三十二乘二十四棋盘尺寸', () => {
    expect(THEME).toEqual({
      background: 0x020611,
      board: 0x030817,
      grid: 0x1ceaff,
      cyan: 0x45f4ff,
      magenta: 0xe45bff,
      food: 0xff3b8d,
      white: 0xf1ffff,
      gridAlpha: 0.075,
      boardColumns: 32,
      boardRows: 24,
    });
  });
});
