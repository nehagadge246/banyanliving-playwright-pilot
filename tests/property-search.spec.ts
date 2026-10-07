import { test } from '@playwright/test';
import { SearchPage } from '../pages/search-page';

test.describe('Property search @regression', () => {
  test('finds a property by name via the "Where" search and reaches its page', async ({ page }) => {
    const search = new SearchPage(page);

    await search.goto('/');
    await search.searchPropertyByName('Angsana Oceanview Residences');

    await page.waitForURL(/\/property\//, { timeout: 15_000 });
  });
});