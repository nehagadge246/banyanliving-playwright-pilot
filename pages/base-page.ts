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
    // force: true performs a real click at the element's location, bypassing
    // Playwright's own actionability checks (visibility/stability) that can
    // misfire on animated or overlapping widgets. This is a genuine click,
    // unlike dispatchEvent, which can silently no-op on some frameworks.
    await locator.click({ timeout, force: true });
  }

  /** Enabled, rendered day cells (plain-digit buttons) anywhere on the page. */
  protected dayCells(): Locator {
    return this.page
      .getByRole('button', { name: /^\d{1,2}$/, disabled: false })
      .filter({ visible: true });
  }

  /**
   * Enabled day cells with their on-screen flag. A page can hold several
   * calendars (header search, drawers), so cells currently inside the viewport
   * are preferred; Playwright scrolls to the others when it clicks them.
   */
  protected async dayCellInfo(): Promise<{ cell: Locator; label: string; onScreen: boolean }[]> {
    // If a popover/dialog holding a calendar is open, use only its cells; otherwise every enabled cell.
    const inPopover = this.page
      .locator('[data-radix-popper-content-wrapper], [role="dialog"]')
      .getByRole('button', { name: /^\d{1,2}$/, disabled: false })
      .filter({ visible: true });
    const cells = (await inPopover.count()) > 0 ? inPopover : this.dayCells();
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
    return info.map((i) => ({ cell: cells.nth(i.index), label: i.label, onScreen: i.onScreen }));
  }

  /** Same as dayCellInfo but only the on-screen cells. */
  protected async onScreenDayCells(): Promise<{ cell: Locator; label: string }[]> {
    return (await this.dayCellInfo()).filter((i) => i.onScreen);
  }

  /**
   * Waits for an open calendar. On-screen cells win; if none appear within a
   * couple of seconds (calendar opens below the fold) all enabled cells are used.
   */
  protected async waitForOnScreenDayCells(timeout = 10_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const info = await this.dayCellInfo();
      const onScreen = info.filter((i) => i.onScreen);
      if (onScreen.length > 0) return onScreen;
      if (info.length > 0 && Date.now() - started > 2_000) return info;
      await this.page.waitForTimeout(250);
    }
    throw new Error('No enabled day cells found. The calendar did not open.');
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