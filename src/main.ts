import { bootstrapGame } from './bootstrap';
import './styles.css';

const app = document.querySelector<HTMLDivElement>('#app');

if (!app) {
  throw new Error('找不到应用根节点，无法启动游戏');
}

await bootstrapGame({ root: app });
