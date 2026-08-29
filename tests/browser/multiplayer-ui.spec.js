import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'phone-portrait', width: 390, height: 844 },
  { name: 'phone-landscape', width: 844, height: 390 },
];

for (const viewport of VIEWPORTS) {
  test(`multiplayer lobby stays usable on ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/index.html');
    await page.evaluate(() => window.makaoMultiplayer.debugHostLobby({
      tableSize: 4,
      connectedSeats: [1],
      botSeats: [2, 3],
    }));

    const modal = page.locator('#multiplayer-modal');
    await expect(modal).toHaveClass(/open/);
    await expect(page.locator('#mp-room-code-display')).toContainText('TEST-ROOM');
    await expect(page.locator('#mp-seats .mp-seat')).toHaveCount(4);
    await expect(page.locator('#mp-start-game')).toBeEnabled();
    await expect(page.locator('#mp-leave-room')).toBeVisible();

    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }));
    expect(overflow.document).toBeLessThanOrEqual(1);
    expect(overflow.body).toBeLessThanOrEqual(1);

    for (const selector of ['#mp-room-code-display', '#mp-seats', '#mp-start-game', '#mp-leave-room']) {
      const box = await page.locator(selector).boundingBox();
      expect(box, `${selector} should have a layout box`).not.toBeNull();
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 2);
      expect(box.x).toBeGreaterThanOrEqual(-2);
    }
  });
}
