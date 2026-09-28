import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base-page';

export class SearchPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoByState(state: string) {
    await this.goto(`/locations/${state}`);
  }

  async gotoByBrand(brand: string) {
    await this.goto(`/brands/${brand}`);
  }

  private visibleGuestsField(): Locator {
    return this.page
      .getByRole('button', { name: /guests?/i })
      .filter({ visible: true })
      .first();
  }

  /** Dates trigger reads "Dates" before selection, then the applied range text. */
  private visibleDatesField(): Locator {
    return this.page
      .getByRole('button', { name: /dates?|\d{1,2},\s?\d{4}/i })
      .filter({ visible: true })
      .first();
  }

  async openDatesPicker() {
    await this.dismissCookieBanner();
    await this.safeClick(this.visibleDatesField());
  }

  async openGuestsSelector() {
    await this.dismissCookieBanner();
    await this.safeClick(this.visibleGuestsField());
  }

  async incrementAdults(times: number = 1) {
    const button = this.page
      .getByRole('button', { name: 'Increase value' })
      .filter({ visible: true })
      .first();
    for (let i = 0; i < times; i++) {
      await this.dismissCookieBanner();
      await this.safeClick(button);
    }
  }

  async decrementAdults(times: number = 1) {
    const button = this.page
      .getByRole('button', { name: 'Decrease value' })
      .filter({ visible: true })
      .first();
    for (let i = 0; i < times; i++) {
      await this.dismissCookieBanner();
      await this.safeClick(button);
    }
  }

  /** One shared Apply button commits whichever panel (Dates or Guests) is open. */
  async confirmSelection() {
    await this.dismissCookieBanner();
    await this.safeClick(
      this.page.getByRole('button', { name: /apply/i }).filter({ visible: true }).first()
    );
  }

  async expectBookNowEnabled() {
    await expect(
      this.page.getByRole('button', { name: /book now/i }).filter({ visible: true }).first()
    ).toBeEnabled();
  }

  /** Clicks the first property card/link on the current listing page. */
  async openFirstProperty() {
    await this.dismissCookieBanner();
    const link = this.page.locator('a[href*="/property/"]').filter({ visible: true }).first();
    await link.waitFor({ state: 'visible', timeout: 15_000 });
    await this.safeClick(link);
    await this.page.waitForURL(/\/property\//, { timeout: 15_000 });
  }
}