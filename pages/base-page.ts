import { Page, Locator } from '@playwright/test';

export class BasePage {
  constructor(protected page: Page) {}

  async goto(path: string = '/') {
    await this.page.goto(path);
    // Cookie banner can render a moment after load, so give it a short window once here.
    await this.page.waitForTimeout(1000);
    await this.dismissCookieBanner();
  }

  /**
   * The cookie banner is fixed to the bottom of the viewport and can
   * intercept clicks. It may also render late, so this is called before
   * every interaction. It returns immediately if no banner is visible.
   */
  async dismissCookieBanner() {
    const acceptButton = this.page
      .getByRole('button', { name: /accept/i })
      .filter({ visible: true })
      .first();
    if (await acceptButton.isVisible().catch(() => false)) {
      await acceptButton.click().catch(() => {});
    }
  }

  /**
   * Normal click first. If the element is "outside of the viewport"
   * (calendar popovers, sticky panels), fall back to a DOM click event.
   */
  async safeClick(locator: Locator, timeout = 5000) {
    try {
      await locator.click({ timeout });
    } catch {
      await locator.dispatchEvent('click', {}, { timeout });
    }
  }

  /** Enabled, visible day cells (plain-digit buttons) of whichever calendar is open. */
  protected dayCells(): Locator {
    return this.page
      .getByRole('button', { name: /^\d{1,2}$/, disabled: false })
      .filter({ visible: true });
  }

  /** Clicks the Nth enabled day cell and returns its day number as text. */
  protected async pickStartDay(startIndex: number): Promise<string> {
    const cells = this.dayCells();
    await cells.first().waitFor({ state: 'visible', timeout: 10_000 });
    const index = Math.min(startIndex, (await cells.count()) - 1);
    const label = (await cells.nth(index).innerText()).trim();
    await this.safeClick(cells.nth(index));
    return label;
  }

  /**
   * Clicks the day `nights` cells after the chosen start day. Works whether
   * the calendar keeps earlier days enabled or disables them after check-in.
   */
  protected async pickEndDay(startLabel: string, nights: number) {
    const cells = this.dayCells();
    await cells.first().waitFor({ state: 'visible', timeout: 10_000 });
    const labels = (await cells.allInnerTexts()).map((t) => t.trim());
    const startPos = Math.max(labels.indexOf(startLabel), 0);
    const target = Math.min(startPos + nights, labels.length - 1);
    await this.safeClick(cells.nth(target));
  }

  /** Picks a check-in then check-out from the open calendar (start = Nth enabled day). */
  async selectDateRange(startIndex = 2, nights = 3) {
    await this.dismissCookieBanner();
    const startLabel = await this.pickStartDay(startIndex);
    await this.pickEndDay(startLabel, nights);
  }
}