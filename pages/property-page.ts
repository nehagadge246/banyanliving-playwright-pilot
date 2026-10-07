import { Page, Locator, expect } from '@playwright/test';
import { BasePage, DayCell } from './base-page';

export class PropertyPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoProperty(slug: string) {
    await this.goto(`/property/${slug}`);
  }

  /**
   * The control that opens the calendar. Desktop: a single button named
   * "Check-In DD/MM/YYYY Check-Out". Tablet: a button named
   * "Dates DD/MM/YYYY - DD/MM/YYYY Edit" (same control, different wording; the
   * words may or may not be separated by spaces in the accessible name, so no
   * word boundary is required after "Dates").
   */
  private datesTrigger(): Locator {
    const checkIn = this.page.getByRole('button', { name: /check-in/i }).filter({ visible: true });
    const dates = this.page
      .getByRole('button', { name: /^dates[\s\S]*(dd\/mm\/yyyy|\d{1,2}\/\d{1,2}\/\d{2,4})/i })
      .filter({ visible: true });
    return checkIn.or(dates);
  }

  /**
   * On narrower screens (tablet) the booking panel is not on the page itself: a
   * button opens it as a drawer/sheet, so the Check-In control does not exist
   * until that button is pressed. On desktop the control is already there and this
   * returns immediately. Otherwise it presses availability/booking openers one by
   * one until the Check-In control appears (undoing any that navigate away), and
   * fails with the list of visible controls if none of them does.
   */
  private async revealBookingPanel() {
    await this.datesTrigger().first().waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
    if ((await this.datesTrigger().count()) > 0) return;

    const openerPatterns = [
      /check availability|select dates|choose dates|add dates|availability|dates/i,
      /reserve|book|rates|price/i,
    ];
    const startUrl = this.page.url();
    for (const pattern of openerPatterns) {
      const openers = this.page.getByRole('button', { name: pattern }).filter({ visible: true });
      const count = Math.min(await openers.count(), 4);
      for (let i = 0; i < count; i++) {
        await this.dismissCookieBanner();
        await this.safeClick(openers.nth(i)).catch(() => {});
        await this.page.waitForTimeout(700);
        if (this.page.url() !== startUrl) {
          await this.page.goBack().catch(() => {});
          await this.page.waitForTimeout(500);
          continue;
        }
        if ((await this.datesTrigger().count()) > 0) return;
      }
    }
    throw new Error(
      'The Check-In control is not on the page and no button opened the booking panel at this screen size.\n' +
        `Visible controls -> ${await this.describeVisibleControls()}`
    );
  }

  async openDatesPicker() {
    await this.dismissCookieBanner();
    await this.revealBookingPanel();
    const trigger = await this.firstReachable(this.datesTrigger());
    await this.scrollToUpperViewport(trigger);
    await this.safeClick(trigger);
  }

  // ---------------------------------------------------------------------------
  // Calendar helpers
  // ---------------------------------------------------------------------------

  private async ensureTallViewport(minHeight: number = 2000) {
    const size = this.page.viewportSize();
    if (size && size.height < minHeight) {
      await this.page.setViewportSize({ width: size.width, height: minHeight });
      await this.page.waitForTimeout(300);
    }
  }

  private async cells(): Promise<DayCell[]> {
    return this.dayCellInfo();
  }

  /** Polls until the list of enabled days stops changing (the calendar re-renders after open / month change / click). */
  private async stableCells(maxWait = 3_000): Promise<DayCell[]> {
    const started = Date.now();
    let lastKey = '';
    let cells: DayCell[] = [];
    while (Date.now() - started < maxWait) {
      cells = await this.cells();
      const key = cells.map((c) => c.label).join(',');
      if (cells.length > 0 && key === lastKey) return cells;
      lastKey = key;
      await this.page.waitForTimeout(250);
    }
    return cells;
  }

  private nextMonthButton(): Locator {
    const byName = this.page.getByRole('button', { name: /next month|go to next/i }).filter({ visible: true });
    const byClass = this.page
      .locator('button[name="next-month"], button.rdp-nav_button_next, button[class*="button_next"]')
      .filter({ visible: true });
    const inPopover = this.page
      .locator('[data-radix-popper-content-wrapper], [role="dialog"]')
      .getByRole('button', { name: /next/i })
      .filter({ visible: true });
    return byName.or(byClass).or(inPopover).first();
  }

  private async describeGeometry(): Promise<string> {
    return this.page
      .evaluate(() => {
        const vp = `viewport ${window.innerWidth}x${window.innerHeight}, scrollY ${Math.round(window.scrollY)}`;
        const isBad = (b: Element) => {
          const r = b.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return true;
          const top = document.elementFromPoint(cx, cy);
          return !(top && (top === b || b.contains(top)));
        };
        const cellsNow = Array.from(document.querySelectorAll('button')).filter(
          (b) => /^\d{1,2}$/.test((b.textContent || '').trim()) && !(b as HTMLButtonElement).disabled
        );
        const bad = cellsNow.find(isBad);
        if (!bad) return `${vp}; every enabled day cell is reachable`;

        const rect = (el: Element) => {
          const r = el.getBoundingClientRect();
          return `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`;
        };
        const chain: string[] = [];
        let el: Element | null = bad;
        for (let i = 0; el && i < 7; i++, el = el.parentElement) {
          const cs = getComputedStyle(el);
          chain.push(
            `${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).slice(0, 25)} ` +
              `pos=${cs.position} ovf=${cs.overflowX}/${cs.overflowY} rect=${rect(el)}`
          );
        }
        const r = bad.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return (
          `${vp}; first unreachable cell "${(bad.textContent || '').trim()}" rect=${rect(bad)}; ` +
          `topmost there: ${top ? top.tagName.toLowerCase() + '.' + String((top as HTMLElement).className).slice(0, 40) : 'none'}; ` +
          `ancestors: ${chain.join(' < ')}`
        );
      })
      .catch((e) => `geometry unavailable (${(e as Error).message})`);
  }

  private async describeCalendar(): Promise<string> {
    const all = await this.dayCellInfo().catch(() => [] as DayCell[]);
    const apply = this.page.getByRole('button', { name: 'Apply' }).filter({ visible: true }).first();
    const applyState =
      (await apply.count().catch(() => 0)) === 0
        ? 'not found'
        : (await apply.isEnabled().catch(() => false))
          ? 'enabled'
          : 'disabled';
    const sample = all
      .slice(0, 45)
      .map((c) => `${c.label}${c.clickable ? '' : '(not reachable)'}`)
      .join(', ');
    return (
      `Calendar state -> enabled cells: ${all.length}, reachable: ${all.filter((c) => c.clickable).length}, ` +
      `Apply: ${applyState}. Cells: [${sample}]\nGeometry -> ${await this.describeGeometry()}`
    );
  }

  private async ensureStayWindow(startOffset: number, nights: number, maxMonths = 6) {
    await this.waitForClickableDayCells();
    for (let i = 0; i <= maxMonths; i++) {
      const cells = await this.stableCells();
      if (this.findStayWindow(cells, startOffset, nights) >= 0) return;

      const next = this.nextMonthButton();
      if ((await next.count()) === 0) break;
      await this.activate(next);
      await this.page.waitForTimeout(400);
    }
    throw new Error(
      `No run of ${nights + 1} consecutive available days found after advancing the calendar. ` +
        `This property may be sold out in the near term.\n${await this.describeCalendar()}`
    );
  }

  /**
   * Fingerprint of every day button on the page: label, class, aria state and
   * disabled flag. Clicking a day changes this (selected / range-highlight classes)
   * even when the SET of enabled days stays the same. The old check ("did the list
   * of enabled days change?") missed that, so it decided the check-in click had
   * been swallowed and clicked the SAME day again, up to 3 times - toggling the
   * selection on and off and leaving the range incomplete.
   */
  private async dayStateKey(): Promise<string> {
    return this.page
      .evaluate(() =>
        Array.from(document.querySelectorAll('button'))
          .filter((b) => /^\d{1,2}$/.test((b.textContent || '').trim()))
          .map((b) =>
            [
              (b.textContent || '').trim(),
              b.getAttribute('class') || '',
              b.getAttribute('aria-selected') || '',
              b.getAttribute('aria-pressed') || '',
              b.getAttribute('data-state') || '',
              (b as HTMLButtonElement).disabled ? 'd' : 'e',
            ].join('|')
          )
          .join('\n')
      )
      .catch(() => '');
  }

  /**
   * Clicks a check-in cell and checks that the click registered by comparing the
   * day-button fingerprint before/after. Only if NOTHING changed (the first click
   * after opening can be swallowed while the cells settle) is it clicked once more.
   */
  private async clickCheckIn(
    startOffset: number,
    nights: number
  ): Promise<{ label: string; index: number; registered: boolean }> {
    const before = await this.stableCells();
    const windowStart = this.findStayWindow(before, startOffset, nights);
    const index = windowStart >= 0 ? windowStart : Math.min(startOffset, before.length - 1);
    const target = before[index];
    const beforeKey = await this.dayStateKey();

    await this.activate(target.cell).catch(() => {});
    await this.page.waitForTimeout(500);
    let registered = (await this.dayStateKey()) !== beforeKey;
    if (!registered) {
      // Nothing changed: try ONE different kind of click (a real forced mouse click).
      await this.page.waitForTimeout(500);
      await this.activate(target.cell, 'force').catch(() => {});
      await this.page.waitForTimeout(500);
      registered = (await this.dayStateKey()) !== beforeKey;
    }
    return { label: target.label, index, registered };
  }

  /** Position of the check-in day in the live list (closest to where it was; the same number can appear in two months). */
  private anchorIndex(live: DayCell[], label: string, expectedIndex: number): number {
    let best = -1;
    live.forEach((c, i) => {
      if (c.label === label && (best < 0 || Math.abs(i - expectedIndex) < Math.abs(best - expectedIndex))) best = i;
    });
    return best;
  }

  /** How many days directly follow `from` as consecutive dates (n, n+1, n+2 ...) with no sold-out gap. */
  private consecutiveRunLength(live: DayCell[], from: number): number {
    let n = 0;
    while (from + n + 1 < live.length && Number(live[from + n + 1].label) === Number(live[from + n].label) + 1) n++;
    return n;
  }

  /**
   * The Apply button of the panel that is actually open. On the tablet layout an
   * Apply button exists on the page even while no panel is open (it sits in a
   * closed sheet), so "the first visible Apply" can be the wrong one. This picks
   * the first Apply that is really on screen and not covered, falling back to the
   * first match.
   */
  private async applyButton(scope: 'calendar' | 'any' = 'any'): Promise<Locator> {
    if (scope === 'calendar') {
      // The page can hold several Apply buttons (the tablet layout's sheet, the
      // guests panel). The one that matters for the dates is the one in the same
      // panel as the day cells: walk up from a visible day cell to the nearest
      // container that holds an Apply button and tag that button.
      const tagged = await this.page
        .evaluate(() => {
          document.querySelectorAll('[data-pw-apply]').forEach((e) => e.removeAttribute('data-pw-apply'));
          const day = Array.from(document.querySelectorAll('button')).find(
            (b) =>
              /^\d{1,2}$/.test((b.textContent || '').trim()) &&
              !(b as HTMLButtonElement).disabled &&
              b.getBoundingClientRect().width > 0
          );
          let node: Element | null = day || null;
          while (node) {
            const apply = Array.from(node.querySelectorAll('button')).find((b) =>
              /^\s*apply\s*$/i.test(b.textContent || '')
            );
            if (apply) {
              apply.setAttribute('data-pw-apply', '1');
              return true;
            }
            node = node.parentElement;
          }
          return false;
        })
        .catch(() => false);
      if (tagged) return this.page.locator('[data-pw-apply="1"]').first();
    }
    return this.firstReachable(this.page.getByRole('button', { name: 'Apply' }).filter({ visible: true }));
  }

  private async applyEnabled(timeout: number, scope: 'calendar' | 'any' = 'calendar'): Promise<boolean> {
    try {
      await expect
        .poll(async () => (await this.applyButton(scope)).isEnabled().catch(() => false), { timeout })
        .toBe(true);
      return true;
    } catch {
      return false;
    }
  }

  private async clickApply(what: string = 'date range') {
    await this.dismissCookieBanner();
    const scope = what === 'date range' ? 'calendar' : 'any';
    try {
      await expect
        .poll(async () => (await this.applyButton(scope)).isEnabled().catch(() => false), {
          timeout: 8_000,
          message: `Apply stayed disabled - the ${what} was not completed`,
        })
        .toBe(true);
    } catch (error) {
      throw new Error(`${(error as Error).message}\n${await this.describeCalendar()}`);
    }
    await this.safeClick(await this.applyButton(scope));
  }

  /** True once no visible "DD/MM/YYYY" placeholder is left (hidden duplicates of the control are ignored). */
  private async datesApplied(timeout: number): Promise<boolean> {
    try {
      await expect
        .poll(async () => this.page.getByText('DD/MM/YYYY').filter({ visible: true }).count(), { timeout })
        .toBe(0);
      return true;
    } catch {
      return false;
    }
  }

  /** Moment after which date selection gives up with a clear error instead of running into the test timeout. */
  private deadline = Number.POSITIVE_INFINITY;

  private async assertTimeLeft(log: string[], where: string) {
    if (Date.now() > this.deadline) {
      throw new Error(
        `Date selection ran out of its time budget (${where}).\n  ${log.join('\n  ')}\n${await this.describeCalendar()}`
      );
    }
  }

  /**
   * One pass: open the picker, pick a verified check-in, then try check-outs
   * `nights`, `nights + 1`, ... cells AFTER THE CHECK-IN DAY (never before or on
   * it). The old positional version indexed the whole list of enabled days, which
   * still starts at day 7, 8, 9 ... when earlier days stay enabled - so
   * "position nights-1" was the check-in day itself and it was clicked twice.
   * The extra attempts cover a minimum-stay rule. After a rejected range the
   * check-in is clicked again first, so every attempt starts from a known state.
   * Every step is logged so a failure explains itself.
   */
  private async tryStayDates(startOffset: number, nights: number): Promise<{ ok: boolean; log: string[] }> {
    const log: string[] = [];
    await this.openDatesPicker();
    await this.ensureStayWindow(startOffset, nights);

    const checkIn = await this.clickCheckIn(startOffset, nights);
    log.push(`check-in: day ${checkIn.label} (list position ${checkIn.index}), click registered: ${checkIn.registered}`);

    for (let attempt = 0; attempt <= 6; attempt++) {
      await this.assertTimeLeft(log, `check-out attempt ${attempt + 1}`);
      if (attempt > 0) {
        const prev = await this.stableCells(1_500);
        const a = this.anchorIndex(prev, checkIn.label, checkIn.index);
        if (a >= 0) {
          await this.activate(prev[a].cell);
          await this.page.waitForTimeout(400);
        }
      }

      const live = await this.stableCells(1_500); // re-read: the list can shift after every click
      if (live.length === 0) {
        log.push('no enabled day cells left');
        break;
      }
      const anchor = this.anchorIndex(live, checkIn.label, checkIn.index);
      const offset = nights + attempt;
      let target: DayCell;
      if (anchor >= 0) {
        const run = this.consecutiveRunLength(live, anchor);
        if (offset > run) {
          log.push(`stopped: only ${run} consecutive day(s) follow check-in day ${checkIn.label}`);
          break;
        }
        target = live[anchor + offset];
      } else {
        target = live[Math.min(nights - 1 + attempt, live.length - 1)];
        log.push(`check-in day ${checkIn.label} not found in the live list; using position ${nights - 1 + attempt}`);
      }

      // The first check-out day is tried with every kind of click (a click that did not
      // register looks the same as a rejected range); later days with the default only.
      const modes: Array<'auto' | 'force' | 'key'> = attempt === 0 ? ['auto', 'force', 'key'] : ['auto'];
      for (const mode of modes) {
        await this.activate(target.cell, mode).catch(() => {});
        const enabled = await this.applyEnabled(2_500);
        log.push(
          `check-out attempt ${attempt + 1}: day ${target.label} (${offset} cells after check-in), ` +
            `${mode} click -> Apply ${enabled ? 'enabled' : 'disabled'}`
        );
        if (enabled) return { ok: true, log };
      }
    }
    return { ok: false, log };
  }

  /**
   * Selects check-in/check-out and applies. If a pass leaves Apply disabled, the
   * page is reloaded and the whole selection is tried once more from a clean
   * picker, because a half-finished range can leave the widget in a state that
   * more clicks only make worse.
   */
  async selectStayDates(startOffset: number = 2, nights: number = 3) {
    await this.ensureTallViewport();
    this.deadline = Date.now() + 100_000; // the whole booking test has 150s; leave room for guests, price, Book Now
    const logs: string[] = [];
    for (let pass = 1; pass <= 2; pass++) {
      if (pass === 2) {
        if (this.deadline - Date.now() < 40_000) break; // too little time left for a clean second pass
        await this.page.reload();
        await this.page.waitForTimeout(1000);
        await this.dismissCookieBanner();
      }
      const result = await this.tryStayDates(startOffset, nights);
      logs.push(`pass ${pass}:\n  ${result.log.join('\n  ')}`);
      if (result.ok) {
        await this.clickApply();
        if (!(await this.datesApplied(6_000))) {
          // The Apply click may not have registered: press it once more before failing.
          await this.activate(await this.applyButton('calendar'), 'dom').catch(() => {});
          if (!(await this.datesApplied(6_000))) {
            throw new Error(
              `Dates were not applied (the DD/MM/YYYY placeholder is still shown).\n${await this.describeCalendar()}`
            );
          }
        }
        return;
      }
    }
    throw new Error(
      `Apply stayed disabled - the date range was not completed.\n${logs.join('\n')}\n${await this.describeCalendar()}`
    );
  }

  // ---------------------------------------------------------------------------
  // Guests, price, booking
  // ---------------------------------------------------------------------------

  private async guestsPanelOpen(timeout: number): Promise<boolean> {
    return this.page
      .getByRole('button', { name: 'Increase value' })
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * Desktop: click the "Adults" text. If that does not open the guests panel (the
   * tablet layout shows the guests row with a separate "Edit" button), press the
   * plain "Edit" buttons one by one until the panel (its "Increase value" button)
   * appears. The dates control is named "Dates ... Edit", so it is not matched by
   * the exact "Edit" name.
   */
  async openGuestsSelector() {
    await this.dismissCookieBanner();
    const trigger = this.page.getByText(/adults?/i).filter({ visible: true }).last();
    if ((await trigger.count()) > 0) {
      await this.scrollToUpperViewport(trigger);
      await this.safeClick(trigger);
      if (await this.guestsPanelOpen(2_500)) return;
    }

    const edits = this.page.getByRole('button', { name: /^edit$/i }).filter({ visible: true });
    const count = Math.min(await edits.count(), 4);
    for (let i = 0; i < count; i++) {
      await this.safeClick(edits.nth(i)).catch(() => {});
      if (await this.guestsPanelOpen(2_500)) return;
    }
    throw new Error(
      'Could not open the guests selector (no "Increase value" button appeared).\n' +
        `Visible controls -> ${await this.describeVisibleControls()}`
    );
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
    await this.clickApply('guest selection');
  }

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

  async clickBookNow() {
    await this.dismissCookieBanner();
    await this.safeClick(this.page.getByRole('button', { name: 'Book Now', exact: true }).filter({ visible: true }).first());
  }

  async expectNavigatedToReserve() {
    await expect(this.page).toHaveURL(/\/reserve\/property\//, { timeout: 15_000 });
  }

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