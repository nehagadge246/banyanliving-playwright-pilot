import { test, expect } from '@playwright/test';
import { SearchPage } from '../pages/search-page';
import { PropertyPage } from '../pages/property-page';

const PROPERTY_SLUG = 'reef-residences-3-three-bedroom-3b-premium';
// Page that lists property cards. Defaults to the home page; override in .env.pilot if needed.
const LISTING_PATH = process.env.BANYAN_LISTING_PATH || '/';

async function bookFromPropertyPage(property: PropertyPage) {
  await property.selectStayDates();
  await property.openGuestsSelector();
  await property.incrementAdults(1);
  await property.confirmGuestsIfNeeded();
  await property.clickSearchIfPresent();
  await property.expectTotalPriceShown();
  await property.clickBookNow();
}

test.describe('Book Now @regression', () => {
  // TODO: the tablet layout hides the booking panel; enable once its opener is mapped.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name === 'tablet', 'Tablet booking panel not mapped yet');
  });

  test('listing -> property details -> dates/guests -> price -> Book Now', async ({ page }) => {
    const search = new SearchPage(page);
    const property = new PropertyPage(page);

    await search.goto(LISTING_PATH);
    await search.openFirstProperty();
    await expect(page).toHaveURL(/\/property\//);

    await bookFromPropertyPage(property);
  });

  test('opens a known property directly and books', async ({ page }) => {
    const property = new PropertyPage(page);
    await property.gotoProperty(PROPERTY_SLUG);
    await bookFromPropertyPage(property);
  });
});