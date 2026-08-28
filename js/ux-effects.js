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
      animateStateChange({ before, state, ui, hand, drawPile, discard, opponents, motionToggle, humanPlayRects });
      humanPlayRects = [];
    });
    previous = snapshot(state);
  };

  // The initial render is invoked directly from main.js, so keep the hand
  // responsive on resize as well.
  window.addEventListener('resize', () => requestAnimationFrame(() => compressHumanHand(hand)));
  requestAnimationFrame(() => compressHumanHand(hand));
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
  if (cards.length < 2) return;

  // On very small screens horizontal scrolling is preferable to excessive
  // overlap, because the baseline mobile layout already supports it.
  if (window.innerWidth <= 560) {
    cards.forEach((card, index) => {
      card.style.marginLeft = index === 0 ? '0px' : '-18px';
    });
    return;
  }

  const available = Math.max(260, hand.clientWidth - 20);
  const sampleWidth = cards[0].getBoundingClientRect().width || 106;
  const step = Math.max(sampleWidth * .28, Math.min(sampleWidth * .78, (available - sampleWidth) / (cards.length - 1)));
  const margin = Math.round(step - sampleWidth);

  cards.forEach((card, index) => {
    card.style.marginLeft = index === 0 ? '0px' : `${margin}px`;
  });
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
  return seat?.querySelector('.opponent-hand')?.getBoundingClientRect() ?? seat?.getBoundingClientRect() ?? null;
}

function botTargetRect(opponents, playerIndex) {
  return botSourceRect(opponents, playerIndex);
}

function discardTargetRect(discard) {
  return discard?.querySelector('.table-card')?.getBoundingClientRect() ?? discard?.getBoundingClientRect() ?? null;
}

function flyFaceCard(ui, card, from, to) {
  const element = ui.makeCard(card, { table: true });
  prepareFlight(element, from, to, 7);
}

function flyBackCard(from, to) {
  const element = document.createElement('div');
  element.className = 'card card-back';
  element.innerHTML = '<div class="back-inner"><span>MAKAO</span></div>';
  prepareFlight(element, from, to, -6);
}

function prepareFlight(element, from, to, rotation) {
  const width = Math.max(46, Math.min(120, from.width || 106));
  const height = Math.max(64, Math.min(168, from.height || 152));
  const targetX = to.left + (to.width - width) / 2;
  const targetY = to.top + (to.height - height) / 2;
  const dx = targetX - from.left;
  const dy = targetY - from.top;

  element.classList.add('ux-flight-card');
  element.style.left = `${from.left}px`;
  element.style.top = `${from.top}px`;
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
