import { test } from '@playwright/test';
import { SearchPage } from '../pages/search-page';
import { PropertyPage } from '../pages/property-page';

const PROPERTY_SLUG = 'reef-residences-3-three-bedroom-3b-premium';
const LISTING_PATH = process.env.BANYAN_LISTING_PATH || '/';

async function bookFromPropertyPage(property: PropertyPage) {
  await property.selectStayDates();
  await property.openGuestsSelector();
  await property.incrementAdults(1);
  await property.confirmGuests();
  await property.clickSearch();
  await property.expectTotalPriceShown();
  await property.clickBookNow();
  // Stops here deliberately: the reserve page's own "Book now" submits a
  // real reservation and is covered separately (see reservation.spec.ts),
  // never auto-submitted by this suite.
  await property.expectNavigatedToReserve();
}

test.describe('Book Now @regression', () => {
  test('listing -> property details -> dates/guests -> price -> Book Now', async ({ page }) => {
    const search = new SearchPage(page);
    const property = new PropertyPage(page);

    await search.goto(LISTING_PATH);
    await search.openFirstProperty();

    await bookFromPropertyPage(property);
  });

  test('opens a known property directly and books', async ({ page }) => {
    const property = new PropertyPage(page);
    await property.gotoProperty(PROPERTY_SLUG);
    await bookFromPropertyPage(property);
  });
});