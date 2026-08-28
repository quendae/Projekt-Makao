import { MakaoGame } from './game.js';
import { MakaoUI } from './ui.js';

let ui;
const game = new MakaoGame({
  onChange: (state) => ui?.render(state),
  onMessage: (message) => ui?.showToast(message),
});

ui = new MakaoUI(game);
ui.render(game.state);
window.makaoGame = game;
