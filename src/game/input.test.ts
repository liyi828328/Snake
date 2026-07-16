import { describe, expect, it } from 'vitest';

import { commandFromKey, KeyboardInput } from './input';
import type { InputCommand } from './input';

function createTestWindow(): { target: Window; dispose: () => void } {
  const frame = document.createElement('iframe');
  document.body.append(frame);

  return {
    target: frame.contentWindow!,
    dispose: () => frame.remove(),
  };
}

describe('按键命令映射', () => {
  it.each([
    ['ArrowUp', 'up'],
    ['ArrowDown', 'down'],
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
  ] as const)('将方向键 %s 映射为 %s', (key, direction) => {
    expect(commandFromKey(key)).toEqual({ type: 'direction', direction });
  });

  it.each([
    [' ', { type: 'togglePause' }],
    ['r', { type: 'restart' }],
    ['R', { type: 'restart' }],
    ['m', { type: 'toggleMute' }],
    ['M', { type: 'toggleMute' }],
  ] as const)('将控制键 %s 映射为对应命令', (key, command) => {
    expect(commandFromKey(key)).toEqual(command);
  });

  it.each(['w', 'W', 'a', 'A', 's', 'S', 'd', 'D'])(
    '明确拒绝 WASD 键 %s',
    (key) => {
      expect(commandFromKey(key)).toBeNull();
    },
  );

  it('其他按键不产生命令', () => {
    expect(commandFromKey('Enter')).toBeNull();
  });
});

describe('键盘输入监听', () => {
  it('启动后拦截受支持按键并只回调一次', () => {
    const { target, dispose } = createTestWindow();
    const received: InputCommand[] = [];
    const input = new KeyboardInput(target, (command) => received.push(command));

    try {
      input.start();

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        cancelable: true,
      });
      target.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(received).toEqual([{ type: 'direction', direction: 'left' }]);
    } finally {
      input.stop();
      dispose();
    }
  });

  it('不支持的按键既不拦截也不回调', () => {
    const { target, dispose } = createTestWindow();
    const received: InputCommand[] = [];
    const input = new KeyboardInput(target, (command) => received.push(command));

    try {
      input.start();

      const event = new KeyboardEvent('keydown', {
        key: 'w',
        cancelable: true,
      });
      target.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(received).toEqual([]);
    } finally {
      input.stop();
      dispose();
    }
  });

  it.each([' ', 'r', 'R', 'm', 'M'])(
    '重复的一次性控制键 %s 只拦截默认行为',
    (key) => {
      const { target, dispose } = createTestWindow();
      const received: InputCommand[] = [];
      const input = new KeyboardInput(target, (command) => received.push(command));

      try {
        input.start();

        const event = new KeyboardEvent('keydown', {
          key,
          repeat: true,
          cancelable: true,
        });
        target.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(received).toEqual([]);
      } finally {
        input.stop();
        dispose();
      }
    },
  );

  it('重复的方向键仍允许回调', () => {
    const { target, dispose } = createTestWindow();
    const received: InputCommand[] = [];
    const input = new KeyboardInput(target, (command) => received.push(command));

    try {
      input.start();

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        repeat: true,
        cancelable: true,
      });
      target.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(received).toEqual([{ type: 'direction', direction: 'left' }]);
    } finally {
      input.stop();
      dispose();
    }
  });

  it.each([
    ['Ctrl+R', { key: 'r', ctrlKey: true }],
    ['Meta+R', { key: 'R', metaKey: true }],
    ['Alt+ArrowLeft', { key: 'ArrowLeft', altKey: true }],
  ] as const)('%s 保留浏览器快捷键行为', (_label, init) => {
    const { target, dispose } = createTestWindow();
    const received: InputCommand[] = [];
    const input = new KeyboardInput(target, (command) => received.push(command));

    try {
      input.start();

      const event = new KeyboardEvent('keydown', {
        ...init,
        cancelable: true,
      });
      target.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(received).toEqual([]);
    } finally {
      input.stop();
      dispose();
    }
  });

  it.each([
    ['R', { type: 'restart' }],
    ['M', { type: 'toggleMute' }],
  ] as const)('Shift+%s 仍映射为控制命令', (key, command) => {
    const { target, dispose } = createTestWindow();
    const received: InputCommand[] = [];
    const input = new KeyboardInput(target, (receivedCommand) =>
      received.push(receivedCommand),
    );

    try {
      input.start();

      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey: true,
        cancelable: true,
      });
      target.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(received).toEqual([command]);
    } finally {
      input.stop();
      dispose();
    }
  });

  it('重复启动不会重复监听，停止后不再回调且可重复停止', () => {
    const { target, dispose } = createTestWindow();
    const received: InputCommand[] = [];
    const input = new KeyboardInput(target, (command) => received.push(command));

    try {
      input.start();
      input.start();

      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
      expect(received).toEqual([{ type: 'direction', direction: 'up' }]);

      input.stop();
      input.stop();
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));

      expect(received).toEqual([{ type: 'direction', direction: 'up' }]);
    } finally {
      input.stop();
      dispose();
    }
  });
});
