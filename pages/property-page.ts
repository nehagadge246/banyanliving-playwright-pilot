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

  /** Every Check-In (or Check-Out) label on the page, duplicates included, in DOM order. */
  private allPanelLabels(text: 'Check-In' | 'Check-Out'): Locator {
    return this.page.locator('p').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`, 'i') });
  }

  /** The <p class="selected-date"> value that follows a given Check-In/Check-Out label. */
  private dateValueAt(text: 'Check-In' | 'Check-Out', index: number): Locator {
    return this.allPanelLabels(text).nth(index).locator('xpath=following-sibling::p[1]');
  }

  /**
   * The page has more than one Check-In control (a known duplicate-widget
   * pattern on this site). Rather than guess which is "the real one", try
   * each in turn and keep the first that actually opens a calendar. Reading
   * the date back from that exact same element afterwards is then guaranteed
   * to match what was clicked, regardless of DOM order.
   */
  private async findWorkingCheckInIndex(): Promise<number> {
    const labels = this.allPanelLabels('Check-In');
    const count = await labels.count();
    if (count === 0) {
      throw new Error('No "Check-In" label found on the page at all.');
    }
    for (let i = 0; i < count; i++) {
      await this.dismissCookieBanner();
      await this.safeClick(labels.nth(i));
      await this.page.waitForTimeout(400);
      if ((await this.dayCellInfo()).length > 0) return i;
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(200);
    }
    throw new Error(`None of the ${count} "Check-In" control(s) on the page opened a calendar.`);
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

  /** Text shown under a panel label; a <p class="selected-date"> that reads DD/MM/YYYY until set. */
  private async expectDateValueSet(text: 'Check-In' | 'Check-Out', index: number) {
    await expect(this.dateValueAt(text, index), `${text} date was not set`).not.toHaveText(
      /DD\/MM\/YYYY/i,
      { timeout: 10_000 }
    );
  }

  /**
   * Finds a working Check-In control, picks a start day, opens the matching
   * Check-Out control (same index) if the calendar closed after check-in,
   * picks the end day, then verifies both dates changed at that same index.
   */
  async selectStayDates(startIndex = 2, nights = 3) {
    const index = await this.findWorkingCheckInIndex();
    const startLabel = await this.pickStartDay(startIndex);
    await this.page.waitForTimeout(500);

    if ((await this.onScreenDayCells()).length === 0) {
      await this.dismissCookieBanner();
      await this.safeClick(this.allPanelLabels('Check-Out').nth(index));
      await this.page.waitForTimeout(400);
    }
    await this.pickEndDay(startLabel, nights);

    await this.expectDateValueSet('Check-In', index);
    await this.expectDateValueSet('Check-Out', index);
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