import { JACK_DEMAND_RANKS, SUITS } from './constants.js';
import { getLegalGroups, orderGroupForPlay } from './rules.js';

function scoreGroup(group, bot) {
  let score = group.length * 30;
  const rank = group[0].rank;
  const remaining = bot.hand.length - group.length;

  if (remaining === 0) score += 10000;
  if (remaining === 1) score += 1200;
  if (rank === '2') score += group.length * 25;
  if (rank === '3') score += group.length * 30;
  if (rank === '4') score += group.length * 22;
  if (rank === 'J') score += 18;
  if (rank === 'A') score += 16;
  if (rank === 'Q') score += 10;

  for (const card of group) {
    if (card.rank === 'K' && card.suit === 'hearts') score += 32;
    if (card.rank === 'K' && card.suit === 'spades') score += 24;
  }

  if (rank === 'Q' && remaining > 2) score -= 12;
  score += Math.random() * 5;
  return score;
}

export function chooseBotPlay(bot, state, playerIndex) {
  const groups = getLegalGroups(bot.hand, state, playerIndex);
  if (!groups.length) return null;
  groups.sort((a, b) => scoreGroup(b, bot) - scoreGroup(a, bot));
  return orderGroupForPlay(groups[0], state, playerIndex);
}

export function chooseJackDemand(hand) {
  let bestRank = JACK_DEMAND_RANKS[0];
  let bestCount = -1;
  for (const rank of JACK_DEMAND_RANKS) {
    const count = hand.filter((card) => card.rank === rank).length;
    if (count > bestCount) {
      bestCount = count;
      bestRank = rank;
    }
  }
  return bestRank;
}

export function chooseAceSuit(hand) {
  let bestSuit = SUITS[0].key;
  let bestCount = -1;
  for (const suit of SUITS) {
    const count = hand.filter((card) => card.suit === suit.key).length;
    if (count > bestCount) {
      bestCount = count;
      bestSuit = suit.key;
    }
  }
  return bestSuit;
}
