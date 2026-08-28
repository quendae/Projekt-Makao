// Visual-only UX layer: card flight animations and hand compression.
// It deliberately does not contain Makao rules.

export function installUxEffects(game, ui) {
  let previous = snapshot(game.state);
  let humanPlayRects = [];

  const playButton = document.getElementById('play-btn');
  const hand = document.getElementById('human-hand');
  const drawPile = document.getElementById('draw-pile');
  const discard = document.getElementById('discard-pile');
  const opponents = document.getElementById('opponents');
  const motionToggle = document.getElementById('motion-toggle');

  // Capture selected-card coordinates before the normal click handler mutates
  // the hand and rerenders it.
  playButton?.addEventListener('click', () => {
    humanPlayRects = [...hand.querySelectorAll('.hand-card.selected')]
      .map((element) => element.getBoundingClientRect())
      .sort((a, b) => a.left - b.left);
  }, true);

  const baseRender = (state) => ui.render(state);
  game.onChange = (state) => {
    const before = previous;
    baseRender(state);
    requestAnimationFrame(() => {
      compressHumanHand(hand);
      enhanceChoicePanel(game, state);
      animateStateChange({ before, state, ui, hand, drawPile, discard, opponents, motionToggle, humanPlayRects });
      humanPlayRects = [];
    });
    previous = snapshot(state);
  };

  // The initial render is invoked directly from main.js, so keep the hand
  // responsive on resize as well.
  window.addEventListener('resize', () => requestAnimationFrame(() => compressHumanHand(hand)));
  requestAnimationFrame(() => {
    compressHumanHand(hand);
    enhanceChoicePanel(game, game.state);
  });
}

function snapshot(state) {
  return {
    started: Boolean(state.started),
    currentIndex: state.currentIndex,
    discardCount: state.discardPile?.length ?? 0,
    playerHands: (state.players ?? []).map((player) => player.hand.map((card) => card.id)),
  };
}

function motionEnabled(toggle) {
  return Boolean(toggle?.checked) && !document.body.classList.contains('reduce-motion');
}

function compressHumanHand(hand) {
  if (!hand) return;
  const cards = [...hand.querySelectorAll('.hand-card')];
  hand.classList.remove('hand-scroll-mode');
  if (cards.length < 2) return;

  const available = Math.max(260, hand.clientWidth - 24);
  const sampleWidth = cards[0].getBoundingClientRect().width || 106;
  const idealStep = (available - sampleWidth) / Math.max(1, cards.length - 1);
  const minClickableStep = window.innerWidth <= 560 ? 44 : 48;
  const useScrollRack = window.innerWidth <= 560 || idealStep < minClickableStep;

  if (useScrollRack) {
    // Once a hand needs scrolling, do NOT overlap cards at all. A previous
    // version exposed ~48 px of every card but the next card still covered the
    // centre hit target, so visually reachable cards were not reliably
    // clickable. Horizontal scrolling is preferable to ambiguous hitboxes.
    hand.classList.add('hand-scroll-mode');
    cards.forEach((card) => {
      card.style.marginLeft = '0px';
      card.style.setProperty('--angle', '0deg');
      card.style.setProperty('--hover-angle', '0deg');
      card.style.setProperty('--selected-angle', '0deg');
      card.style.setProperty('--drop', '0px');
    });
    return;
  }

  const step = Math.min(sampleWidth * .78, idealStep);
  const margin = Math.round(step - sampleWidth);
  cards.forEach((card, index) => {
    card.style.marginLeft = index === 0 ? '0px' : `${margin}px`;
  });
}

function enhanceChoicePanel(game, state) {
  const modal = document.getElementById('choice-modal');
  const options = document.getElementById('choice-options');
  const description = document.getElementById('choice-description');
  const choice = state.pendingChoice;
  if (!modal || !options || !choice) return;

  modal.classList.add('choice-peek-overlay');
  const actor = state.players[choice.actorIndex];
  if (!actor) return;

  if (choice.type === 'jack') {
    const allowed = new Map();
    for (const card of actor.hand) {
      if (['5', '6', '7', '8', '9', '10'].includes(card.rank)) {
        allowed.set(card.rank, (allowed.get(card.rank) ?? 0) + 1);
      }
    }

    options.querySelectorAll('.rank-choice').forEach((button) => {
      const rank = button.textContent.trim();
      const count = allowed.get(rank) ?? 0;
      if (!count) {
        button.remove();
        return;
      }
      button.innerHTML = `<b>${rank}</b><small>${count} ${count === 1 ? 'karta' : 'karty'} w ręce</small>`;
    });

    const none = document.createElement('button');
    none.className = 'choice-button no-demand-choice';
    none.innerHTML = '<b>Nic</b><small>bez żądania</small>';
    none.addEventListener('click', () => game.choosePending(null));
    options.appendChild(none);

    if (description) {
      description.textContent = allowed.size
        ? 'Możesz zażądać tylko wartości 5–10, którą nadal masz w ręce, albo nie żądać niczego.'
        : 'Nie masz w ręce żadnej wartości 5–10. Wybierz „Nic”.';
    }
  } else if (choice.type === 'ace') {
    const suitMap = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
    const counts = Object.fromEntries(Object.keys(suitMap).map((suit) => [suit, actor.hand.filter((card) => card.suit === suit).length]));
    options.querySelectorAll('.suit-choice').forEach((button) => {
      const suit = Object.keys(suitMap).find((key) => button.classList.contains(`suit-${key}`));
      if (!suit) return;
      const label = button.querySelector('span')?.textContent ?? '';
      button.innerHTML = `<b>${suitMap[suit]}</b><span>${label}<small>${counts[suit]} w ręce</small></span>`;
    });
    if (description) description.textContent = 'Wybierz kolor dla następnego gracza. Twoja ręka pozostaje widoczna, a liczby pokazują ile kart danego koloru masz.';
  }
}

