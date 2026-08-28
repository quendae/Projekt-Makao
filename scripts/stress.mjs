import { MakaoGame } from '../js/game.js';
import { chooseAceSuit, chooseBotPlay, chooseJackDemand } from '../js/bot.js';
import { cardLabel, getTurnConstraint, isCardLegal, validateGroup } from '../js/rules.js';

const gameCount = Math.max(1, Number.parseInt(process.argv[2] ?? '500', 10) || 500);
const baseSeed = Number.parseInt(process.argv[3] ?? '12648430', 10) >>> 0;
const MAX_STEPS = 5000;

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function snapshotCards(state) {
  return [
    ...state.drawPile,
    ...state.discardPile,
    ...state.players.flatMap((player) => player.hand),
  ];
}

function assertInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

function describeState(game) {
  const { state } = game;
  const current = state.players[state.currentIndex];
  const top = state.discardPile.at(-1);
  const playerLines = state.players.map((player, index) => {
    const hand = player.hand.map(cardLabel).join(' ');
    return `  [${index}] ${player.name}: hand=${player.hand.length}, blocked=${player.blockedTurns}, finish=${player.finishPlace ?? '-'} :: ${hand}`;
  });
  const recentLog = state.log.slice(0, 30).reverse().map((entry) => `  ${entry.message}`);

  return [
    `turn=${state.turnNumber}, current=${state.currentIndex}:${current?.name ?? '?'}, top=${top ? cardLabel(top) : '-'}, draw=${state.drawPile.length}, discard=${state.discardPile.length}`,
    `pendingDraw=${JSON.stringify(state.pendingDraw)}, pendingSkip=${JSON.stringify(state.pendingSkip)}, jack=${JSON.stringify(state.jackDemand)}, ace=${JSON.stringify(state.aceDemand)}, choice=${JSON.stringify(state.pendingChoice)}`,
    `standings=${JSON.stringify(state.standings)}`,
    ...playerLines,
    'last log entries (oldest -> newest):',
    ...recentLog,
  ].join('\n');
}

function checkState(game, step) {
  const { state } = game;
  const cards = snapshotCards(state);
  const ids = cards.map((card) => card?.id);

  assertInvariant(cards.length === 52, `krok ${step}: w grze jest ${cards.length} kart zamiast 52`);
  assertInvariant(ids.every(Boolean), `krok ${step}: znaleziono kartę bez id`);
  assertInvariant(new Set(ids).size === 52, `krok ${step}: wykryto zduplikowaną lub zaginioną kartę`);
  assertInvariant(state.discardPile.length >= 1, `krok ${step}: stos kart odrzuconych jest pusty`);
  assertInvariant(state.players.every((player) => player.blockedTurns >= 0), `krok ${step}: ujemna liczba blokad`);

  if (!state.gameOver) {
    const current = state.players[state.currentIndex];
    assertInvariant(Boolean(current), `krok ${step}: currentIndex wskazuje poza listę graczy`);
    assertInvariant(current.finishPlace == null, `krok ${step}: tura należy do gracza, który już skończył`);
  }

  if (state.pendingDraw) {
    assertInvariant(Number.isInteger(state.pendingDraw.amount) && state.pendingDraw.amount > 0, `krok ${step}: błędna kara dobierania`);
    assertInvariant(Boolean(state.players[state.pendingDraw.targetIndex]), `krok ${step}: kara dobierania ma błędny cel`);
  }

  if (state.pendingSkip) {
    assertInvariant(Number.isInteger(state.pendingSkip.count) && state.pendingSkip.count > 0, `krok ${step}: błędna blokada`);
    assertInvariant(Boolean(state.players[state.pendingSkip.targetIndex]), `krok ${step}: blokada ma błędny cel`);
  }

  if (state.jackDemand) {
    assertInvariant(['5', '6', '7', '8', '9', '10'].includes(state.jackDemand.rank), `krok ${step}: walet żąda niedozwolonej wartości ${state.jackDemand.rank}`);
  }

  if (state.aceDemand) {
    assertInvariant(['clubs', 'diamonds', 'hearts', 'spades'].includes(state.aceDemand.suit), `krok ${step}: as żąda niedozwolonego koloru`);
    assertInvariant(Boolean(state.players[state.aceDemand.targetIndex]), `krok ${step}: żądanie asa ma błędny cel`);
  }
}

function finishChoice(game) {
  const choice = game.state.pendingChoice;
  if (!choice) return false;
  const actor = game.state.players[choice.actorIndex];
  assertInvariant(Boolean(actor), 'pendingChoice wskazuje nieistniejącego gracza');

  if (choice.type === 'jack') {
    game.choosePending(chooseJackDemand(actor.hand));
    return true;
  }

  if (choice.type === 'ace') {
    game.choosePending(chooseAceSuit(actor.hand));
    return true;
  }

  throw new Error(`nieznany pendingChoice: ${choice.type}`);
}

