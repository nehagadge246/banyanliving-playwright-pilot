import { test, expect } from '@playwright/test';
import { PropertyPage } from '../pages/property-page';
import { ReservationPage } from '../pages/reservation-page';

const PROPERTY_SLUG = 'reef-residences-3-three-bedroom-3b-premium';

test.describe('Reservation page @regression', () => {
  // This test reaches the /reserve/ page and checks its form and query
  // parameters. It deliberately does NOT submit the reservation - the real
  // "Book now" button on this page creates an actual booking, which a
  // pilot QA suite should never trigger automatically. Submission is left
  // for manual or environment-gated testing.
  test('Book Now leads to a reserve page carrying the selected dates and guests', async ({ page }) => {
    const property = new PropertyPage(page);
    const reservation = new ReservationPage(page);

    await property.gotoProperty(PROPERTY_SLUG);
    await property.selectStayDates();
    await property.openGuestsSelector();
    await property.incrementAdults(1);
    await property.confirmGuests();
    await property.clickSearch();
    await property.clickBookNow();

    await property.expectNavigatedToReserve();
    await expect(page).toHaveURL(/adult=\d+/);
    await expect(page).toHaveURL(/from=\d{1,2}%2F\d{1,2}%2F\d{4}/);
    await expect(page).toHaveURL(/to=\d{1,2}%2F\d{1,2}%2F\d{4}/);

    await reservation.expectFormVisible();
  });
});