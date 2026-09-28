import { test } from '@playwright/test';
import { SearchPage } from '../pages/search-page';

test.describe('Location search @regression', () => {
  test('opens a state listing page', async ({ page }) => {
    const search = new SearchPage(page);
    await search.gotoByState('michigan');
  });
});