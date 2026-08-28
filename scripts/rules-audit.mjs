import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MakaoGame } from '../js/game.js';
import { chooseBotPlay, chooseJackDemand } from '../js/bot.js';
import {
  createDeck,
  isCardLegal,
  isFunctional,
  recycleDiscardIntoDrawPile,
  validateGroup,
} from '../js/rules.js';

const contract = JSON.parse(fs.readFileSync(new URL('../rules/rules-contract.json', import.meta.url), 'utf8'));

const card = (rank, suit) => ({ id: `${rank}-${suit}`, rank, suit });
const quietGame = (bots = 2) => {
  const game = new MakaoGame();
  game.queueCurrentTurn = () => {};
  game.state.started = true;
  game.state.players = game.createPlayers(bots);
  game.state.currentIndex = 0;
  game.state.discardPile = [card('9', 'clubs')];
  return game;
};
const ruleState = (top, extra = {}) => ({
  discardPile: [top], pendingDraw: null, pendingSkip: null, jackDemand: null, aceDemand: null, ...extra,
});

const checks = {
  R01_DECK() {
    const deck = createDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck.map((c) => c.id)).size, 52);
    assert.equal(deck.some((c) => c.rank === 'JOKER'), false);
  },

  R02_DEAL() {
    for (const bots of [2, 3]) {
      const game = new MakaoGame();
      game.queueCurrentTurn = () => {};
      game.start(bots);
      clearTimeout(game.timer);
      assert.equal(game.state.players.length, bots + 1);
      assert.equal(game.state.players.every((p) => p.hand.length === 5), true);
      assert.equal(isFunctional(game.state.discardPile.at(-1)), false);
    }
  },

  R03_BASIC_MATCH() {
    const s = ruleState(card('7', 'diamonds'));
    assert.equal(isCardLegal(card('7', 'clubs'), s, 0), true);
    assert.equal(isCardLegal(card('10', 'diamonds'), s, 0), true);
    assert.equal(isCardLegal(card('10', 'clubs'), s, 0), false);
  },

  R04_MULTI_PLAY() {
    const s = ruleState(card('9', 'hearts'));
    const one = [card('9', 'clubs')];
    const pair = [card('9', 'clubs'), card('9', 'spades')];
    const triple = [card('9', 'clubs'), card('9', 'spades'), card('9', 'diamonds')];
    const four = [...triple, card('9', 'hearts')];
    assert.equal(validateGroup(one, s, 0).ok, true);
    assert.equal(validateGroup(pair, s, 0).ok, false);
    assert.equal(validateGroup(triple, s, 0).ok, true);
    assert.equal(validateGroup(four, s, 0).ok, true);
    assert.equal(validateGroup([card('7', 'hearts'), card('8', 'hearts'), card('9', 'hearts')], s, 0).ok, false);
  },

  R05_FIRST_CARD_RESCUES() {
    const game = quietGame();
    game.state.discardPile = [card('7', 'clubs')];
    game.state.players[0].hand = [card('5', 'spades'), card('10', 'diamonds'), card('K', 'clubs')];
    game.state.drawPile = [card('6', 'spades'), card('7', 'hearts')];
    game.humanDraw();
    assert.equal(game.state.drawnRescueCardId, '7-hearts');
    assert.equal(game.state.currentIndex, 0);
    const result = game.humanPlay(['7-hearts']);
    assert.equal(result.ok, true);
    assert.equal(game.state.discardPile.at(-1).id, '7-hearts');
  },

  R06_DRAW_2_3() {
    const s = ruleState(card('2', 'diamonds'), { pendingDraw: { amount: 2, targetIndex: 0 } });
    assert.equal(isCardLegal(card('2', 'clubs'), s, 0), true);
    assert.equal(isCardLegal(card('3', 'diamonds'), s, 0), true);
    assert.equal(isCardLegal(card('3', 'spades'), s, 0), false);

    const game = quietGame();
    game.applyCardEffects(0, [card('2', 'hearts'), card('2', 'spades'), card('2', 'diamonds')], { type: 'normal' });
    assert.equal(game.state.pendingDraw.amount, 6);
    game.state.currentIndex = 1;
    game.applyCardEffects(1, [card('3', 'clubs'), card('3', 'hearts'), card('3', 'spades')], { type: 'draw' });
    assert.equal(game.state.pendingDraw.amount, 15);
  },

  R07_FOUR() {
    const s = ruleState(card('4', 'diamonds'), { pendingSkip: { count: 1, targetIndex: 0 } });
    assert.equal(isCardLegal(card('4', 'clubs'), s, 0), true);
    assert.equal(isCardLegal(card('7', 'diamonds'), s, 0), false);
    const game = quietGame();
    game.applyCardEffects(0, [card('4', 'hearts'), card('4', 'spades'), card('4', 'diamonds')], { type: 'normal' });
    assert.equal(game.state.pendingSkip.count, 3);
  },

  R08_JACK() {
    const game = quietGame();
    game.state.players[0].hand = [card('7', 'clubs'), card('9', 'hearts')];
    game.state.pendingChoice = { type: 'jack', actorIndex: 0 };
    game.choosePending('8');
    assert.equal(game.state.pendingChoice?.type, 'jack');
    assert.equal(game.state.jackDemand, null);
    game.choosePending('7');
    assert.equal(game.state.jackDemand.rank, '7');

    assert.equal(chooseJackDemand([card('K', 'clubs'), card('A', 'hearts')]), null);
    const bot = { hand: [card('J', 'hearts'), card('7', 'clubs'), card('9', 'spades')] };
    const play = chooseBotPlay(bot, ruleState(card('J', 'diamonds'), { jackDemand: { rank: '7', byIndex: 1 } }), 0);
    assert.equal(play[0].rank, '7');
  },

  R09_QUEEN() {
    assert.equal(isCardLegal(card('Q', 'spades'), ruleState(card('7', 'diamonds')), 0), true);
    assert.equal(isCardLegal(card('8', 'clubs'), ruleState(card('Q', 'hearts')), 0), true);
    assert.equal(isCardLegal(card('Q', 'spades'), ruleState(card('2', 'diamonds'), { pendingDraw: { amount: 2, targetIndex: 0 } }), 0), false);
    assert.equal(isCardLegal(card('Q', 'spades'), ruleState(card('J', 'diamonds'), { jackDemand: { rank: '7', byIndex: 1 } }), 0), false);
    assert.equal(isCardLegal(card('Q', 'spades'), ruleState(card('A', 'diamonds'), { aceDemand: { suit: 'diamonds', targetIndex: 0 } }), 0), false);
  },

  R10_ACE() {
    const s = ruleState(card('A', 'clubs'), { aceDemand: { suit: 'hearts', targetIndex: 0, byIndex: 1 } });
    assert.equal(isCardLegal(card('8', 'hearts'), s, 0), true);
    assert.equal(isCardLegal(card('A', 'diamonds'), s, 0), true);
    assert.equal(isCardLegal(card('8', 'spades'), s, 0), false);
  },

  R11_KINGS() {
    const game = quietGame(3);
    game.state.players.forEach((p) => { p.hand = []; });
    game.state.drawPile = createDeck().filter((c) => !['K-hearts', 'K-spades', 'K-clubs', 'K-diamonds'].includes(c.id)).slice(0, 20);
    game.applyCardEffects(0, [card('K', 'hearts')], { type: 'normal' });
    assert.equal(game.state.players[1].hand.length, 5);
    game.applyCardEffects(0, [card('K', 'spades')], { type: 'normal' });
    assert.equal(game.state.players[3].hand.length, 5);
    const before = game.state.players.map((p) => p.hand.length);
    game.applyCardEffects(0, [card('K', 'clubs')], { type: 'normal' });
    game.applyCardEffects(0, [card('K', 'diamonds')], { type: 'normal' });
    assert.deepEqual(game.state.players.map((p) => p.hand.length), before);
  },

  R12_MAKAO() {
    const penalized = quietGame();
    penalized.state.discardPile = [card('7', 'clubs')];
    penalized.state.players[0].hand = [card('7', 'hearts'), card('9', 'spades')];
    penalized.state.drawPile = [card('5', 'clubs'), card('6', 'clubs'), card('8', 'clubs'), card('10', 'clubs'), card('K', 'clubs')];
    penalized.humanPlay(['7-hearts']);
    assert.equal(penalized.state.players[0].hand.length, 6);

    const declared = quietGame();
    declared.state.discardPile = [card('7', 'clubs')];
    declared.state.players[0].hand = [card('7', 'hearts'), card('9', 'spades')];
    declared.state.drawPile = [card('5', 'clubs'), card('6', 'clubs'), card('8', 'clubs'), card('10', 'clubs'), card('K', 'clubs')];
    declared.state.makaoArmed = true;
    declared.humanPlay(['7-hearts']);
    assert.equal(declared.state.players[0].hand.length, 1);
  },

  R13_RECYCLE() {
    const state = { drawPile: [], discardPile: [card('5', 'clubs'), card('7', 'hearts'), card('9', 'spades')] };
    const top = state.discardPile.at(-1).id;
    assert.equal(recycleDiscardIntoDrawPile(state, () => 0.5), true);
    assert.equal(state.discardPile.length, 1);
    assert.equal(state.discardPile[0].id, top);
    assert.equal(state.drawPile.length, 2);
  },

  R14_FINISH_ORDER() {
    const game = quietGame(3);
    game.finishPlayer(0);
    assert.equal(game.state.gameOver, false);
    game.finishPlayer(1);
    assert.equal(game.state.gameOver, false);
    game.finishPlayer(2);
    assert.equal(game.state.gameOver, true);
    assert.equal(game.state.standings.length, 4);
    assert.deepEqual(game.state.players.map((p) => p.finishPlace).sort((a, b) => a - b), [1, 2, 3, 4]);
  },
};

let failures = 0;
console.log(`Makao rules audit — contract ${contract.version}`);

for (const rule of contract.rules) {
  if (rule.status === 'review') {
    console.log(`REVIEW  ${rule.id}: ${rule.projectRule}`);
    continue;
  }

  const check = checks[rule.id];
  if (!check) {
    failures += 1;
    console.error(`BUG     ${rule.id}: enforced rule has no executable conformance check`);
    continue;
  }

  try {
    check();
    console.log(`OK      ${rule.id}`);
  } catch (error) {
    failures += 1;
    console.error(`BUG     ${rule.id}: ${error.message}`);
  }
}

const divergences = contract.rules.filter((r) => r.sourceDivergence);
console.log(`\nKnown source divergences / selected variants: ${divergences.length}`);
for (const rule of divergences) console.log(`SOURCE  ${rule.id}: ${rule.basis}`);

if (failures) {
  console.error(`\nRules audit FAILED: ${failures} conformance problem(s).`);
  process.exitCode = 1;
} else {
  console.log('\nRules audit OK — no implementation discrepancy against enforced project rules.');
}
