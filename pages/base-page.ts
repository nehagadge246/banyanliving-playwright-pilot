import { Page, Locator } from '@playwright/test';

/** One enabled calendar day cell. `clickable` = centre is inside the viewport AND nothing covers it. */
export type DayCell = {
  cell: Locator;
  label: string;
  onScreen: boolean;
  clickable: boolean;
};

/**
 * Runs INSIDE the page (passed to locator.evaluate, so it must not use anything
 * from this file). Performs the same event sequence a real mouse click produces -
 * pointer/mouse over, down, up, then click - directly on the element. Needs no
 * visibility, stability or hit-target checks, so it still works on controls that
 * Playwright refuses to click because they never "settle" (animated sheets, calendars
 * that re-render continuously, as on the tablet layout).
 */
function domClickEvents(el: Element) {
  const target = el as HTMLElement;
  target.scrollIntoView({ block: 'center', inline: 'center' });
  const r = target.getBoundingClientRect();
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
    button: 0,
    view: window,
  };
  for (const type of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
    const event = type.startsWith('pointer')
      ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true })
      : new MouseEvent(type, init);
    target.dispatchEvent(event);
  }
  target.click();
}

export class BasePage {
  constructor(protected page: Page) {}

  async goto(path: string = '/') {
    await this.page.goto(path);
    // The cookie banner can render late. Wait for it here (up to 3s, or less if it
    // shows up sooner) so it cannot first appear in the middle of a test and get
    // dismissed while a date/guests popover is open - that click lands outside the
    // popover and closes it, which made "Apply" vanish mid-click in the booking widget.
    await this.page
      .getByRole('button', { name: /accept/i })
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: 3000 })
      .catch(() => {});
    await this.dismissCookieBanner();
  }

  /**
   * The cookie banner is fixed to the bottom of the viewport and can
   * intercept clicks. It may also render late, so this is called before
   * every interaction. It returns immediately if no banner is visible.
   *
   * It does nothing while a date/guests popover is open (recognised by its Apply
   * button): clicking the banner is an "outside click" that closes the popover and
   * throws away the selection. The banner is handled on page load and before each
   * popover is opened, so skipping it here is safe.
   */
  async dismissCookieBanner() {
    const popoverOpen = await this.page
      .getByRole('button', { name: /^apply$/i })
      .filter({ visible: true })
      .count()
      .catch(() => 0);
    if (popoverOpen > 0) return;

    const acceptButton = this.page
      .getByRole('button', { name: /accept/i })
      .filter({ visible: true })
      .first();
    if (await acceptButton.isVisible().catch(() => false)) {
      await acceptButton.click().catch(() => {});
    }
  }

  /**
   * Scrolls an element into the UPPER part of the viewport (not just "barely
   * visible"). Playwright's own scroll leaves a trigger at the very bottom edge of
   * the screen; a popover that opens below it (date picker, guests) then sits
   * outside the viewport and cannot be scrolled into view, because the popover is
   * fixed/absolute. Putting the trigger near the top leaves room below it.
   */
  protected async scrollToUpperViewport(locator: Locator) {
    await locator
      .evaluate(
        (el) => {
          el.scrollIntoView({ block: 'start', inline: 'nearest' });
          window.scrollBy(0, -160); // keep clear of a sticky header
        },
        undefined,
        { timeout: 3000 }
      )
      .catch(() => {});
    await this.page.waitForTimeout(150);
  }

  /**
   * Click strategy, from safest to most forceful:
   *  1. normal click (full actionability checks);
   *  2. centre the element in its scroll container ourselves, then a normal click
   *     (clears sticky headers / cookie bars that cover it after Playwright's own scroll);
   *  3. force click;
   *  4. keyboard activation: focus() scrolls the element into view natively and works
   *     whatever its on-screen geometry, then Enter fires the button's click;
   *  5. DOM click() as the very last resort.
   * Steps 4-5 do not need the element to be inside the viewport, which is exactly
   * what fails with "Element is outside of the viewport". They cannot confirm the
   * app reacted, so callers that need proof verify the resulting state.
   * `mode: 'dom'` jumps straight to step 5 (used when Enter had no visible effect).
   * If everything throws, the error carries every message.
   */
  protected async clickWithFallbacks(
    locator: Locator,
    timeouts: { first: number; rest: number },
    mode: 'auto' | 'dom' = 'auto'
  ) {
    const errors: string[] = [];
    const note = (label: string, error: unknown) =>
      errors.push(`--- ${label} ---\n${(error as Error).message}`);

    if (mode === 'auto') {
      try {
        await locator.click({ timeout: timeouts.first });
        return;
      } catch (error) {
        note('normal click', error);
      }

      // If the target vanished while we were trying to click it (a popover closed or
      // re-rendered), the remaining strategies can only time out one by one. Say so.
      if ((await locator.count().catch(() => 0)) === 0) {
        throw new Error(
          'The click target disappeared while clicking it - a popover/panel most likely closed ' +
            `(for example from an outside click or a re-render).\n${errors.join('\n')}`
        );
      }

      try {
        await locator.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center' }), undefined, {
          timeout: 2000,
        });
        await locator.click({ timeout: timeouts.rest });
        return;
      } catch (error) {
        note('recentred click', error);
      }

      try {
        await locator.click({ timeout: timeouts.rest, force: true });
        return;
      } catch (error) {
        note('forced click', error);
      }

      try {
        await locator.focus({ timeout: 2000 });
        await this.page.keyboard.press('Enter');
        return;
      } catch (error) {
        note('keyboard Enter', error);
      }
    }

    try {
      await locator.evaluate(domClickEvents, undefined, { timeout: 2000 });
    } catch (error) {
      note('DOM click', error);
      throw new Error(`Click failed with every strategy.\n${errors.join('\n')}`);
    }
  }

  async safeClick(locator: Locator, timeout = 5000) {
    await this.clickWithFallbacks(locator, { first: timeout, rest: 2000 });
  }

  /**
   * Names of the buttons, links and inputs that are actually visible right now.
   * Appended to errors when a control cannot be found, so a failure at a new
   * screen size (tablet) shows what that layout really offers instead of just
   * "not found".
   */
  protected async describeVisibleControls(): Promise<string> {
    return this.page
      .evaluate(() => {
        const visible = (el: Element) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
        };
        const label = (el: Element) =>
          (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 40);
        const pick = (selector: string) =>
          Array.from(document.querySelectorAll(selector)).filter(visible).map(label).filter(Boolean).slice(0, 30);
        return (
          `viewport ${window.innerWidth}x${window.innerHeight}; ` +
          `buttons: ${JSON.stringify(pick('button, [role="button"]'))}; ` +
          `links: ${JSON.stringify(pick('a'))}; ` +
          `inputs: ${JSON.stringify(pick('input, textarea, select'))}`
        );
      })
      .catch(() => 'visible controls unavailable');
  }

  /**
   * Fast click for calendar cells / arrows, bounded to a couple of seconds.
   *  'auto' (default): a normal click for 0.8s; if Playwright cannot complete it
   *          (e.g. the element never becomes "stable"), the in-page click events;
   *  'force': scroll into view, then a forced real mouse click;
   *  'key'  : focus the element and press Enter;
   *  'dom'  : the in-page click events only.
   * The older version walked through five strategies with 1-2s timeouts each, so
   * one stubborn cell cost 6-8s and a whole date selection could eat the test's
   * entire time budget.
   */
  protected async activate(locator: Locator, mode: 'auto' | 'force' | 'key' | 'dom' = 'auto') {
    if (mode === 'auto') {
      try {
        await locator.click({ timeout: 800 });
        return;
      } catch {
        /* fall through to the in-page events */
      }
    }
    if (mode === 'force') {
      await locator.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      await locator.click({ timeout: 1500, force: true });
      return;
    }
    if (mode === 'key') {
      await locator.focus({ timeout: 1500 });
      await this.page.keyboard.press('Enter');
      return;
    }
    await locator.evaluate(domClickEvents, undefined, { timeout: 2000 });
  }

  /**
   * From a list of matching elements, returns the first one that is really on
   * screen and not covered by anything. A page can hold hidden duplicates (mobile
   * drawer, sticky bar, off-canvas panel) that Playwright still calls "visible";
   * clicking one of those is what produces "Element is outside of the viewport".
   * Falls back to the first match so below-the-fold elements still get scrolled to.
   */
  protected async firstReachable(candidates: Locator): Promise<Locator> {
    const count = await candidates.count();
    for (let i = 0; i < count; i++) {
      const candidate = candidates.nth(i);
      const reachable = await candidate
        .evaluate(
          (el) => {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false;
            const top = document.elementFromPoint(cx, cy);
            return !!top && (top === el || el.contains(top));
          },
          undefined,
          { timeout: 2000 }
        )
        .catch(() => false);
      if (reachable) return candidate;
    }
    return candidates.first();
  }

  /** Enabled, rendered day cells (plain-digit buttons) anywhere on the page. */
  protected dayCells(): Locator {
    return this.page
      .getByRole('button', { name: /^\d{1,2}$/, disabled: false })
      .filter({ visible: true });
  }

  /**
   * Enabled day cells with their on-screen / clickable flags. A page can hold
   * several calendars (header search, drawers), so cells currently inside the
   * viewport are preferred; Playwright scrolls to the others when it clicks them.
   * `clickable` additionally requires that the cell is the topmost element at
   * its centre, which filters out cells of hidden or off-canvas calendars.
   */
  protected async dayCellInfo(): Promise<DayCell[]> {
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
        const onScreen = cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight;
        let clickable = false;
        if (onScreen) {
          const top = document.elementFromPoint(cx, cy);
          clickable = !!top && (top === el || el.contains(top));
        }
        return { index, label: (el.textContent || '').trim(), onScreen, clickable };
      })
    );
    return info.map((i) => ({
      cell: cells.nth(i.index),
      label: i.label,
      onScreen: i.onScreen,
      clickable: i.clickable,
    }));
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

  /**
   * Like waitForOnScreenDayCells, but only returns cells that are truly clickable
   * (inside the viewport and not covered). If no cell is clickable after a couple
   * of seconds it returns every enabled cell, so the caller can still try
   * (Playwright will scroll) and report a meaningful error.
   */
  protected async waitForClickableDayCells(timeout = 10_000): Promise<DayCell[]> {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const info = await this.dayCellInfo();
      const clickable = info.filter((i) => i.clickable);
      if (clickable.length > 0) return clickable;
      if (info.length > 0 && Date.now() - started > 2_000) return info;
      await this.page.waitForTimeout(250);
    }
    throw new Error('No enabled day cells found. The calendar did not open.');
  }

  /**
   * Finds the index of a check-in cell such that the next `nights` cells are
   * consecutive days (n, n+1, n+2 ...), i.e. a bookable run with no sold-out
   * gap inside it. Searches from `startIndex` first, then from the beginning.
   * Returns -1 if the visible months hold no such run.
   */
  protected findStayWindow(cells: { label: string }[], startIndex: number, nights: number): number {
    const isRun = (s: number) => {
      for (let k = 0; k < nights; k++) {
        const a = Number(cells[s + k]?.label);
        const b = Number(cells[s + k + 1]?.label);
        if (!(b === a + 1)) return false;
      }
      return true;
    };
    for (let s = startIndex; s + nights < cells.length; s++) if (isRun(s)) return s;
    for (let s = 0; s < Math.min(startIndex, cells.length - nights); s++) if (isRun(s)) return s;
    return -1;
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