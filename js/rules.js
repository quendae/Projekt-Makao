import { ALLOWED_GROUP_SIZES, RANKS, SUITS } from './constants.js';

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}-${suit.key}`, rank, suit: suit.key });
    }
  }
  return deck;
}

export function shuffle(input, rng = Math.random) {
  const cards = [...input];
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function isFunctional(card) {
  if (!card) return false;
  if (['2', '3', '4', 'J', 'Q', 'A'].includes(card.rank)) return true;
  return card.rank === 'K' && ['hearts', 'spades'].includes(card.suit);
}

export function isOrdinary(card) {
  return !isFunctional(card);
}

export function suitSymbol(suitKey) {
  return SUITS.find((s) => s.key === suitKey)?.symbol ?? '?';
}

export function suitLabel(suitKey) {
  return SUITS.find((s) => s.key === suitKey)?.label ?? suitKey;
}

export function cardLabel(card) {
  return `${card.rank}${suitSymbol(card.suit)}`;
}

export function topCard(state) {
  return state.discardPile.at(-1) ?? null;
}

export function getTurnConstraint(state, playerIndex) {
  if (state.pendingDraw && state.pendingDraw.targetIndex === playerIndex) {
    return { type: 'draw', amount: state.pendingDraw.amount };
  }
  if (state.pendingSkip && state.pendingSkip.targetIndex === playerIndex) {
    return { type: 'skip', count: state.pendingSkip.count };
  }
  if (state.aceDemand && state.aceDemand.targetIndex === playerIndex) {
    return { type: 'ace', suit: state.aceDemand.suit };
  }
  if (state.jackDemand) {
    return { type: 'jack', rank: state.jackDemand.rank };
  }
  return { type: 'normal' };
}

export function isCardLegal(card, state, playerIndex) {
  if (!card) return false;
  const constraint = getTurnConstraint(state, playerIndex);
  const top = topCard(state);

  if (constraint.type === 'draw') return card.rank === '2' || card.rank === '3';
  if (constraint.type === 'skip') return card.rank === '4';
  if (constraint.type === 'jack') return card.rank === 'J' || card.rank === constraint.rank;
  if (constraint.type === 'ace') return card.rank === 'A' || card.suit === constraint.suit;
  if (!top) return true;

  if (card.rank === 'Q' || top.rank === 'Q') return true;
  return card.rank === top.rank || card.suit === top.suit;
}

export function validateGroup(cards, state, playerIndex, { rescueOnly = false } = {}) {
  if (!Array.isArray(cards) || !cards.length) return { ok: false, reason: 'Wybierz kartę.' };
  if (rescueOnly && cards.length !== 1) return { ok: false, reason: 'Po dobraniu możesz zagrać tylko dobraną kartę.' };
  if (!ALLOWED_GROUP_SIZES.includes(cards.length)) return { ok: false, reason: 'W tym wariancie można zagrać 1, 3 albo 4 karty.' };

  const rank = cards[0].rank;
  if (!cards.every((card) => card.rank === rank)) return { ok: false, reason: 'Kilka kart naraz musi mieć tę samą wartość.' };

  const legalStarter = cards.find((card) => isCardLegal(card, state, playerIndex));
  if (!legalStarter) return { ok: false, reason: 'Żadna z wybranych kart nie może rozpocząć tego zagrania.' };
  return { ok: true, starterId: legalStarter.id };
}

export function orderGroupForPlay(cards, state, playerIndex) {
  const validation = validateGroup(cards, state, playerIndex);
  if (!validation.ok) return [...cards];
  const starter = cards.find((card) => card.id === validation.starterId);
  return [starter, ...cards.filter((card) => card.id !== starter.id)];
}

export function getLegalGroups(hand, state, playerIndex) {
  const groups = [];
  for (const card of hand) if (isCardLegal(card, state, playerIndex)) groups.push([card]);

  const byRank = new Map();
  for (const card of hand) {
    if (!byRank.has(card.rank)) byRank.set(card.rank, []);
    byRank.get(card.rank).push(card);
  }

  for (const cards of byRank.values()) {
    if (cards.length >= 3) {
      for (const triple of combinations(cards, 3)) if (validateGroup(triple, state, playerIndex).ok) groups.push(triple);
    }
    if (cards.length === 4 && validateGroup(cards, state, playerIndex).ok) groups.push([...cards]);
  }
  return groups;
}

export function combinations(items, size) {
  const out = [];
  function walk(start, chosen) {
    if (chosen.length === size) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i <= items.length - (size - chosen.length); i += 1) {
      chosen.push(items[i]);
      walk(i + 1, chosen);
      chosen.pop();
    }
  }
  walk(0, []);
  return out;
}

export function isMakaoRequired(handSizeAfterPlay) {
  return handSizeAfterPlay === 1 || handSizeAfterPlay === 0;
}

export function recycleDiscardIntoDrawPile(state, rng = Math.random) {
  if (state.drawPile.length > 0 || state.discardPile.length <= 1) return false;
  const top = state.discardPile.pop();
  state.drawPile = shuffle(state.discardPile, rng);
  state.discardPile = [top];
  return true;
}
