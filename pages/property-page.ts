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
   * The real control is a SINGLE button whose accessible name is literally
   * "Check-In DD/MM/YYYY Check-Out" before any date is picked, and shows the
   * applied range afterward. There are separate <p> labels nearby that are
   * purely decorative and do not reliably reflect this button's state -
   * verify against this button (or page-wide placeholder text), never a <p>.
   */
  private datesTrigger(): Locator {
    return this.page
      .getByRole('button', { name: /check-in/i })
      .filter({ visible: true })
      .first();
  }

  async openDatesPicker() {
    await this.dismissCookieBanner();
    await this.safeClick(this.datesTrigger());
  }

  /**
   * Day cells render as real <button> elements when interactive.
   * This is the deliberately dynamic replacement for hardcoding a day-of-month
   * number: clicking a fixed day like "24" eventually fails once that date is
   * in the past for the current month (it becomes disabled/unclickable), so
   * this always picks whichever days are enabled right now, whatever month
   * the calendar happens to show.
   */
  private enabledDayButtons(): Locator {
    return this.page
      .getByRole('button', { name: /^\d{1,2}$/, disabled: false })
      .filter({ visible: true });
  }

  private async clickApply() {
    await this.dismissCookieBanner();
    const apply = this.page.getByRole('button', { name: 'Apply' }).filter({ visible: true }).first();
    // A disabled Apply button means the date range was never actually
    // completed - clicking it anyway (even with force) hides the real
    // problem behind a confusing "outside of viewport" error. Fail clearly
    // here instead, so the real cause (incomplete range) is obvious.
    try {
      await expect(apply, 'Apply stayed disabled - the date range was not completed').toBeEnabled({
        timeout: 8_000,
      });
    } catch (error) {
      const enabledCount = await this.enabledDayButtons().count();
      throw new Error(
        `${(error as Error).message}\nEnabled day cells still on the page after both clicks: ${enabledCount}`
      );
    }
    await this.safeClick(apply);
  }

  /**
   * Opens the dates control and picks a check-in, verifying the click
   * actually registered (the enabled-day set changes) before trusting it -
   * the very first click after opening can be silently swallowed (the
   * calendar cells appear to still be settling right after opening), and a
   * swallowed click looks identical to a successful one unless checked.
   * Retries a few times if nothing changed. Returns the enabled-day list as
   * it stood right after check-in was accepted (the valid checkout window).
   */
  /** Polls the enabled-day count until it stops changing (the calendar can still be rendering more days in). */
  private async waitForStableEnabledCount(maxWait = 3_000): Promise<number> {
    const started = Date.now();
    let last = -1;
    while (Date.now() - started < maxWait) {
      const current = await this.enabledDayButtons().count();
      if (current === last) return current;
      last = current;
      await this.page.waitForTimeout(250);
    }
    return last;
  }

  /**
   * If too few enabled days are showing for a real stay (this property's
   * near-term availability can be genuinely thin), try advancing the
   * calendar to the next month a few times to reach a fuller window.
   */
  private async tryAdvanceToMoreAvailability(minNeeded: number, attempts = 3) {
    const next = this.page
      .getByRole('button', { name: /next month|next/i })
      .filter({ visible: true })
      .first();
    for (let i = 0; i < attempts; i++) {
      const count = await this.waitForStableEnabledCount();
      if (count >= minNeeded) return count;
      if ((await next.count()) === 0) return count;
      await this.safeClick(next);
      await this.page.waitForTimeout(400);
    }
    return this.waitForStableEnabledCount();
  }

  /**
   * Opens the dates control and picks a check-in, verifying the click
   * actually registered (the enabled-day set changes) before trusting it -
   * the very first click after opening can be silently swallowed (the
   * calendar cells appear to still be settling right after opening), and a
   * swallowed click looks identical to a successful one unless checked.
   * Retries a few times if nothing changed. Returns the enabled-day list as
   * it stood right after check-in was accepted (the valid checkout window).
   */
  private async pickCheckInAndGetCheckoutWindow(startOffset: number): Promise<string[]> {
    await this.openDatesPicker();
    await this.enabledDayButtons().first().waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});

    let stableCount = await this.waitForStableEnabledCount();
    if (stableCount < 2) {
      stableCount = await this.tryAdvanceToMoreAvailability(2);
    }
    if (stableCount < 2) {
      throw new Error(
        `Only ${stableCount} enabled day(s) available - not enough for a check-in and check-out. ` +
          'This property may genuinely have very limited near-term availability right now.'
      );
    }

    const baseline = await this.enabledDayButtons().allInnerTexts();

    for (let attempt = 0; attempt < 4; attempt++) {
      const cells = this.enabledDayButtons();
      const count = await cells.count();
      if (count === 0) {
        await this.page.waitForTimeout(300);
        continue;
      }
      const index = Math.min(startOffset, count - 1);
      try {
        await this.safeClick(cells.nth(index));
      } catch {
        // The target cell may have vanished between counting and clicking
        // (this calendar re-renders reactively) - just retry the loop.
        continue;
      }
      await this.page.waitForTimeout(500);

      const after = await this.enabledDayButtons().allInnerTexts();
      if (after.join(',') !== baseline.join(',')) {
        return after; // the click changed something - check-in was accepted
      }
      // No change at all: that click had no effect. Try again.
    }

    throw new Error(
      `Check-In click never changed the calendar after 4 attempts (still showing ${baseline.length} enabled days). ` +
        'The calendar may not have opened, or check-in requires a different interaction.'
    );
  }

  /**
   * Opens the dates control, picks a check-in (verified, see above), then
   * picks a check-out from the resulting valid window, then Apply.
   * Verifies success by checking the "DD/MM/YYYY" placeholder text is gone.
   */
  async selectStayDates(startOffset: number = 2, nights: number = 3) {
    const checkoutWindow = await this.pickCheckInAndGetCheckoutWindow(startOffset);

    const checkoutCells = this.enabledDayButtons();
    const checkoutCount = await checkoutCells.count();
    if (checkoutCount === 0) {
      throw new Error(
        `No enabled day cells remained after Check-In was accepted (window was: ${JSON.stringify(checkoutWindow)}).`
      );
    }
    const endIndex = Math.min(nights, checkoutCount - 1);
    await this.safeClick(checkoutCells.nth(endIndex));

    await this.clickApply();
    await expect(this.page.getByText('DD/MM/YYYY'), 'Dates were not applied (placeholder still shown)').toHaveCount(
      0,
      { timeout: 10_000 }
    );
  }

  async openGuestsSelector() {
    await this.dismissCookieBanner();
    await this.safeClick(this.page.getByText(/adults?/i).filter({ visible: true }).last());
  }

  async incrementAdults(times: number = 1) {
    const button = this.page.getByRole('button', { name: 'Increase value' }).filter({ visible: true }).first();
    await button.waitFor({ state: 'visible', timeout: 10_000 });
    for (let i = 0; i < times; i++) {
      await this.dismissCookieBanner();
      await this.safeClick(button);
    }
  }

  async confirmGuests() {
    await this.clickApply();
  }

  /** After dates/guests change, Search recalculates the price shown in Payment Summary. */
  async clickSearch() {
    await this.dismissCookieBanner();
    await this.safeClick(this.page.getByRole('button', { name: 'Search' }).filter({ visible: true }).first());
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

  /** Clicking Book Now navigates to /reserve/property/<slug>?adult=N&from=M/D/YYYY&to=M/D/YYYY. */
  async clickBookNow() {
    await this.dismissCookieBanner();
    await this.safeClick(this.page.getByRole('button', { name: 'Book Now', exact: true }).filter({ visible: true }).first());
  }

  async expectNavigatedToReserve() {
    await expect(this.page).toHaveURL(/\/reserve\/property\//, { timeout: 15_000 });
  }

  /**
   * Heart icon button sits next to "Share" and has no visible label.
   * Try an accessible name first, then fall back to the sibling of Share.
   */
  private wishlistToggle(): Locator {
    const byName = this.page.getByRole('button', { name: /wishlist|favou?rite/i }).filter({ visible: true }).first();
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
    await this.page.waitForTimeout(1000);
  }
}