function playOneStep(game) {
  if (finishChoice(game)) return;

  const { state } = game;
  const playerIndex = state.currentIndex;
  const player = state.players[playerIndex];
  assertInvariant(Boolean(player), 'brak bieżącego gracza');

  // Odwzorowanie queueCurrentTurn bez timerów. Zaległa blokada nie może
  // skasować kary 2/3; zablokowany gracz dobiera karę i traci turę.
  if (player.blockedTurns > 0 && !game.isPendingSkipFor(playerIndex)) {
    player.blockedTurns -= 1;
    if (game.isPendingDrawFor(playerIndex)) {
      const amount = state.pendingDraw.amount;
      state.pendingDraw = null;
      game.drawCards(playerIndex, amount);
    }
    game.endTurn(playerIndex);
    return;
  }

  const constraint = getTurnConstraint(state, playerIndex);
  const play = chooseBotPlay(player, state, playerIndex);

  if (play) {
    const validation = validateGroup(play, state, playerIndex);
    assertInvariant(validation.ok, `AI wybrało nielegalne zagranie: ${validation.reason ?? 'brak powodu'}`);
    game.playCards(playerIndex, play);
    return;
  }

  if (constraint.type === 'draw') {
    const amount = state.pendingDraw.amount;
    state.pendingDraw = null;
    game.drawCards(playerIndex, amount);
    game.endTurn(playerIndex);
    return;
  }

  if (constraint.type === 'skip') {
    game.acceptSkip(playerIndex);
    return;
  }

  const drawn = game.drawCards(playerIndex, 1)[0];
  if (drawn && isCardLegal(drawn, state, playerIndex)) {
    const validation = validateGroup([drawn], state, playerIndex, { rescueOnly: true });
    assertInvariant(validation.ok, `dobrana legalna karta nie przechodzi validateGroup: ${validation.reason ?? 'brak powodu'}`);
    game.playCards(playerIndex, [drawn], { fromRescue: true });
  } else {
    game.endTurn(playerIndex);
  }
}

function finalChecks(game, steps) {
  const { state } = game;
  assertInvariant(state.gameOver, `partia nie zakończyła się po ${steps} krokach\n${describeState(game)}`);
  assertInvariant(state.standings.length === state.players.length, 'klasyfikacja nie zawiera wszystkich graczy');
  assertInvariant(new Set(state.standings).size === state.players.length, 'klasyfikacja zawiera duplikaty');

  const places = state.players.map((player) => player.finishPlace).sort((a, b) => a - b);
  const expected = Array.from({ length: state.players.length }, (_, index) => index + 1);
  assertInvariant(JSON.stringify(places) === JSON.stringify(expected), `błędne miejsca końcowe: ${places.join(', ')}`);
}

function runGame(index) {
  const seed = (baseSeed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);
  let game = null;

  try {
    game = new MakaoGame();
    // Stress runner sam steruje turami synchronicznie; wyłączamy timery/UI.
    game.queueCurrentTurn = () => {};
    const botCount = index % 2 === 0 ? 2 : 3;
    game.start(botCount);
    clearTimeout(game.timer);

    let steps = 0;
    let maxHand = Math.max(...game.state.players.map((player) => player.hand.length));

    while (!game.state.gameOver && steps < MAX_STEPS) {
      checkState(game, steps);
      playOneStep(game);
      steps += 1;
      maxHand = Math.max(maxHand, ...game.state.players.map((player) => player.hand.length));
    }

    checkState(game, steps);
    finalChecks(game, steps);
    return { seed, botCount, steps, turns: game.state.turnNumber, maxHand };
  } catch (error) {
    error.seed = seed;
    if (game && !String(error.message).includes('last log entries')) {
      error.message += `\n${describeState(game)}`;
    }
    throw error;
  } finally {
    Math.random = originalRandom;
  }
}

const stats = {
  completed: 0,
  totalSteps: 0,
  maxSteps: 0,
  maxHand: 0,
  twoBots: 0,
  threeBots: 0,
};

console.log(`MAKAO stress: ${gameCount} partii, base seed ${baseSeed}`);

for (let index = 0; index < gameCount; index += 1) {
  try {
    const result = runGame(index);
    stats.completed += 1;
    stats.totalSteps += result.steps;
    stats.maxSteps = Math.max(stats.maxSteps, result.steps);
    stats.maxHand = Math.max(stats.maxHand, result.maxHand);
    if (result.botCount === 2) stats.twoBots += 1;
    else stats.threeBots += 1;

    if ((index + 1) % 100 === 0 || index + 1 === gameCount) {
      console.log(`  ${index + 1}/${gameCount} OK`);
    }
  } catch (error) {
    console.error(`\nFAIL w partii ${index + 1}/${gameCount}, seed=${error.seed}`);
    console.error(error.stack ?? error);
    console.error(`Odtwórz tę samą serię do awarii: npm run stress -- ${index + 1} ${baseSeed}`);
    console.error(`Dokładny seed wadliwej partii: ${error.seed}`);
    process.exitCode = 1;
    break;
  }
}

if (!process.exitCode) {
  console.log('\nStress test OK');
  console.log(`  ukończone partie: ${stats.completed}`);
  console.log(`  1 gracz + 2 boty: ${stats.twoBots}`);
  console.log(`  1 gracz + 3 boty: ${stats.threeBots}`);
  console.log(`  średnio kroków/partię: ${(stats.totalSteps / stats.completed).toFixed(1)}`);
  console.log(`  najdłuższa partia: ${stats.maxSteps} kroków`);
  console.log(`  największa ręka: ${stats.maxHand} kart`);
}
