import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, isCardLegal, isFunctional, validateGroup } from '../js/rules.js';
import { MakaoGame } from '../js/game.js';

function card(rank, suit) { return { id: `${rank}-${suit}`, rank, suit }; }
function state(top, extra = {}) { return { discardPile:[top], pendingDraw:null, pendingSkip:null, jackDemand:null, aceDemand:null, ...extra }; }

test('talia ma 52 karty i nie zawiera jokerów', () => {
  const deck = createDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52);
  assert.equal(deck.some((c) => c.rank === 'JOKER'), false);
});

test('tylko K♥ i K♠ są funkcyjne', () => {
  assert.equal(isFunctional(card('K','hearts')), true);
  assert.equal(isFunctional(card('K','spades')), true);
  assert.equal(isFunctional(card('K','clubs')), false);
  assert.equal(isFunctional(card('K','diamonds')), false);
});

test('dama jest dzika w zwykłej grze', () => {
  assert.equal(isCardLegal(card('Q','diamonds'), state(card('7','clubs')), 0), true);
  assert.equal(isCardLegal(card('9','hearts'), state(card('Q','spades')), 0), true);
});

test('dama nie omija aktywnej kary i żądania', () => {
  assert.equal(isCardLegal(card('Q','hearts'), state(card('2','clubs'), {pendingDraw:{amount:2,targetIndex:0}}), 0), false);
  assert.equal(isCardLegal(card('Q','hearts'), state(card('J','clubs'), {jackDemand:{rank:'8',byIndex:1}}), 0), false);
  assert.equal(isCardLegal(card('Q','hearts'), state(card('A','clubs'), {aceDemand:{suit:'clubs',targetIndex:0}}), 0), false);
});

test('2 i 3 mogą odpowiadać na karę dobierania', () => {
  const s = state(card('2','hearts'), {pendingDraw:{amount:2,targetIndex:0}});
  assert.equal(isCardLegal(card('3','spades'), s, 0), true);
  assert.equal(isCardLegal(card('2','clubs'), s, 0), true);
  assert.equal(isCardLegal(card('4','hearts'), s, 0), false);
});

test('wariant wielokartowy dopuszcza 1, 3 lub 4, ale nie parę', () => {
  const s = state(card('9','hearts'));
  assert.equal(validateGroup([card('9','clubs')], s, 0).ok, true);
  assert.equal(validateGroup([card('9','clubs'),card('9','spades')], s, 0).ok, false);
  assert.equal(validateGroup([card('9','clubs'),card('9','spades'),card('9','diamonds')], s, 0).ok, true);
  assert.equal(validateGroup([card('9','clubs'),card('9','spades'),card('9','diamonds'),card('9','hearts')], s, 0).ok, true);
});

test('nowa gra działa dla 2 i 3 botów', () => {
  for (const bots of [2,3]) {
    const game = new MakaoGame();
    game.start(bots);
    clearTimeout(game.timer);
    assert.equal(game.state.players.length, bots + 1);
    assert.equal(game.state.players.every((p) => p.hand.length === 5), true);
    assert.equal(isFunctional(game.state.discardPile.at(-1)), false);
  }
});
