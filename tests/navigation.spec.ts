import { test } from '@playwright/test';
import { NavigationPage } from '../pages/navigation-page';

test.describe('Site navigation @smoke', () => {
  test('navigates from home to Contact via the main nav', async ({ page }) => {
    const nav = new NavigationPage(page);
    await nav.gotoHome();
    await nav.clickNavLink('contact');
    await nav.expectOnPage('contact');
  });
});