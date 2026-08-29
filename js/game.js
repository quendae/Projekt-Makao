import { BOT_NAMES, JACK_DEMAND_RANKS, SUITS, UI_DELAYS } from './constants.js';
import {
  cardLabel,
  createDeck,
  getTurnConstraint,
  isCardLegal,
  isFunctional,
  isMakaoRequired,
  orderGroupForPlay,
  recycleDiscardIntoDrawPile,
  shuffle,
  suitLabel,
  validateGroup,
} from './rules.js';
import { chooseAceSuit, chooseBotPlay, chooseJackDemand } from './bot.js';

export class MakaoGame {
  constructor({ onChange = () => {}, onMessage = () => {} } = {}) {
    this.onChange = onChange;
    this.onMessage = onMessage;
    this.localSeat = 0;
    this.readOnlyView = false;
    this.state = this.emptyState();
    this.timer = null;
  }

  emptyState() {
    return {
      started: false,
      gameOver: false,
      multiplayer: false,
      networkPaused: false,
      botCount: 2,
      players: [],
      dealerIndex: 0,
      currentIndex: 0,
      drawPile: [],
      discardPile: [],
      pendingDraw: null,
      pendingSkip: null,
      jackDemand: null,
      aceDemand: null,
      pendingChoice: null,
      drawnRescueCardId: null,
      makaoArmed: false,
      standings: [],
      log: [],
      turnNumber: 1,
    };
  }

  setLocalSeat(seat) {
    this.localSeat = Number.isInteger(seat) ? seat : 0;
    if (Array.isArray(this.state.players)) {
      this.state.players.forEach((player, index) => {
        player.isLocal = index === this.localSeat;
      });
    }
  }

  stop() {
    clearTimeout(this.timer);
    this.timer = null;
    this.readOnlyView = false;
    this.localSeat = 0;
    this.state = this.emptyState();
    this.emit();
  }

  start(botCount = 2) {
    const safeBotCount = botCount === 3 ? 3 : 2;
    this.localSeat = 0;
    this.readOnlyView = false;
    return this.startWithPlayers(this.createPlayers(safeBotCount), { multiplayer: false, localSeat: 0 });
  }

  startMultiplayer(seats, { localSeat = 0 } = {}) {
    if (!Array.isArray(seats) || ![3, 4].includes(seats.length)) {
      throw new Error('Makao multiplayer wymaga 3 albo 4 miejsc przy stole.');
    }

    const players = seats.map((seat, index) => {
      const isBot = Boolean(seat?.isBot);
      const fallbackName = isBot ? BOT_NAMES[(index - 1 + BOT_NAMES.length) % BOT_NAMES.length] : `Gracz ${index + 1}`;
      const name = String(seat?.name || fallbackName).trim().slice(0, 20) || fallbackName;
      return {
        id: seat?.id || `seat-${index}`,
        name,
        isHuman: !isBot,
        isBot,
        isLocal: index === localSeat,
        avatar: this.avatarForName(name, isBot ? 'B' : `G${index + 1}`),
        hand: [],
        finishPlace: null,
        blockedTurns: 0,
      };
    });

    this.localSeat = localSeat;
    this.readOnlyView = false;
    return this.startWithPlayers(players, { multiplayer: true, localSeat });
  }

  startWithPlayers(players, { multiplayer = false, localSeat = 0 } = {}) {
    clearTimeout(this.timer);
    this.timer = null;
    this.localSeat = localSeat;
    this.readOnlyView = false;
    this.state = this.emptyState();
    this.state.started = true;
    this.state.multiplayer = multiplayer;
    this.state.players = players.map((player, index) => ({
      ...player,
      isBot: Boolean(player.isBot),
      isHuman: !player.isBot,
      isLocal: index === localSeat,
      hand: [],
      finishPlace: null,
      blockedTurns: 0,
    }));
    this.state.botCount = this.state.players.filter((player) => player.isBot).length;
    this.state.drawPile = shuffle(createDeck());
    this.state.dealerIndex = Math.floor(Math.random() * this.state.players.length);

    for (let round = 0; round < 5; round += 1) {
      for (const player of this.state.players) {
        player.hand.push(this.state.drawPile.pop());
      }
    }

    do {
      const card = this.state.drawPile.pop();
      if (!card) break;
      this.state.discardPile.push(card);
    } while (isFunctional(this.state.discardPile.at(-1)));

    this.state.currentIndex = this.nextActiveIndex(this.state.dealerIndex);
    this.addLog(`Rozdaje ${this.state.players[this.state.dealerIndex].name}. Każdy otrzymuje 5 kart.`);
    this.addLog(`Pierwsza karta: ${cardLabel(this.state.discardPile.at(-1))}.`);
    this.addLog(`Zaczyna ${this.state.players[this.state.currentIndex].name}.`);
    this.emit();
    this.queueCurrentTurn();
    return this.state;
  }

