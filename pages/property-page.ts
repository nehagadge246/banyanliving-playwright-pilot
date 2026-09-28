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

  /** The booking panel: the smallest block holding both "Check-In" and "Promo code". */
  private bookingPanel(): Locator {
    return this.page
      .locator('div')
      .filter({ has: this.page.getByText(/^\s*Check-In\s*$/i) })
      .filter({ has: this.page.getByText(/promo code/i) })
      .last();
  }

  /** Short dump of visible page text, so a failure tells us what the page really showed. */
  private async describeState(): Promise<string> {
    const body = (await this.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const at = body.search(/check-in/i);
    const snippet = at >= 0 ? body.slice(Math.max(0, at - 40), at + 700) : body.slice(0, 700);
    const buttons = (await this.page.getByRole('button').filter({ visible: true }).allInnerTexts().catch(() => []))
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 25);
    return `URL: ${this.page.url()}\nVisible buttons: ${JSON.stringify(buttons)}\nPage text: ${snippet}`;
  }

  /**
   * The Guests trigger is not a <p>. Find it inside the booking panel (the
   * smallest block holding both "Check-In" and "Promo code"), by its
   * "Guests" label. Fall back to the "1 Adult" summary text.
   */
  private guestsTrigger(): Locator {
    return this.bookingPanel()
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
    try {
      await label.waitFor({ state: 'visible', timeout: 8_000 });
    } catch {
      throw new Error(`Booking panel (Check-In) is not visible on this layout.\n${await this.describeState()}`);
    }
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

  /** Text shown under a panel label; a <p class="selected-date"> that reads DD/MM/YYYY until set. */
  private dateValue(label: 'Check-In' | 'Check-Out'): Locator {
    return this.panelLabel(label).locator('xpath=following-sibling::p[1]');
  }

  private async expectDatesApplied() {
    try {
      for (const label of ['Check-In', 'Check-Out'] as const) {
        await expect(this.dateValue(label), `${label} date was not set`).not.toHaveText(/DD\/MM\/YYYY/i, {
          timeout: 10_000,
        });
      }
    } catch (error) {
      const values = await this.page.locator('p.selected-date').allInnerTexts().catch(() => []);
      const onScreen = (await this.onScreenDayCells().catch(() => [])).length;
      throw new Error(
        `${(error as Error).message}\nselected-date texts: ${JSON.stringify(values)}\n` +
          `on-screen day cells still open: ${onScreen}`
      );
    }
  }

  /**
   * Opens Check-In, picks the start day, then the end day (opening Check-Out if
   * the calendar closed). The panel only shows the dates once the range is
   * complete, so both are verified at the end.
   */
  async selectStayDates(startIndex = 2, nights = 3) {
    await this.openCheckInPicker();
    const startLabel = await this.pickStartDay(startIndex);
    await this.page.waitForTimeout(500);
    if ((await this.onScreenDayCells()).length === 0) {
      await this.openCheckOutPicker();
    }
    await this.pickEndDay(startLabel, nights);
    await this.expectDatesApplied();
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

  /** After changing dates/guests the panel may need a Search/Update click before the price refreshes. */
  async clickSearchIfPresent() {
    const search = this.bookingPanel()
      .getByRole('button', { name: /search|update|check availability|get price|get quote/i })
      .filter({ visible: true });
    if ((await search.count()) > 0) {
      await this.safeClick(search.first());
      await this.page.waitForTimeout(1000);
    }
  }

  async enterPromoCode(code: string) {
    await this.dismissCookieBanner();
    await this.page.getByPlaceholder(/enter your code here/i).fill(code);
  }

  async getTotalPrice(): Promise<string> {
    const total = this.page.getByText(/total for \d+ nights?/i).filter({ visible: true }).first();
    try {
      await total.waitFor({ state: 'visible', timeout: 15_000 });
    } catch {
      throw new Error(`"Total for N nights" price not shown.\n${await this.describeState()}`);
    }
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