import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, isCardLegal, isFunctional, validateGroup } from '../js/rules.js';
import { MakaoGame } from '../js/game.js';
import { chooseBotPlay, chooseJackDemand } from '../js/bot.js';

function card(rank, suit) {
  return { id: `${rank}-${suit}`, rank, suit };
}

function state(top, extra = {}) {
  return {
    discardPile: [top],
    pendingDraw: null,
    pendingSkip: null,
    jackDemand: null,
    aceDemand: null,
    ...extra,
  };
}

test('talia ma dokładnie 52 karty i nie zawiera jokerów', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52);
  assert.equal(deck.some((c) => c.rank === 'JOKER'), false);
});

test('króle kier i pik są funkcyjne, trefl i karo są zwykłe', () => {
  assert.equal(isFunctional(card('K', 'hearts')), true);
  assert.equal(isFunctional(card('K', 'spades')), true);
  assert.equal(isFunctional(card('K', 'clubs')), false);
  assert.equal(isFunctional(card('K', 'diamonds')), false);
});

test('dama jest dzika w zwykłej grze', () => {
  const s = state(card('7', 'clubs'));
  assert.equal(isCardLegal(card('Q', 'diamonds'), s, 0), true);
  assert.equal(isCardLegal(card('9', 'hearts'), state(card('Q', 'spades')), 0), true);
});

test('dama nie omija aktywnej kary ani żądania', () => {
  assert.equal(isCardLegal(card('Q', 'hearts'), state(card('2', 'clubs'), { pendingDraw: { amount: 2, targetIndex: 0 } }), 0), false);
  assert.equal(isCardLegal(card('Q', 'hearts'), state(card('J', 'clubs'), { jackDemand: { rank: '8', byIndex: 1 } }), 0), false);
  assert.equal(isCardLegal(card('Q', 'hearts'), state(card('A', 'clubs'), { aceDemand: { suit: 'clubs', targetIndex: 0 } }), 0), false);
});

test('przy karze z 2/3 wolno odpowiedzieć tylko 2/3 pasującą kolorem lub wartością', () => {
  const s = state(card('2', 'hearts'), { pendingDraw: { amount: 2, targetIndex: 0 } });
  assert.equal(isCardLegal(card('3', 'hearts'), s, 0), true);
  assert.equal(isCardLegal(card('2', 'clubs'), s, 0), true);
  assert.equal(isCardLegal(card('3', 'spades'), s, 0), false);
  assert.equal(isCardLegal(card('4', 'hearts'), s, 0), false);
});

test('wariant wielokartowy dopuszcza 1, 3 lub 4, ale nie parę', () => {
  const s = state(card('9', 'hearts'));
  const one = [card('9', 'clubs')];
  const pair = [card('9', 'clubs'), card('9', 'spades')];
  const triple = [card('9', 'clubs'), card('9', 'spades'), card('9', 'diamonds')];
  const four = [...triple, card('9', 'hearts')];
  assert.equal(validateGroup(one, s, 0).ok, true);
  assert.equal(validateGroup(pair, s, 0).ok, false);
  assert.equal(validateGroup(triple, s, 0).ok, true);
  assert.equal(validateGroup(four, s, 0).ok, true);
});

test('grupa może rozpocząć się kartą pasującą, a kolejne są tej samej wartości', () => {
  const s = state(card('6', 'hearts'));
  const group = [card('8', 'hearts'), card('8', 'clubs'), card('8', 'spades')];
  assert.equal(validateGroup(group, s, 0).ok, true);
});

test('kilka dwójek i trójek sumuje karę według łącznej liczby oczek', () => {
  const game = new MakaoGame();
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.discardPile = [card('7', 'clubs')];

  game.applyCardEffects(0, [card('2', 'hearts'), card('2', 'spades'), card('2', 'diamonds')], { type: 'normal' });
  assert.equal(game.state.pendingDraw.amount, 6);

  game.applyCardEffects(1, [card('3', 'clubs'), card('3', 'hearts'), card('3', 'spades')], { type: 'draw' });
  assert.equal(game.state.pendingDraw.amount, 15);
});

