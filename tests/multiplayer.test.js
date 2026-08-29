import test from 'node:test';
import assert from 'node:assert/strict';

import { MakaoGame } from '../js/game.js';
import { filterStateForSeat, seatReady } from '../js/multiplayer.js';
import { createDeck, getLegalGroups, isCardLegal } from '../js/rules.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6D2B79F5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function card(id) {
  return createDeck().find((item) => item.id === id);
}

function assertCardConservation(state) {
  const ids = [];
  for (const player of state.players) ids.push(...player.hand.map((item) => item.id));
  ids.push(...state.drawPile.map((item) => item.id));
  ids.push(...state.discardPile.map((item) => item.id));
  assert.equal(ids.length, 52, 'all physical cards must remain in authoritative state');
  assert.equal(new Set(ids).size, 52, 'cards must not be duplicated');
}

test('seat-filtered state exposes only the local hand and no deck order', () => {
  const game = new MakaoGame();
  game.queueCurrentTurn = () => {};
  game.startMultiplayer([
    { name: 'Host', isBot: false },
    { name: 'Anna', isBot: false },
    { name: 'Bot', isBot: true },
  ]);

  game.state.currentIndex = 1;
  game.state.pendingChoice = { type: 'jack', actorIndex: 1 };
  game.state.drawnRescueCardId = game.state.players[1].hand[0].id;
  game.state.makaoArmed = true;

  const view = filterStateForSeat(game.state, 1);
  assert.deepEqual(view.players[1].hand, game.state.players[1].hand);
  assert.equal(view.players[0].hand.length, game.state.players[0].hand.length);
  assert.ok(view.players[0].hand.every((item) => item.hidden === true && !('id' in item)));
  assert.ok(view.players[2].hand.every((item) => item.hidden === true && !('id' in item)));
  assert.equal(view.drawPile.length, game.state.drawPile.length);
  assert.ok(view.drawPile.every((item) => item.hidden === true && !('id' in item)));
  assert.deepEqual(view.pendingChoice, { type: 'jack', actorIndex: 1 });
  assert.equal(view.drawnRescueCardId, game.state.drawnRescueCardId);

  const otherView = filterStateForSeat(game.state, 0);
  assert.equal(otherView.pendingChoice, null);
  assert.equal(otherView.drawnRescueCardId, null);
  assert.equal(otherView.makaoArmed, false);
});

test('host dispatcher rejects spoofed, duplicate, foreign and bot actions', () => {
  const game = new MakaoGame();
  game.queueCurrentTurn = () => {};
  game.startMultiplayer([
    { name: 'Host', isBot: false },
    { name: 'Guest', isBot: false },
    { name: 'Bot', isBot: true },
  ]);

  game.state.currentIndex = 1;
  game.state.discardPile = [card('7-hearts')];
  game.state.drawPile = createDeck().filter((item) => item.id !== '7-hearts' && item.id !== '7-clubs' && item.id !== '8-clubs');
  game.state.players[0].hand = [card('8-clubs')];
  game.state.players[1].hand = [card('7-clubs')];
  game.state.players[2].hand = [];

  assert.equal(game.executePlayerAction(0, 'draw').ok, false, 'wrong seat cannot act out of turn');
  assert.equal(game.executePlayerAction(1, 'play-cards', { cardIds: ['8-clubs'] }).ok, false, 'guest cannot play a foreign card');
  assert.equal(game.executePlayerAction(1, 'play-cards', { cardIds: ['7-clubs', '7-clubs', '7-clubs'] }).ok, false, 'duplicate physical card id is rejected');
  assert.equal(game.executePlayerAction(2, 'draw').ok, false, 'network action cannot drive a bot seat');
  assert.equal(game.executePlayerAction(1, 'overwrite-state', { score: 999 }).ok, false, 'unknown state mutation protocol is rejected');
});

test('remote human action is validated and executed by the authoritative engine', () => {
  const game = new MakaoGame();
  game.queueCurrentTurn = () => {};
  game.startMultiplayer([
    { name: 'Host', isBot: false },
    { name: 'Guest', isBot: false },
    { name: 'Bot', isBot: true },
  ]);

  const guest = game.state.players[1];
  const playable = guest.hand.find((candidate) => isCardLegal(candidate, game.state, 1));
  if (!playable) {
    game.state.discardPile.push({ ...guest.hand[0] });
  }
  const selected = guest.hand.find((candidate) => isCardLegal(candidate, game.state, 1));
  assert.ok(selected);
  game.state.currentIndex = 1;
  const before = guest.hand.length;
  const result = game.executePlayerAction(1, 'play-cards', { cardIds: [selected.id] });
  assert.equal(result.ok, true);
  assert.equal(guest.hand.length, before - 1);
  assert.equal(game.state.discardPile.at(-1).id, selected.id);
});

