import { test } from '@playwright/test';
import { HomePage } from '../pages/home-page';

test.describe('Home page @smoke', () => {
  test('loads the staging homepage past basic auth', async ({ page }) => {
    const home = new HomePage(page);
    await home.gotoHome();
    await home.expectLoaded();
  });
});