test('król kier daje tylko +5 kart bez utraty tury', () => {
  const game = new MakaoGame();
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.players[1].hand = [card('5', 'clubs')];
  game.state.drawPile = [card('6', 'diamonds'), card('7', 'spades'), card('8', 'hearts'), card('9', 'clubs'), card('10', 'diamonds')];
  game.state.discardPile = [card('7', 'clubs')];

  game.applyCardEffects(0, [card('K', 'hearts')], { type: 'normal' });
  assert.equal(game.state.players[1].hand.length, 6);
  assert.equal(game.state.players[1].blockedTurns, 0);
});


test('walet może żądać tylko wartości 5–10 posiadanej w ręce, a bot może wybrać brak żądania', () => {
  assert.equal(chooseJackDemand([card('A', 'hearts'), card('K', 'clubs')]), null);
  assert.equal(chooseJackDemand([card('7', 'hearts'), card('7', 'clubs'), card('9', 'spades')]), '7');

  let message = '';
  const game = new MakaoGame({ onMessage: (text) => { message = text; } });
  game.state.started = true;
  game.state.gameOver = true;
  game.state.players = game.createPlayers(2);
  game.state.players[0].hand = [card('7', 'hearts'), card('A', 'clubs')];
  game.state.pendingChoice = { type: 'jack', actorIndex: 0 };

  game.choosePending('8');
  assert.equal(game.state.pendingChoice?.type, 'jack');
  assert.equal(game.state.jackDemand, null);
  assert.match(message, /którą masz w ręce/);

  game.choosePending('7');
  assert.equal(game.state.jackDemand.rank, '7');
  assert.equal(game.state.pendingChoice, null);

  game.state.pendingChoice = { type: 'jack', actorIndex: 0 };
  game.choosePending(null);
  assert.equal(game.state.jackDemand, null);
  assert.equal(game.state.pendingChoice, null);
});

test('zaległa blokada nie omija aktywnej kary dobierania 2/3', () => {
  const game = new MakaoGame();
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.currentIndex = 2; // Oskar
  game.state.players[2].hand = [card('7', 'clubs')];
  game.state.players[2].blockedTurns = 1;
  game.state.pendingDraw = { amount: 2, targetIndex: 2 };
  game.state.drawPile = [card('8', 'hearts'), card('9', 'diamonds')];

  game.queueCurrentTurn();
  clearTimeout(game.timer);

  assert.equal(game.state.players[2].blockedTurns, 0);
  assert.equal(game.state.pendingDraw, null);
  assert.equal(game.state.players[2].hand.length, 3);
  assert.match(game.state.log[0].message, /traci kolejkę i dobiera 2 kart za karę/);
});

test('bot przy żądaniu waleta preferuje żądaną wartość zamiast kolejnego waleta', () => {
  const bot = { hand: [card('J', 'hearts'), card('7', 'clubs'), card('9', 'spades')] };
  const s = state(card('J', 'diamonds'), { jackDemand: { rank: '7', byIndex: 1 } });
  const play = chooseBotPlay(bot, s, 0);
  assert.equal(play[0].rank, '7');
});

test('bot odpowiadający waletem na waleta wybiera potem brak żądania', () => {
  const game = new MakaoGame();
  game.queueCurrentTurn = () => {};
  game.state.started = true;
  game.state.players = game.createPlayers(2);
  game.state.jackDemand = { rank: '8', byIndex: 0 };
  game.state.players[1].hand = [card('6', 'clubs')];
  game.applyCardEffects(1, [card('J', 'hearts')], { type: 'jack', rank: '8' });
  assert.equal(game.state.jackDemand, null);
});

test('nowa gra ma 1 gracza + 2/3 boty, po 5 kart i zwykłą kartę startową', () => {
  for (const bots of [2, 3]) {
    const game = new MakaoGame();
    game.start(bots);
    clearTimeout(game.timer);
    assert.equal(game.state.players.length, bots + 1);
    assert.equal(game.state.players.every((p) => p.hand.length === 5), true);
    assert.equal(isFunctional(game.state.discardPile.at(-1)), false);
  }
});
