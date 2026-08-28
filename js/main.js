import { MakaoGame } from './game.js';
import { MakaoUI } from './ui.js';
import { installUxEffects } from './ux-effects.js';

let ui;
const game = new MakaoGame({
  onChange: (state) => ui?.render(state),
  onMessage: (message) => ui?.showToast(message),
});

ui = new MakaoUI(game);
installUxEffects(game, ui);
ui.render(game.state);

window.makaoGame = game;
