export const SUITS = [
  { key: 'clubs', symbol: '♣', label: 'Trefl' },
  { key: 'spades', symbol: '♠', label: 'Pik' },
  { key: 'hearts', symbol: '♥', label: 'Kier' },
  { key: 'diamonds', symbol: '♦', label: 'Karo' },
];

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const JACK_DEMAND_RANKS = ['5', '6', '7', '8', '9', '10'];
export const ALLOWED_GROUP_SIZES = [1, 3, 4];

export const BOT_NAMES = ['Marta', 'Oskar', 'Iga'];

export const RULE_SOURCES = {
  wikipedia: 'https://pl.wikipedia.org/wiki/Makao_(gra_karciana)',
  morele: 'https://www.morele.net/wiadomosc/gra-karciana-makao-jak-grac-zasady-i-praktyczne-porady-gry-karcianej/18363/',
};

export const UI_DELAYS = {
  botThink: 650,
  botAfterDraw: 420,
  blockedTurn: 520,
};
