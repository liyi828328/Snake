import type { Direction } from './types';

export type InputCommand =
  | { readonly type: 'direction'; readonly direction: Direction }
  | { readonly type: 'togglePause' }
  | { readonly type: 'restart' }
  | { readonly type: 'toggleMute' };

export function commandFromKey(key: string): InputCommand | null {
  switch (key) {
    case 'ArrowUp':
      return { type: 'direction', direction: 'up' };
    case 'ArrowDown':
      return { type: 'direction', direction: 'down' };
    case 'ArrowLeft':
      return { type: 'direction', direction: 'left' };
    case 'ArrowRight':
      return { type: 'direction', direction: 'right' };
    case ' ':
      return { type: 'togglePause' };
    case 'r':
    case 'R':
      return { type: 'restart' };
    case 'm':
    case 'M':
      return { type: 'toggleMute' };
    default:
      return null;
  }
}

export class KeyboardInput {
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const command = commandFromKey(event.key);
    if (command === null) {
      return;
    }

    if (event.repeat && command.type !== 'direction') {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    this.onCommand(command);
  };

  constructor(
    private readonly target: Window,
    private readonly onCommand: (command: InputCommand) => void,
  ) {}

  start(): void {
    this.target.addEventListener('keydown', this.handleKeyDown);
  }

  stop(): void {
    this.target.removeEventListener('keydown', this.handleKeyDown);
  }
}