  createPlayers(botCount) {
    const players = [
      {
        id: 'human',
        name: 'Ty',
        isHuman: true,
        isBot: false,
        isLocal: true,
        avatar: 'TY',
        hand: [],
        finishPlace: null,
        blockedTurns: 0,
      },
    ];

    for (let i = 0; i < botCount; i += 1) {
      players.push({
        id: `bot-${i + 1}`,
        name: BOT_NAMES[i],
        isHuman: false,
        isBot: true,
        isLocal: false,
        avatar: BOT_NAMES[i].slice(0, 1).toUpperCase(),
        hand: [],
        finishPlace: null,
        blockedTurns: 0,
      });
    }
    return players;
  }

  avatarForName(name, fallback = 'G') {
    const chars = Array.from(String(name || '').trim()).filter((char) => /[\p{L}\p{N}]/u.test(char));
    return (chars.slice(0, 2).join('') || fallback).toUpperCase();
  }

  applyRemoteState(view, localSeat) {
    clearTimeout(this.timer);
    this.timer = null;
    this.readOnlyView = true;
    this.localSeat = localSeat;
    this.state = view;
    this.state.multiplayer = true;
    this.state.players?.forEach((player, index) => {
      player.isLocal = index === localSeat;
      player.isBot = Boolean(player.isBot);
      player.isHuman = !player.isBot;
    });
    this.emit();
  }

  emit() {
    this.onChange(this.state);
  }

  addLog(message) {
    this.state.log.unshift({ id: `${Date.now()}-${Math.random()}`, message });
    this.state.log = this.state.log.slice(0, 80);
  }

  isLocalNarration(player) {
    return !this.state.multiplayer && Boolean(player?.isLocal);
  }

  activePlayerIndexes() {
    return this.state.players
      .map((player, index) => ({ player, index }))
      .filter(({ player }) => player.finishPlace == null)
      .map(({ index }) => index);
  }

