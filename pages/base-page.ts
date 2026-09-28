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
   * Normal click first. If Playwright refuses ("outside of the viewport" in
   * calendar popovers / sticky panels), scroll the element to the centre and
   * do a real mouse click there. Only as a last resort dispatch a DOM click
   * event (some widgets ignore synthetic events, so callers should verify).
   */
  async safeClick(locator: Locator, timeout = 5000) {
    try {
      await locator.click({ timeout });
      return;
    } catch {
      /* fall through */
    }
    try {
      await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }), undefined, {
        timeout,
      });
      const box = await locator.boundingBox();
      const viewport = this.page.viewportSize();
      if (
        box &&
        viewport &&
        box.x >= 0 &&
        box.y >= 0 &&
        box.x + box.width <= viewport.width &&
        box.y + box.height <= viewport.height
      ) {
        await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        return;
      }
    } catch {
      /* fall through */
    }
    await locator.dispatchEvent('click', {}, { timeout });
  }

  /** Enabled, rendered day cells (plain-digit buttons) anywhere on the page. */
  protected dayCells(): Locator {
    return this.page
      .getByRole('button', { name: /^\d{1,2}$/, disabled: false })
      .filter({ visible: true });
  }

  /**
   * Only the day cells whose centre is inside the viewport. The page can hold
   * other pre-rendered calendars (header search, mobile drawer) that are
   * "visible" to Playwright but sit off-screen; clicking those does nothing.
   * The calendar the user just opened is always on screen.
   */
  protected async onScreenDayCells(): Promise<{ cell: Locator; label: string }[]> {
    const cells = this.dayCells();
    const info = await cells.evaluateAll((els) =>
      els.map((el, index) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        return {
          index,
          label: (el.textContent || '').trim(),
          onScreen: cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight,
        };
      })
    );
    return info.filter((i) => i.onScreen).map((i) => ({ cell: cells.nth(i.index), label: i.label }));
  }

  protected async waitForOnScreenDayCells(timeout = 10_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = await this.onScreenDayCells();
      if (found.length > 0) return found;
      await this.page.waitForTimeout(250);
    }
    const total = await this.dayCells().count();
    throw new Error(
      `No enabled day cells are on screen (${total} found on the page in total). The calendar did not open.`
    );
  }

  /** Clicks the Nth on-screen enabled day cell and returns its day number as text. */
  protected async pickStartDay(startIndex: number): Promise<string> {
    const found = await this.waitForOnScreenDayCells();
    const target = found[Math.min(startIndex, found.length - 1)];
    await this.safeClick(target.cell);
    return target.label;
  }

  /**
   * Clicks the day `nights` cells after the chosen start day. Works whether
   * the calendar keeps earlier days enabled or disables them after check-in.
   */
  protected async pickEndDay(startLabel: string, nights: number) {
    const found = await this.waitForOnScreenDayCells();
    const startPos = Math.max(found.findIndex((f) => f.label === startLabel), 0);
    const target = found[Math.min(startPos + nights, found.length - 1)];
    await this.safeClick(target.cell);
  }

  /** Picks a check-in then check-out from the open calendar (start = Nth enabled day). */
  async selectDateRange(startIndex = 2, nights = 3) {
    await this.dismissCookieBanner();
    const startLabel = await this.pickStartDay(startIndex);
    await this.pickEndDay(startLabel, nights);
  }
}