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

async function viewportHealth(page) {
  return page.evaluate(() => {
    const hand = document.getElementById('human-hand')?.getBoundingClientRect();
    const action = document.getElementById('action-bar')?.getBoundingClientRect();
    const felt = document.getElementById('felt-table')?.getBoundingClientRect();
    return {
      innerHeight,
      docHeight: document.documentElement.scrollHeight,
      handBottom: hand?.bottom ?? 0,
      actionBottom: action?.bottom ?? 0,
      feltBottom: felt?.bottom ?? 0,
    };
  });
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

test('browser agent plays complete games through the real UI without layout escape', async ({ page }) => {
  test.setTimeout(120_000);
  const gameCount = Math.max(2, Number.parseInt(process.env.UI_GAME_COUNT ?? '12', 10) || 12);

  // Keep the genuine event/timer flow, only accelerate long presentation delays.
  await page.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = (callback, delay = 0, ...args) => nativeSetTimeout(callback, Math.min(Number(delay) || 0, 3), ...args);
  });

  for (let gameNo = 0; gameNo < gameCount; gameNo += 1) {
    await page.goto('/index.html');
    await page.waitForFunction(() => Boolean(window.makaoGame));
    const bots = gameNo % 2 === 0 ? 2 : 3;

    const motion = page.locator('#motion-toggle');
    if (await motion.isChecked()) await motion.uncheck();
    await page.locator(`[data-bots="${bots}"]`).click();
    await page.locator('#start-btn').click();

    const deadline = Date.now() + 15_000;
    let humanActions = 0;
    let samples = 0;

    while (Date.now() < deadline) {
      const state = await page.evaluate(() => {
        const game = window.makaoGame;
        const human = game.state.players[0];
        return {
          gameOver: game.state.gameOver,
          currentIndex: game.state.currentIndex,
          pendingChoice: game.state.pendingChoice?.type ?? null,
          canAct: game.humanCanAct(),
          rescueId: game.state.drawnRescueCardId,
          humanCards: human?.hand.length ?? 0,
          turnNumber: game.state.turnNumber,
        };
      });

      if (state.gameOver) break;

      if (state.currentIndex === 0 && state.pendingChoice) {
        await page.waitForSelector('#choice-options .choice-button', { timeout: 1000 });
        const none = page.locator('#choice-options .no-demand-choice');
        if (state.pendingChoice === 'jack' && await none.count()) await none.click();
        else await page.locator('#choice-options .choice-button').first().click();
        humanActions += 1;
      } else if (state.currentIndex === 0 && state.canAct) {
        if (state.rescueId) {
          const rescue = page.locator(`#human-hand [data-card-id="${state.rescueId}"]`);
          await rescue.scrollIntoViewIfNeeded();
          await rescue.click();
          if (state.humanCards <= 2 && await page.locator('#makao-btn').isEnabled()) await page.locator('#makao-btn').click();
          await page.locator('#play-btn').click();
        } else {
          const playable = page.locator('#human-hand .hand-card.playable:not(.disabled-card)');
          if (await playable.count()) {
            const choice = playable.first();
            await choice.scrollIntoViewIfNeeded();
            await choice.click();
            if (state.humanCards <= 2 && await page.locator('#makao-btn').isEnabled()) await page.locator('#makao-btn').click();
            await page.locator('#play-btn').click();
          } else {
            await page.locator('#draw-btn').click();
          }
        }
        humanActions += 1;
      }

      if ((humanActions + samples) % 8 === 0) {
        const layout = await viewportHealth(page);
        expect(layout.docHeight, `game ${gameNo + 1}: document escaped viewport`).toBeLessThanOrEqual(layout.innerHeight + 2);
        expect(layout.handBottom, `game ${gameNo + 1}: hand escaped viewport`).toBeLessThanOrEqual(layout.innerHeight + 1);
        expect(layout.actionBottom, `game ${gameNo + 1}: controls escaped viewport`).toBeLessThanOrEqual(layout.innerHeight + 1);
        expect(layout.feltBottom, `game ${gameNo + 1}: table escaped viewport`).toBeLessThanOrEqual(layout.innerHeight + 1);
        samples += 1;
      }

      await page.waitForTimeout(3);
    }

    const result = await page.evaluate(() => ({
      gameOver: window.makaoGame.state.gameOver,
      standings: window.makaoGame.state.standings.length,
      players: window.makaoGame.state.players.length,
      turnNumber: window.makaoGame.state.turnNumber,
    }));
    expect(result.gameOver, `browser game ${gameNo + 1} timed out at turn ${result.turnNumber}`).toBe(true);
    expect(result.standings).toBe(result.players);
  }
});