test('lobby readiness treats connected humans and reserved bot seats equally', () => {
  assert.equal(seatReady({ seat: 1, tableSize: 4, botSeats: new Set(), peers: new Map([[1, { connected: true }]]) }), true);
  assert.equal(seatReady({ seat: 2, tableSize: 4, botSeats: new Set([2]), peers: new Map() }), true);
  assert.equal(seatReady({ seat: 3, tableSize: 4, botSeats: new Set([2]), peers: new Map([[1, { connected: true }]]) }), false);
});

function resolveBlockedTurn(game, seat) {
  const player = game.state.players[seat];
  if (player.blockedTurns <= 0 || game.isPendingSkipFor(seat)) return false;
  player.blockedTurns -= 1;
  if (game.isPendingDrawFor(seat)) {
    const amount = game.state.pendingDraw.amount;
    game.state.pendingDraw = null;
    game.drawCards(seat, amount);
  }
  game.endTurn(seat);
  return true;
}

function chooseHumanPending(game) {
  const choice = game.state.pendingChoice;
  if (!choice) return false;
  const actor = game.state.players[choice.actorIndex];
  let value = null;
  if (choice.type === 'jack') {
    value = actor.hand.find((item) => ['5','6','7','8','9','10'].includes(item.rank))?.rank ?? null;
  } else if (choice.type === 'ace') {
    value = actor.hand[0]?.suit ?? 'clubs';
  }
  const result = game.executePlayerAction(choice.actorIndex, 'choose-pending', { value });
  assert.equal(result.ok, true);
  return true;
}

function driveHuman(game, seat) {
  const player = game.state.players[seat];
  if (game.state.drawnRescueCardId) {
    const rescue = player.hand.find((item) => item.id === game.state.drawnRescueCardId);
    assert.ok(rescue && isCardLegal(rescue, game.state, seat));
    return game.executePlayerAction(seat, 'play-cards', { cardIds: [rescue.id] });
  }

  const groups = getLegalGroups(player.hand, game.state, seat);
  if (groups.length) {
    groups.sort((a, b) => b.length - a.length);
    const selected = groups[0];
    if (player.hand.length - selected.length <= 1) game.executePlayerAction(seat, 'toggle-makao');
    return game.executePlayerAction(seat, 'play-cards', { cardIds: selected.map((item) => item.id) });
  }
  return game.executePlayerAction(seat, 'draw');
}

function driveBot(game, seat) {
  const before = new Set(game.state.players[seat].hand.map((item) => item.id));
  game.runBotTurn(seat);
  clearTimeout(game.timer);
  game.timer = null;
  if (game.state.currentIndex !== seat || game.state.gameOver) return;
  const added = game.state.players[seat].hand.find((item) => !before.has(item.id));
  if (added && isCardLegal(added, game.state, seat)) game.playCards(seat, [added], { fromRescue: true });
}

function simulateMixedTable({ seed, seats }) {
  const originalRandom = Math.random;
  Math.random = seeded(seed);
  try {
    const game = new MakaoGame();
    game.queueCurrentTurn = () => {};
    game.startMultiplayer(seats, { localSeat: 0 });
    clearTimeout(game.timer);
    game.timer = null;

    for (let step = 0; step < 5000 && !game.state.gameOver; step += 1) {
      assertCardConservation(game.state);
      if (chooseHumanPending(game)) continue;
      const seat = game.state.currentIndex;
      if (resolveBlockedTurn(game, seat)) continue;
      const current = game.state.players[seat];
      if (current.isBot) driveBot(game, seat);
      else {
        const result = driveHuman(game, seat);
        assert.equal(result?.ok, true, `human seat ${seat} should only send legal actions`);
      }
    }

    clearTimeout(game.timer);
    assert.equal(game.state.gameOver, true, 'mixed multiplayer table must reach normal completion');
    assert.equal(game.state.standings.length, seats.length);
    assertCardConservation(game.state);
  } finally {
    Math.random = originalRandom;
  }
}

test('hybrid host table completes with bot in either guest position', () => {
  simulateMixedTable({
    seed: 101,
    seats: [
      { name: 'Host', isBot: false },
      { name: 'Bot A', isBot: true },
      { name: 'Guest', isBot: false },
    ],
  });
  simulateMixedTable({
    seed: 202,
    seats: [
      { name: 'Host', isBot: false },
      { name: 'Guest', isBot: false },
      { name: 'Bot B', isBot: true },
    ],
  });
});

test('four-seat hybrid table completes with multiple host-side bots', () => {
  simulateMixedTable({
    seed: 303,
    seats: [
      { name: 'Host', isBot: false },
      { name: 'Guest', isBot: false },
      { name: 'Bot A', isBot: true },
      { name: 'Bot B', isBot: true },
    ],
  });
});