function animateStateChange({ before, state, ui, hand, drawPile, discard, opponents, motionToggle, humanPlayRects }) {
  if (!before?.started || !state.started || !motionEnabled(motionToggle)) return;

  const newSnapshot = snapshot(state);
  const actorIndex = before.currentIndex;
  const discardDelta = newSnapshot.discardCount - before.discardCount;
  let baseDelay = 0;

  if (discardDelta > 0) {
    const played = state.discardPile.slice(-discardDelta);
    played.forEach((card, index) => {
      const from = actorIndex === 0
        ? humanPlayRects[index] ?? humanSourceRect(hand)
        : botSourceRect(opponents, actorIndex);
      const to = discardTargetRect(discard);
      if (from && to) {
        window.setTimeout(() => flyFaceCard(ui, card, from, to), index * 95);
      }
    });
    baseDelay = discardDelta * 95;
  }

  newSnapshot.playerHands.forEach((ids, playerIndex) => {
    const beforeIds = new Set(before.playerHands[playerIndex] ?? []);
    const addedIds = ids.filter((id) => !beforeIds.has(id));
    if (!addedIds.length) return;

    // Temporarily dim the actually-added human cards so the deck->hand flight
    // reads as the arrival instead of an instant pop-in behind the animation.
    if (playerIndex === 0) {
      addedIds.forEach((id) => {
        const element = [...hand.querySelectorAll('[data-card-id]')].find((item) => item.dataset.cardId === id);
        element?.classList.add('ux-arriving-card');
        window.setTimeout(() => element?.classList.remove('ux-arriving-card'), baseDelay + addedIds.length * 105 + 430);
      });
    }

    addedIds.forEach((_, index) => {
      const from = drawPile?.getBoundingClientRect();
      const to = playerIndex === 0 ? humanTargetRect(hand) : botTargetRect(opponents, playerIndex);
      if (from && to) {
        window.setTimeout(() => flyBackCard(from, to), baseDelay + index * 105);
      }
    });
  });
}

function humanSourceRect(hand) {
  const selected = hand?.querySelector('.hand-card.selected');
  const any = selected ?? hand?.querySelector('.hand-card');
  return any?.getBoundingClientRect() ?? hand?.getBoundingClientRect() ?? null;
}

function humanTargetRect(hand) {
  const cards = [...(hand?.querySelectorAll('.hand-card') ?? [])];
  return cards.at(-1)?.getBoundingClientRect() ?? hand?.getBoundingClientRect() ?? null;
}

function botSeat(opponents, playerIndex) {
  // Bots are players 1..N and rendered in the same order.
  return opponents?.querySelectorAll('.opponent-seat')?.[playerIndex - 1] ?? null;
}

function botSourceRect(opponents, playerIndex) {
  const seat = botSeat(opponents, playerIndex);
  const visibleBacks = seat ? [...seat.querySelectorAll('.mini-back')] : [];
  return visibleBacks.at(-1)?.getBoundingClientRect()
    ?? seat?.querySelector('.opponent-hand')?.getBoundingClientRect()
    ?? seat?.getBoundingClientRect()
    ?? null;
}

function botTargetRect(opponents, playerIndex) {
  return botSourceRect(opponents, playerIndex);
}

function discardTargetRect(discard) {
  return discard?.querySelector('.table-card')?.getBoundingClientRect() ?? discard?.getBoundingClientRect() ?? null;
}

function flyFaceCard(ui, card, from, to) {
  const element = ui.makeCard(card, { table: true });
  const compact = window.innerWidth <= 820;
  prepareFlight(element, from, to, 7, {
    width: compact ? 78 : 106,
    height: compact ? 110 : 152,
  });
}

function flyBackCard(from, to) {
  const element = document.createElement('div');
  element.className = 'card card-back';
  element.innerHTML = '<div class="back-inner"><span>MAKAO</span></div>';
  prepareFlight(element, from, to, -6);
}

function prepareFlight(element, from, to, rotation, size = null) {
  const width = size?.width ?? Math.max(46, Math.min(120, from.width || 106));
  const height = size?.height ?? Math.max(64, Math.min(168, from.height || 152));
  const sourceX = from.left + (from.width - width) / 2;
  const sourceY = from.top + (from.height - height) / 2;
  const targetX = to.left + (to.width - width) / 2;
  const targetY = to.top + (to.height - height) / 2;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;

  element.classList.add('ux-flight-card');
  element.style.left = `${sourceX}px`;
  element.style.top = `${sourceY}px`;
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;
  element.style.transform = 'translate(0,0) rotate(0deg) scale(1)';
  document.body.appendChild(element);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      element.classList.add('is-flying');
      element.style.transform = `translate(${dx}px, ${dy}px) rotate(${rotation}deg) scale(.96)`;
      element.style.opacity = '.9';
    });
  });

  window.setTimeout(() => element.remove(), 520);
}
