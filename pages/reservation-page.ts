import { Page, expect } from '@playwright/test';
import { BasePage } from './base-page';

/**
 * The page Book Now lands on: /reserve/property/<slug>?adult=N&from=M/D/YYYY&to=M/D/YYYY
 * Collects guest details before a real reservation is submitted.
 * This page object deliberately stops short of the final submit -
 * see the note in reservation.spec.ts.
 */
export class ReservationPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async expectFormVisible() {
    await expect(this.page.getByRole('textbox', { name: 'First Name*' })).toBeVisible({ timeout: 15_000 });
    await expect(this.page.getByRole('textbox', { name: 'Last Name*' })).toBeVisible();
    await expect(this.page.getByRole('textbox', { name: 'Email*' })).toBeVisible();
  }

  async fillGuestDetails(details: { firstName: string; lastName: string; email: string; phone: string }) {
    await this.page.getByRole('textbox', { name: 'First Name*' }).fill(details.firstName);
    await this.page.getByRole('textbox', { name: 'Last Name*' }).fill(details.lastName);
    await this.page.getByRole('textbox', { name: 'Enter phone number' }).fill(details.phone);
    await this.page.getByRole('textbox', { name: 'Email*' }).fill(details.email);
  }

  /** Country is a searchable autocomplete: type a partial name, pick the matching suggestion. */
  async selectCountry(searchText: string, optionText: string | RegExp) {
    await this.page.getByText('Country').click();
    await this.page.getByPlaceholder('Country').fill(searchText);
    await this.page.locator('div').filter({ hasText: optionText }).nth(3).click();
  }

  async expandThingsToKnow() {
    await this.page.getByRole('button', { name: 'THINGS TO KNOW' }).click();
  }

  async acceptTermsAndPolicy() {
    await this.page.locator('#read_terms_policy').click();
  }

  async optInPromotions() {
    await this.page.locator('#interested_in_promotions').click();
  }

  /**
   * The real submit button - NEVER called by the pilot's automated tests.
   * Left here only so a human can call it deliberately (e.g. in a manual
   * debugging session), since clicking it creates a real reservation.
   */
  async dangerouslySubmitRealReservation() {
    await this.page.getByRole('button', { name: 'Book now' }).nth(1).click();
  }
}