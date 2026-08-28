import { test, expect } from '@playwright/test';

async function ready(page) {
  await page.goto('/index.html');
  await page.waitForFunction(() => Boolean(window.makaoGame));
  await page.evaluate(() => document.getElementById('main-menu')?.classList.remove('open'));
}

async function setHumanScenario(page, { hand, top, bots = 2 }) {
  await page.evaluate(({ hand, top, bots }) => {
    const game = window.makaoGame;
    clearTimeout(game.timer);
    game.queueCurrentTurn = () => {};
    game.state = game.emptyState();
    game.state.started = true;
    game.state.botCount = bots;
    game.state.players = game.createPlayers(bots);
    game.state.currentIndex = 0;
    game.state.players[0].hand = hand;
    game.state.discardPile = [top];
    game.state.drawPile = [];
    game.emit();
    document.getElementById('main-menu')?.classList.remove('open');
  }, { hand, top, bots });
  await page.waitForTimeout(50);
}

function buildDeck() {
  const ranks = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const suits = ['clubs','diamonds','hearts','spades'];
  return suits.flatMap((suit) => ranks.map((rank) => ({ id: `${rank}-${suit}`, rank, suit })));
}

test('40-card hand stays inside viewport and remains individually reachable', async ({ page }) => {
  await ready(page);
  const deck = buildDeck();
  const top = { id: 'Q-hearts', rank: 'Q', suit: 'hearts' };
  const hand = deck.filter((card) => card.id !== top.id).slice(0, 40);
  await setHumanScenario(page, { hand, top });

  await expect(page.locator('#human-hand')).toHaveClass(/hand-scroll-mode/);
  await expect(page.locator('#human-hand .hand-card')).toHaveCount(40);

  const layout = await page.evaluate(() => {
    const hand = document.getElementById('human-hand').getBoundingClientRect();
    const action = document.getElementById('action-bar').getBoundingClientRect();
    const felt = document.getElementById('felt-table').getBoundingClientRect();
    return {
      innerHeight,
      docHeight: document.documentElement.scrollHeight,
      handTop: hand.top,
      handBottom: hand.bottom,
      actionCenter: action.left + action.width / 2,
      handCenter: hand.left + hand.width / 2,
      actionWidth: action.width,
      feltBottom: felt.bottom,
    };
  });

  expect(layout.docHeight).toBeLessThanOrEqual(layout.innerHeight + 2);
  expect(layout.handBottom).toBeLessThanOrEqual(layout.innerHeight + 1);
  expect(layout.feltBottom).toBeLessThanOrEqual(layout.innerHeight + 1);
  expect(layout.actionWidth).toBeLessThan(620);
  expect(Math.abs(layout.actionCenter - layout.handCenter)).toBeLessThan(8);

  for (const index of [0, 10, 20, 39]) {
    const locator = page.locator('#human-hand .hand-card').nth(index);
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    const box = await locator.boundingBox();
    expect(box.width).toBeGreaterThan(80);
    expect(box.height).toBeGreaterThan(110);
    await locator.click();
  }
});

test('Jack choice exposes only held 5-10 ranks plus Nic and does not cover hand', async ({ page }) => {
  await ready(page);
  const hand = [
    { id: 'J-hearts', rank: 'J', suit: 'hearts' },
    { id: '5-clubs', rank: '5', suit: 'clubs' },
    { id: '7-diamonds', rank: '7', suit: 'diamonds' },
    { id: 'K-clubs', rank: 'K', suit: 'clubs' },
    { id: 'A-spades', rank: 'A', suit: 'spades' },
  ];
  await setHumanScenario(page, { hand, top: { id: '9-hearts', rank: '9', suit: 'hearts' } });

  await page.evaluate(() => {
    const game = window.makaoGame;
    game.playCards(0, [game.state.players[0].hand.find((card) => card.id === 'J-hearts')]);
  });

  await expect(page.locator('#choice-modal')).toHaveClass(/open/);
  const labels = await page.locator('#choice-options .choice-button').allTextContents();
  const joined = labels.map((text) => text.replace(/\s+/g, ' ').trim());
  expect(joined.some((text) => text.startsWith('5'))).toBe(true);
  expect(joined.some((text) => text.startsWith('7'))).toBe(true);
  expect(joined.some((text) => text.startsWith('Nic'))).toBe(true);
  for (const forbidden of ['6', '8', '9', '10']) {
    expect(joined.some((text) => text === forbidden || text.startsWith(`${forbidden} `))).toBe(false);
  }

  const positions = await page.evaluate(() => {
    const choice = document.querySelector('#choice-modal .choice-card').getBoundingClientRect();
    const hand = document.getElementById('human-hand').getBoundingClientRect();
    const overlay = getComputedStyle(document.getElementById('choice-modal'));
    return { choiceBottom: choice.bottom, handTop: hand.top, overlayPointerEvents: overlay.pointerEvents };
  });
  expect(positions.choiceBottom).toBeLessThanOrEqual(positions.handTop + 8);
  expect(positions.overlayPointerEvents).toBe('none');
});

test('Ace choice keeps hand visible and shows all four suit options with hand counts', async ({ page }) => {
  await ready(page);
  const hand = [
    { id: 'A-hearts', rank: 'A', suit: 'hearts' },
    { id: '5-hearts', rank: '5', suit: 'hearts' },
    { id: '7-hearts', rank: '7', suit: 'hearts' },
    { id: '9-clubs', rank: '9', suit: 'clubs' },
    { id: 'K-clubs', rank: 'K', suit: 'clubs' },
  ];
  await setHumanScenario(page, { hand, top: { id: '9-hearts', rank: '9', suit: 'hearts' } });

  await page.evaluate(() => {
    const game = window.makaoGame;
    game.playCards(0, [game.state.players[0].hand.find((card) => card.id === 'A-hearts')]);
  });

  await expect(page.locator('#choice-modal')).toHaveClass(/open/);
  await expect(page.locator('#choice-options .suit-choice')).toHaveCount(4);
  const labels = (await page.locator('#choice-options .suit-choice').allTextContents()).map((text) => text.replace(/\s+/g, ' ').trim());
  expect(labels.some((text) => text.includes('Kier') && text.includes('2 w ręce'))).toBe(true);
  expect(labels.some((text) => text.includes('Trefl') && text.includes('2 w ręce'))).toBe(true);

  const visible = await page.evaluate(() => {
    const hand = document.getElementById('human-hand').getBoundingClientRect();
    const choice = document.querySelector('#choice-modal .choice-card').getBoundingClientRect();
    return {
      handInViewport: hand.top >= 0 && hand.bottom <= innerHeight + 1,
      noOverlap: choice.bottom <= hand.top + 8,
      handOpacity: Number(getComputedStyle(document.getElementById('human-hand')).opacity || 1),
    };
  });
  expect(visible.handInViewport).toBe(true);
  expect(visible.noOverlap).toBe(true);
  expect(visible.handOpacity).toBeGreaterThan(0.9);
});
