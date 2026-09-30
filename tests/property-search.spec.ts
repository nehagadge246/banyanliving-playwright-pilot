import { test } from '@playwright/test';
import { SearchPage } from '../pages/search-page';

test.describe('Property search @regression', () => {
  // TODO: the "Where" search box is not visible/reachable on the tablet
  // layout - skip until someone maps how it opens there (likely a
  // collapsed search trigger, similar to the property booking panel).
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'tablet', '"Where" search not mapped on tablet yet');
  });

  test('finds a property by name via the "Where" search and reaches its page', async ({ page }) => {
    const search = new SearchPage(page);

    await search.goto('/');
    await search.searchPropertyByName('Angsana Oceanview Residences');

    await page.waitForURL(/\/property\//, { timeout: 15_000 });
  });
});