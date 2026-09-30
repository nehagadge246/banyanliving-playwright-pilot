import { test } from '@playwright/test';
import { PropertyPage } from '../pages/property-page';

// Diagnostic only. Run with: $env:DEBUG_APPLY="1"; npx playwright test tests/debug-apply-disabled.spec.ts --project=chromium --headed
const PROPERTY_SLUG = 'reef-residences-3-three-bedroom-3b-premium';

test('debug: inspect day cells and Apply state around the two clicks', async ({ page }, testInfo) => {
  test.skip(!process.env.DEBUG_APPLY, 'Diagnostic test; set DEBUG_APPLY=1 to run it.');

  const property = new PropertyPage(page);
  await property.gotoProperty(PROPERTY_SLUG);

  async function dumpCells(label: string) {
    const cells = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button')).filter((b) =>
        /^\d{1,2}$/.test((b.textContent || '').trim())
      );
      return buttons.map((b, i) => ({
        i,
        text: (b.textContent || '').trim(),
        disabled: b.disabled,
        classes: (b.getAttribute('class') || '').split(' ').filter((c) => /select|disab|active|range|start|end/i.test(c)),
      }));
    });
    const apply = await page
      .getByRole('button', { name: 'Apply' })
      .filter({ visible: true })
      .first()
      .isEnabled()
      .catch(() => 'not found');
    console.log(`\n=== ${label} ===`);
    console.log('Apply enabled:', apply);
    console.log(JSON.stringify(cells, null, 2));
  }

  // Open the dates control (mirrors PropertyPage.openDatesPicker, inlined since it's private).
  await page.getByRole('button', { name: /check-in/i }).filter({ visible: true }).first().click();
  await page.waitForTimeout(500);
  await dumpCells('After opening calendar (before any day click)');

  const enabled = page.getByRole('button', { name: /^\d{1,2}$/, disabled: false }).filter({ visible: true });
  await enabled.first().waitFor({ state: 'visible', timeout: 10_000 });
  const startIndex = Math.min(2, (await enabled.count()) - 1);
  await enabled.nth(startIndex).click();
  await page.waitForTimeout(500);
  await dumpCells(`After clicking Check-In (index ${startIndex})`);

  const enabled2 = page.getByRole('button', { name: /^\d{1,2}$/, disabled: false }).filter({ visible: true });
  const count2 = await enabled2.count();
  const endIndex = Math.min(3, count2 - 1);
  await enabled2.nth(endIndex).click();
  await page.waitForTimeout(500);
  await dumpCells(`After clicking Check-Out (index ${endIndex} of ${count2})`);

  await page.screenshot({ path: testInfo.outputPath('after-both-clicks.png'), fullPage: true });
  console.log('\nScreenshot: ' + testInfo.outputPath('after-both-clicks.png'));
});