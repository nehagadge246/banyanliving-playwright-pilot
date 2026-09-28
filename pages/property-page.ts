import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base-page';

export class PropertyPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoProperty(slug: string) {
    await this.goto(`/property/${slug}`);
  }

  /**
   * Labels inside the booking panel (Check-In, Check-Out) are <p> elements.
   * Matching <p> with exact text avoids the header search bar, which also
   * has "Dates" / "Guests".
   */
  private panelLabel(text: string): Locator {
    return this.page
      .locator('p')
      .filter({ hasText: new RegExp(`^\\s*${text}\\s*$`, 'i') })
      .filter({ visible: true })
      .first();
  }

  /**
   * The Guests trigger is not a <p>. Find it inside the booking panel (the
   * smallest block holding both "Check-In" and "Promo code"), by its
   * "Guests" label. Fall back to the "1 Adult" summary text.
   */
  private guestsTrigger(): Locator {
    const panel = this.page
      .locator('div')
      .filter({ has: this.page.getByText(/^\s*Check-In\s*$/i) })
      .filter({ has: this.page.getByText(/promo code/i) })
      .last();
    return panel
      .getByText(/^\s*guests?\s*$/i)
      .filter({ visible: true })
      .first()
      .or(this.page.getByText(/^\s*\d+\s+adults?/i).filter({ visible: true }).first())
      .first();
  }

  /**
   * On narrower layouts (tablet) the booking panel is hidden behind a sticky
   * bar button. If Check-In is not visible, open the panel through that button.
   */
  async ensureBookingPanelOpen() {
    const label = this.panelLabel('Check-In');
    if (await label.isVisible().catch(() => false)) return;

    const opener = this.page
      .getByRole('button', { name: /book now|check availability|reserve|select dates/i })
      .filter({ visible: true })
      .last();
    if (await opener.isVisible().catch(() => false)) {
      await this.safeClick(opener);
    }
    await label.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  }

  async openCheckInPicker() {
    await this.dismissCookieBanner();
    await this.ensureBookingPanelOpen();
    await this.safeClick(this.panelLabel('Check-In'));
  }

  async openCheckOutPicker() {
    await this.dismissCookieBanner();
    await this.safeClick(this.panelLabel('Check-Out'));
  }

  /** Opens Check-In, picks the start day, then picks the end day (opening Check-Out if needed). */
  async selectStayDates(startIndex = 2, nights = 3) {
    await this.openCheckInPicker();
    const startLabel = await this.pickStartDay(startIndex);
    await this.page.waitForTimeout(500);
    if ((await this.dayCells().count()) === 0) {
      await this.openCheckOutPicker();
    }
    await this.pickEndDay(startLabel, nights);
  }

  async openGuestsSelector() {
    await this.dismissCookieBanner();
    await this.safeClick(this.guestsTrigger());
  }

  /** First "increase" stepper is Adults. Name differs per widget, so match loosely. */
  async incrementAdults(times: number = 1) {
    const button = this.page
      .getByRole('button', { name: /increase|increment|add adult|plus|^\+$/i })
      .filter({ visible: true })
      .first();
    await button.waitFor({ state: 'visible', timeout: 10_000 });
    for (let i = 0; i < times; i++) {
      await this.dismissCookieBanner();
      await this.safeClick(button);
    }
  }

  /** Some layouts need an Apply/Done click after changing guests; skip if absent. */
  async confirmGuestsIfNeeded() {
    const apply = this.page
      .getByRole('button', { name: /^(apply|done|confirm)$/i })
      .filter({ visible: true });
    if ((await apply.count()) > 0) {
      await this.safeClick(apply.first());
    }
  }

  async enterPromoCode(code: string) {
    await this.dismissCookieBanner();
    await this.page.getByPlaceholder(/enter your code here/i).fill(code);
  }

  async getTotalPrice(): Promise<string> {
    const total = this.page.getByText(/total for \d+ nights?/i).filter({ visible: true }).first();
    await total.waitFor({ state: 'visible', timeout: 15_000 });
    return (await total.locator('xpath=..').innerText()).trim();
  }

  async expectTotalPriceShown() {
    const text = await this.getTotalPrice();
    expect(text).toMatch(/\d/);
  }

  /** The panel's Book Now button comes after the header's "Book now", so take the last visible match. */
  async clickBookNow() {
    await this.dismissCookieBanner();
    const button = this.page
      .getByRole('button', { name: /^book now$/i })
      .filter({ visible: true })
      .last();
    await this.safeClick(button);
  }

  /**
   * Heart icon button sits next to "Share" and has no visible label.
   * Try an accessible name first, then fall back to the sibling of Share.
   */
  private wishlistToggle(): Locator {
    const byName = this.page
      .getByRole('button', { name: /wishlist|favou?rite/i })
      .filter({ visible: true })
      .first();
    const nextToShare = this.page
      .getByRole('button', { name: /share/i })
      .filter({ visible: true })
      .first()
      .locator('xpath=following-sibling::button[1]');
    return byName.or(nextToShare).first();
  }

  async toggleWishlist() {
    await this.dismissCookieBanner();
    await this.safeClick(this.wishlistToggle());
    // Give the wishlist request a moment to complete.
    await this.page.waitForTimeout(1000);
  }
}