import { BOT_NAMES, UI_DELAYS } from './constants.js';
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
    this.state = this.emptyState();
    this.timer = null;
  }

  emptyState() {
    return {
      started: false,
      gameOver: false,
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

  start(botCount = 2) {
    const safeBotCount = botCount === 3 ? 3 : 2;
    clearTimeout(this.timer);
    this.state = this.emptyState();
    this.state.started = true;
    this.state.botCount = safeBotCount;
    this.state.players = this.createPlayers(safeBotCount);
    this.state.drawPile = shuffle(createDeck());
    this.state.dealerIndex = Math.floor(Math.random() * this.state.players.length);

    for (let round = 0; round < 5; round += 1) {
      for (const player of this.state.players) {
        player.hand.push(this.state.drawPile.pop());
      }
    }

    // Źródła wymagają, aby pierwsza odkryta karta nie była funkcyjna.
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
  }

  createPlayers(botCount) {
    const players = [
      {
        id: 'human',
        name: 'Ty',
        isHuman: true,
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
        avatar: BOT_NAMES[i].slice(0, 1).toUpperCase(),
        hand: [],
        finishPlace: null,
        blockedTurns: 0,
      });
    }
    return players;
  }

  emit() {
    this.onChange(this.state);
  }

  addLog(message) {
    this.state.log.unshift({ id: `${Date.now()}-${Math.random()}`, message });
    this.state.log = this.state.log.slice(0, 80);
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
    if (!this.state.started || this.state.gameOver || this.state.pendingChoice) return;

    const player = this.currentPlayer();
    if (!player || player.finishPlace != null) {
      this.state.currentIndex = this.nextActiveIndex(this.state.currentIndex);
      this.emit();
      return this.queueCurrentTurn();
    }

    if (player.blockedTurns > 0 && !this.isPendingSkipFor(this.state.currentIndex)) {
      player.blockedTurns -= 1;
      this.addLog(`${player.name} traci kolejkę.`);
      this.emit();
      this.timer = setTimeout(() => this.endTurn(this.state.currentIndex), UI_DELAYS.blockedTurn);
      return;
    }

    if (!player.isHuman) {
      this.timer = setTimeout(() => this.runBotTurn(this.state.currentIndex), UI_DELAYS.botThink);
    }
  }

  isPendingDrawFor(playerIndex) {
    return this.state.pendingDraw?.targetIndex === playerIndex;
  }

  isPendingSkipFor(playerIndex) {
    return this.state.pendingSkip?.targetIndex === playerIndex;
  }

  humanCanAct() {
    const player = this.currentPlayer();
    return Boolean(
      this.state.started &&
        !this.state.gameOver &&
        !this.state.pendingChoice &&
        player?.isHuman &&
        player.finishPlace == null &&
        player.blockedTurns === 0,
    );
  }

  toggleMakao() {
    if (!this.humanCanAct()) return;
    this.state.makaoArmed = !this.state.makaoArmed;
    this.emit();
  }

  humanPlay(cardIds) {
    if (!this.humanCanAct()) return { ok: false, reason: 'Teraz nie jest Twoja tura.' };
    const playerIndex = this.state.currentIndex;
    const player = this.state.players[playerIndex];
    const cards = cardIds.map((id) => player.hand.find((card) => card.id === id)).filter(Boolean);

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
    if (!this.humanCanAct()) return;
    const playerIndex = this.state.currentIndex;
    const player = this.state.players[playerIndex];
    const constraint = getTurnConstraint(this.state, playerIndex);

    if (constraint.type === 'draw') {
      const amount = this.state.pendingDraw.amount;
      this.state.pendingDraw = null;
      this.drawCards(playerIndex, amount);
      this.addLog(`${player.name} dobiera ${amount} kart za karę.`);
      this.endTurn(playerIndex);
      return;
    }

    if (constraint.type === 'skip') {
      this.acceptSkip(playerIndex);
      return;
    }

    if (this.state.drawnRescueCardId) return;

    const drawn = this.drawCards(playerIndex, 1)[0];
    if (!drawn) {
      this.endTurn(playerIndex);
      return;
    }

    this.addLog(`${player.name} dobiera kartę.`);
    if (isCardLegal(drawn, this.state, playerIndex)) {
      this.state.drawnRescueCardId = drawn.id;
      this.onMessage('Pierwsza karta ratuje — możesz zagrać dobraną kartę albo spasować.');
      this.emit();
    } else {
      this.endTurn(playerIndex);
    }
  }

  humanPassAfterDraw() {
    if (!this.humanCanAct() || !this.state.drawnRescueCardId) return;
    this.addLog('Nie zagrywasz dobranej karty.');
    this.endTurn(this.state.currentIndex);
  }

  acceptSkip(playerIndex) {
    if (!this.isPendingSkipFor(playerIndex)) return;
    const player = this.state.players[playerIndex];
    const count = this.state.pendingSkip.count;
    this.state.pendingSkip = null;
    player.blockedTurns += Math.max(0, count - 1);
    this.addLog(`${player.name} przyjmuje blokadę: ${count} ${count === 1 ? 'kolejka' : 'kolejki'}.`);
    this.endTurn(playerIndex);
  }

  playCards(playerIndex, cards, { fromRescue = false } = {}) {
    const player = this.state.players[playerIndex];
    const constraintBefore = getTurnConstraint(this.state, playerIndex);
    const ordered = fromRescue ? [...cards] : orderGroupForPlay(cards, this.state, playerIndex);
    const rank = ordered[0].rank;

    // Spełnienie żądania waleta usuwa je. Walet może je zastąpić nowym.
    if (constraintBefore.type === 'jack' && rank === this.state.jackDemand?.rank) {
      this.state.jackDemand = null;
    }
    if (constraintBefore.type === 'jack' && rank === 'J') {
      this.state.jackDemand = null;
    }

    for (const card of ordered) {
      const handIndex = player.hand.findIndex((held) => held.id === card.id);
      if (handIndex >= 0) player.hand.splice(handIndex, 1);
      this.state.discardPile.push(card);
    }

    this.state.drawnRescueCardId = null;
    this.addLog(`${player.name} zagrywa ${ordered.map(cardLabel).join(', ')}.`);

    const makaoRequired = isMakaoRequired(player.hand.length);
    const declared = !player.isHuman || this.state.makaoArmed;

    if (makaoRequired && declared) {
      this.addLog(player.hand.length === 0 ? `${player.name}: „Makao i po makale!”` : `${player.name}: „Makao!”`);
    } else if (makaoRequired && !declared) {
      this.addLog(`STOP MAKAO! ${player.name} dobiera 5 kart.`);
      this.drawCards(playerIndex, 5);
      this.onMessage('STOP MAKAO — brak deklaracji. Dobierasz 5 kart.');
    }

    this.applyCardEffects(playerIndex, ordered, constraintBefore);

    if (player.hand.length === 0) {
      this.finishPlayer(playerIndex);
    }

    this.state.makaoArmed = false;
    this.emit();

    if (!this.state.gameOver && !this.state.pendingChoice) {
      this.endTurn(playerIndex);
    }
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
      if (player.isHuman) {
        this.state.pendingChoice = { type: 'jack', actorIndex: playerIndex };
      } else {
        const demand = chooseJackDemand(player.hand);
        this.state.jackDemand = { rank: demand, byIndex: playerIndex };
        this.addLog(`${player.name} żąda wartości ${demand}.`);
      }
      return;
    }

    if (rank === 'A') {
      const player = this.state.players[playerIndex];
      if (player.isHuman) {
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
    const choice = this.state.pendingChoice;
    if (!choice) return;
    const actorIndex = choice.actorIndex;
    const actor = this.state.players[actorIndex];

    if (choice.type === 'jack') {
      this.state.jackDemand = { rank: value, byIndex: actorIndex };
      this.addLog(`${actor.name} żąda wartości ${value}.`);
    }

    if (choice.type === 'ace') {
      const targetIndex = this.nextActiveIndex(actorIndex);
      this.state.aceDemand = { suit: value, targetIndex, byIndex: actorIndex };
      this.addLog(`${actor.name} żąda koloru: ${suitLabel(value)}.`);
    }

    this.state.pendingChoice = null;
    this.emit();
    if (!this.state.gameOver) this.endTurn(actorIndex);
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
    if (this.state.gameOver || this.state.pendingChoice || this.state.currentIndex !== playerIndex) return;
    const bot = this.state.players[playerIndex];
    if (!bot || bot.isHuman || bot.finishPlace != null) return;

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
        if (!this.state.gameOver && this.state.currentIndex === playerIndex) {
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
    this.addLog(`${player.name} zajmuje ${player.finishPlace}. miejsce.`);

    const active = this.activePlayerIndexes();
    if (active.length === 1) {
      const lastIndex = active[0];
      const last = this.state.players[lastIndex];
      last.finishPlace = this.state.standings.length + 1;
      this.state.standings.push(lastIndex);
      this.addLog(`${last.name} zajmuje ${last.finishPlace}. miejsce.`);
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

    // Żądanie asa dotyczy wyłącznie następnego gracza. Jeśli nie zostało
    // zastąpione kolejnym asem, wygasa wraz z końcem jego tury.
    if (this.state.aceDemand?.targetIndex === actorIndex) {
      this.state.aceDemand = null;
    }

    this.state.drawnRescueCardId = null;
    this.state.makaoArmed = false;
    this.state.currentIndex = this.nextActiveIndex(actorIndex);
    this.state.turnNumber += 1;
    this.emit();
    this.queueCurrentTurn();
  }
}
