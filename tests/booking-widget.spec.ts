import { test } from '@playwright/test';
import { SearchPage } from '../pages/search-page';

test.describe('Booking widget @regression', () => {
  test('selects a date range, adjusts guests, and applies', async ({ page }) => {
    const search = new SearchPage(page);
    await search.goto('/');

    await search.openDatesPicker();
    await search.selectDateRange();
    await search.confirmSelection();

    await search.openGuestsSelector();
    await search.incrementAdults(2);
    await search.confirmSelection();

    await search.expectBookNowEnabled();
  });
});