  nextActiveIndex(fromIndex) {
    const count = this.state.players.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (fromIndex + step) % count;
      if (this.state.players[index]?.finishPlace == null) return index;
    }
    return fromIndex;
  }

  previousActiveIndex(fromIndex) {
    const count = this.state.players.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (fromIndex - step + count) % count;
      if (this.state.players[index]?.finishPlace == null) return index;
    }
    return fromIndex;
  }

  currentPlayer() {
    return this.state.players[this.state.currentIndex];
  }

  queueCurrentTurn() {
    clearTimeout(this.timer);
    if (!this.state.started || this.state.gameOver || this.state.pendingChoice || this.state.networkPaused) return;

    const player = this.currentPlayer();
    if (!player || player.finishPlace != null) {
      this.state.currentIndex = this.nextActiveIndex(this.state.currentIndex);
      this.emit();
      return this.queueCurrentTurn();
    }

    if (player.blockedTurns > 0 && !this.isPendingSkipFor(this.state.currentIndex)) {
      player.blockedTurns -= 1;

      if (this.isPendingDrawFor(this.state.currentIndex)) {
        const amount = this.state.pendingDraw.amount;
        this.state.pendingDraw = null;
        this.drawCards(this.state.currentIndex, amount);
        this.addLog(this.isLocalNarration(player) ? `Tracisz kolejkę i dobierasz ${amount} kart za karę.` : `${player.name} traci kolejkę i dobiera ${amount} kart za karę.`);
      } else {
        this.addLog(this.isLocalNarration(player) ? 'Tracisz kolejkę.' : `${player.name} traci kolejkę.`);
      }

      this.emit();
      this.timer = setTimeout(() => this.endTurn(this.state.currentIndex), UI_DELAYS.blockedTurn);
      return;
    }

    if (player.isBot) {
      this.timer = setTimeout(() => this.runBotTurn(this.state.currentIndex), UI_DELAYS.botThink);
    }
  }

  isPendingDrawFor(playerIndex) {
    return this.state.pendingDraw?.targetIndex === playerIndex;
  }

  isPendingSkipFor(playerIndex) {
    return this.state.pendingSkip?.targetIndex === playerIndex;
  }

  canPlayerAct(playerIndex) {
    const player = this.state.players[playerIndex];
    return Boolean(
      this.state.started &&
        !this.state.gameOver &&
        !this.state.networkPaused &&
        !this.state.pendingChoice &&
        this.state.currentIndex === playerIndex &&
        player &&
        !player.isBot &&
        player.finishPlace == null &&
        player.blockedTurns === 0,
    );
  }

  humanCanAct() {
    return this.canPlayerAct(this.localSeat);
  }

  executePlayerAction(playerIndex, action, payload = {}) {
    if (this.readOnlyView) return { ok: false, reason: 'Stan gościa jest tylko do odczytu.' };
    if (!Number.isInteger(playerIndex) || !this.state.players[playerIndex]) {
      return { ok: false, reason: 'Nieprawidłowe miejsce gracza.' };
    }
    if (this.state.players[playerIndex].isBot) {
      return { ok: false, reason: 'Miejsce jest sterowane przez bota.' };
    }

    switch (action) {
      case 'play-cards':
        return this.playerPlay(playerIndex, payload.cardIds);
      case 'draw':
        return this.playerDraw(playerIndex);
      case 'pass-after-draw':
        return this.playerPassAfterDraw(playerIndex);
      case 'toggle-makao':
        return this.toggleMakaoFor(playerIndex);
      case 'choose-pending':
        return this.choosePendingFor(playerIndex, payload.value ?? null);
      default:
        return { ok: false, reason: 'Nieznana akcja gracza.' };
    }
  }

  toggleMakao() {
    return this.executePlayerAction(this.localSeat, 'toggle-makao');
  }

  toggleMakaoFor(playerIndex) {
    if (!this.canPlayerAct(playerIndex)) return { ok: false, reason: 'Teraz nie jest Twoja tura.' };
    this.state.makaoArmed = !this.state.makaoArmed;
    this.emit();
    return { ok: true };
  }

  humanPlay(cardIds) {
    return this.executePlayerAction(this.localSeat, 'play-cards', { cardIds });
  }

  playerPlay(playerIndex, cardIds) {
    if (!this.canPlayerAct(playerIndex)) return { ok: false, reason: 'Teraz nie jest Twoja tura.' };
    if (!Array.isArray(cardIds) || cardIds.some((id) => typeof id !== 'string')) {
      return { ok: false, reason: 'Nieprawidłowa lista kart.' };
    }
    if (new Set(cardIds).size !== cardIds.length) {
      return { ok: false, reason: 'Ta sama karta nie może wystąpić w zagraniu kilka razy.' };
    }

    const player = this.state.players[playerIndex];
    const cards = cardIds.map((id) => player.hand.find((card) => card.id === id)).filter(Boolean);
    if (cards.length !== cardIds.length) return { ok: false, reason: 'Nie masz jednej z wybranych kart.' };

    if (this.state.drawnRescueCardId) {
      if (cards.length !== 1 || cards[0].id !== this.state.drawnRescueCardId) {
        return { ok: false, reason: 'Po dobraniu możesz zagrać tylko dobraną kartę albo zakończyć turę.' };
      }
    }

    const validation = validateGroup(cards, this.state, playerIndex, {
      rescueOnly: Boolean(this.state.drawnRescueCardId),
    });
    if (!validation.ok) return validation;

    this.playCards(playerIndex, cards, { fromRescue: Boolean(this.state.drawnRescueCardId) });
    return { ok: true };
  }

  humanDraw() {
    return this.executePlayerAction(this.localSeat, 'draw');
  }

  playerDraw(playerIndex) {
    if (!this.canPlayerAct(playerIndex)) return { ok: false, reason: 'Teraz nie jest Twoja tura.' };
    const player = this.state.players[playerIndex];
    const constraint = getTurnConstraint(this.state, playerIndex);

    if (constraint.type === 'draw') {
      const amount = this.state.pendingDraw.amount;
      this.state.pendingDraw = null;
      this.drawCards(playerIndex, amount);
      this.addLog(this.isLocalNarration(player) ? `Dobierasz ${amount} kart za karę.` : `${player.name} dobiera ${amount} kart za karę.`);
      this.endTurn(playerIndex);
      return { ok: true };
    }

    if (constraint.type === 'skip') {
      this.acceptSkip(playerIndex);
      return { ok: true };
    }

    if (this.state.drawnRescueCardId) return { ok: false, reason: 'Dobraną kartę trzeba zagrać albo spasować.' };

    const drawn = this.drawCards(playerIndex, 1)[0];
    if (!drawn) {
      this.endTurn(playerIndex);
      return { ok: true };
    }

    this.addLog(this.isLocalNarration(player) ? 'Dobierasz kartę.' : `${player.name} dobiera kartę.`);
    if (isCardLegal(drawn, this.state, playerIndex)) {
      this.state.drawnRescueCardId = drawn.id;
      if (player.isLocal) this.onMessage('Pierwsza karta ratuje — możesz zagrać dobraną kartę albo spasować.');
      this.emit();
    } else {
      this.endTurn(playerIndex);
    }
    return { ok: true };
  }

  humanPassAfterDraw() {
    return this.executePlayerAction(this.localSeat, 'pass-after-draw');
  }

  playerPassAfterDraw(playerIndex) {
    if (!this.canPlayerAct(playerIndex) || !this.state.drawnRescueCardId) {
      return { ok: false, reason: 'Nie ma dobranej karty do spasowania.' };
    }
    const player = this.state.players[playerIndex];
    this.addLog(this.isLocalNarration(player) ? 'Nie zagrywasz dobranej karty.' : `${player.name} nie zagrywa dobranej karty.`);
    this.endTurn(playerIndex);
    return { ok: true };
  }

  acceptSkip(playerIndex) {
    if (!this.isPendingSkipFor(playerIndex)) return false;
    const player = this.state.players[playerIndex];
    const count = this.state.pendingSkip.count;
    this.state.pendingSkip = null;
    player.blockedTurns += Math.max(0, count - 1);
    this.addLog(this.isLocalNarration(player) ? `Przyjmujesz blokadę: ${count} ${count === 1 ? 'kolejka' : 'kolejki'}.` : `${player.name} przyjmuje blokadę: ${count} ${count === 1 ? 'kolejka' : 'kolejki'}.`);
    this.endTurn(playerIndex);
    return true;
  }

  playCards(playerIndex, cards, { fromRescue = false } = {}) {
    const player = this.state.players[playerIndex];
    const constraintBefore = getTurnConstraint(this.state, playerIndex);
    const ordered = fromRescue ? [...cards] : orderGroupForPlay(cards, this.state, playerIndex);
    const rank = ordered[0].rank;

    if (constraintBefore.type === 'jack' && rank === this.state.jackDemand?.rank) this.state.jackDemand = null;
    if (constraintBefore.type === 'jack' && rank === 'J') this.state.jackDemand = null;

    for (const card of ordered) {
      const handIndex = player.hand.findIndex((held) => held.id === card.id);
      if (handIndex >= 0) player.hand.splice(handIndex, 1);
      this.state.discardPile.push(card);
    }

    this.state.drawnRescueCardId = null;
    this.addLog(this.isLocalNarration(player) ? `Zagrywasz ${ordered.map(cardLabel).join(', ')}.` : `${player.name} zagrywa ${ordered.map(cardLabel).join(', ')}.`);

    const makaoRequired = isMakaoRequired(player.hand.length);
    const declared = player.isBot || this.state.makaoArmed;

    if (makaoRequired && declared) {
      this.addLog(player.hand.length === 0 ? `${player.name}: „Makao i po makale!”` : `${player.name}: „Makao!”`);
    } else if (makaoRequired && !declared) {
      this.addLog(this.isLocalNarration(player) ? 'STOP MAKAO! Dobierasz 5 kart.' : `STOP MAKAO! ${player.name} dobiera 5 kart.`);
      this.drawCards(playerIndex, 5);
      if (player.isLocal) this.onMessage('STOP MAKAO — brak deklaracji. Dobierasz 5 kart.');
    }

    this.applyCardEffects(playerIndex, ordered, constraintBefore);

    if (player.hand.length === 0) this.finishPlayer(playerIndex);

    this.state.makaoArmed = false;
    this.emit();

    if (!this.state.gameOver && !this.state.pendingChoice) this.endTurn(playerIndex);
  }

  applyCardEffects(playerIndex, cards, constraintBefore) {
    const rank = cards[0].rank;
    const nextIndex = this.nextActiveIndex(playerIndex);

    if (rank === '2' || rank === '3') {
      const added = Number(rank) * cards.length;
      if (constraintBefore.type === 'draw' && this.state.pendingDraw) {
        this.state.pendingDraw.amount += added;
        this.state.pendingDraw.targetIndex = nextIndex;
      } else {
        this.state.pendingDraw = { amount: added, targetIndex: nextIndex };
      }
      this.addLog(`Kara dobierania rośnie do ${this.state.pendingDraw.amount}.`);
      return;
    }

    if (rank === '4') {
      const added = cards.length;
      if (constraintBefore.type === 'skip' && this.state.pendingSkip) {
        this.state.pendingSkip.count += added;
        this.state.pendingSkip.targetIndex = nextIndex;
      } else {
        this.state.pendingSkip = { count: added, targetIndex: nextIndex };
      }
      this.addLog(`Blokada: ${this.state.pendingSkip.count} ${this.state.pendingSkip.count === 1 ? 'kolejka' : 'kolejki'}.`);
      return;
    }

    if (rank === 'J') {
      const player = this.state.players[playerIndex];
      if (!player.isBot) {
        this.state.pendingChoice = { type: 'jack', actorIndex: playerIndex };
      } else {
        const demand = constraintBefore.type === 'jack' ? null : chooseJackDemand(player.hand);
        if (demand) {
          this.state.jackDemand = { rank: demand, byIndex: playerIndex };
          this.addLog(`${player.name} żąda wartości ${demand}.`);
        } else {
          this.state.jackDemand = null;
          this.addLog(`${player.name} nie żąda żadnej wartości.`);
        }
      }
      return;
    }

    if (rank === 'A') {
      const player = this.state.players[playerIndex];
      if (!player.isBot) {
        this.state.pendingChoice = { type: 'ace', actorIndex: playerIndex };
      } else {
        const suit = chooseAceSuit(player.hand);
        this.state.aceDemand = { suit, targetIndex: nextIndex, byIndex: playerIndex };
        this.addLog(`${player.name} żąda koloru: ${suitLabel(suit)}.`);
      }
      return;
    }

    if (rank === 'K') {
      const heartKing = cards.find((card) => card.suit === 'hearts');
      const spadeKing = cards.find((card) => card.suit === 'spades');

      if (heartKing) {
        const targetIndex = this.nextActiveIndex(playerIndex);
        if (targetIndex !== playerIndex) {
          this.drawCards(targetIndex, 5);
          this.addLog(`K♥: ${this.state.players[targetIndex].name} dobiera 5 kart.`);
        }
      }

      if (spadeKing) {
        const targetIndex = this.previousActiveIndex(playerIndex);
        if (targetIndex !== playerIndex) {
          this.drawCards(targetIndex, 5);
          this.addLog(`K♠: ${this.state.players[targetIndex].name} dobiera 5 kart.`);
        }
      }
    }
  }

  choosePending(value) {
    return this.executePlayerAction(this.localSeat, 'choose-pending', { value });
  }

  choosePendingFor(playerIndex, value) {
    const choice = this.state.pendingChoice;
    if (!choice || choice.actorIndex !== playerIndex) {
      return { ok: false, reason: 'Ta decyzja nie należy do tego gracza.' };
    }
    const actor = this.state.players[playerIndex];
    if (!actor || actor.isBot) return { ok: false, reason: 'Nieprawidłowy gracz.' };

    if (choice.type === 'jack') {
      if (value == null) {
        this.state.jackDemand = null;
        this.addLog(`${actor.name} nie żąda żadnej wartości.`);
      } else {
        const mayDemand = JACK_DEMAND_RANKS.includes(value) && actor.hand.some((card) => card.rank === value);
        if (!mayDemand) return { ok: false, reason: 'Walet może żądać tylko wartości 5–10, którą masz w ręce, albo niczego.' };
        this.state.jackDemand = { rank: value, byIndex: playerIndex };
        this.addLog(`${actor.name} żąda wartości ${value}.`);
      }
    } else if (choice.type === 'ace') {
      const allowedSuit = SUITS.some((suit) => suit.key === value);
      if (!allowedSuit) return { ok: false, reason: 'Nieprawidłowy kolor żądany asem.' };
      const targetIndex = this.nextActiveIndex(playerIndex);
      this.state.aceDemand = { suit: value, targetIndex, byIndex: playerIndex };
      this.addLog(`${actor.name} żąda koloru: ${suitLabel(value)}.`);
    } else {
      return { ok: false, reason: 'Nieznany typ decyzji.' };
    }

    this.state.pendingChoice = null;
    this.emit();
    if (!this.state.gameOver) this.endTurn(playerIndex);
    return { ok: true };
  }

  drawCards(playerIndex, count) {
    const drawn = [];
    for (let i = 0; i < count; i += 1) {
      recycleDiscardIntoDrawPile(this.state);
      const card = this.state.drawPile.pop();
      if (!card) break;
      this.state.players[playerIndex].hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  runBotTurn(playerIndex) {
    if (this.state.gameOver || this.state.pendingChoice || this.state.networkPaused || this.state.currentIndex !== playerIndex) return;
    const bot = this.state.players[playerIndex];
    if (!bot || !bot.isBot || bot.finishPlace != null) return;

    const constraint = getTurnConstraint(this.state, playerIndex);
    const play = chooseBotPlay(bot, this.state, playerIndex);

    if (play) {
      this.playCards(playerIndex, play);
      return;
    }

    if (constraint.type === 'draw') {
      const amount = this.state.pendingDraw.amount;
      this.state.pendingDraw = null;
      this.drawCards(playerIndex, amount);
      this.addLog(`${bot.name} dobiera ${amount} kart za karę.`);
      this.emit();
      this.endTurn(playerIndex);
      return;
    }

    if (constraint.type === 'skip') {
      this.acceptSkip(playerIndex);
      return;
    }

    const drawn = this.drawCards(playerIndex, 1)[0];
    this.addLog(`${bot.name} dobiera kartę.`);
    this.emit();

    if (drawn && isCardLegal(drawn, this.state, playerIndex)) {
      this.timer = setTimeout(() => {
        if (!this.state.gameOver && !this.state.networkPaused && this.state.currentIndex === playerIndex) {
          this.playCards(playerIndex, [drawn], { fromRescue: true });
        }
      }, UI_DELAYS.botAfterDraw);
    } else {
      this.endTurn(playerIndex);
    }
  }

  finishPlayer(playerIndex) {
    const player = this.state.players[playerIndex];
    if (player.finishPlace != null) return;
    player.finishPlace = this.state.standings.length + 1;
    this.state.standings.push(playerIndex);
    this.addLog(this.isLocalNarration(player) ? `Zajmujesz ${player.finishPlace}. miejsce.` : `${player.name} zajmuje ${player.finishPlace}. miejsce.`);

    const active = this.activePlayerIndexes();
    if (active.length === 1) {
      const lastIndex = active[0];
      const last = this.state.players[lastIndex];
      last.finishPlace = this.state.standings.length + 1;
      this.state.standings.push(lastIndex);
      this.addLog(this.isLocalNarration(last) ? `Zajmujesz ${last.finishPlace}. miejsce.` : `${last.name} zajmuje ${last.finishPlace}. miejsce.`);
      this.state.gameOver = true;
      this.state.pendingChoice = null;
      this.addLog('Koniec partii.');
    }
  }

  endTurn(actorIndex) {
    if (this.state.gameOver) {
      this.emit();
      return;
    }

    if (this.state.aceDemand?.targetIndex === actorIndex) this.state.aceDemand = null;

    this.state.drawnRescueCardId = null;
    this.state.makaoArmed = false;
    this.state.currentIndex = this.nextActiveIndex(actorIndex);
    this.state.turnNumber += 1;
    this.emit();
    this.queueCurrentTurn();
  }
}
