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
   * The real control is a SINGLE button whose accessible name is literally
   * "Check-In DD/MM/YYYY Check-Out" before any date is picked, and shows the
   * applied range afterward. There are separate <p> labels nearby that are
   * purely decorative and do not reliably reflect this button's state -
   * verify against this button (or page-wide placeholder text), never a <p>.
   *
   * Returns ALL visible matches: the page can contain more than one (sticky
   * bar, hidden duplicate), so openDatesPicker() picks the one that is really
   * on screen instead of blindly taking the first.
   */
  private datesTrigger(): Locator {
    return this.page.getByRole('button', { name: /check-in/i }).filter({ visible: true });
  }

  async openDatesPicker() {
    await this.dismissCookieBanner();
    const trigger = await this.firstReachable(this.datesTrigger());
    // Put the trigger near the TOP of the screen first, so the calendar that opens
    // below it (with its Apply button at the bottom) fits inside the viewport.
    await this.scrollToUpperViewport(trigger);
    await this.safeClick(trigger);
  }

  // ---------------------------------------------------------------------------
  // Calendar helpers
  // ---------------------------------------------------------------------------

  /**
   * On some property pages (the first property reached from the listing) the page
   * does not scroll while the booking calendar is open: in the failing run
   * scrollY stayed 0 and the inline calendar started at y=1060 in a 1200px-high
   * window, so every row after the second, later check-out days and the Apply
   * button below them were permanently off-screen. Scrolling cannot help, so make
   * the window taller instead. The size stays for the rest of the test (the page
   * is per-test), which also keeps the guests popover and its Apply button visible.
   */
  private async ensureTallViewport(minHeight: number = 2000) {
    const size = this.page.viewportSize();
    if (size && size.height < minHeight) {
      await this.page.setViewportSize({ width: size.width, height: minHeight });
      await this.page.waitForTimeout(300); // let the layout settle after the resize
    }
  }

  /**
   * Snapshot of ALL enabled day cells in DOM order. Reachability is deliberately
   * not used to filter here: the failing runs showed cells (and Apply) reported as
   * "outside of the viewport" even though they were perfectly valid, so filtering
   * on geometry hid real days and produced wrong check-in/out choices. Clicks go
   * through activate(), which has keyboard/DOM fallbacks that ignore geometry.
   */
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

  /** The calendar's "next month" arrow - scoped so a photo-gallery "Next" button can never match. */
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

  /**
   * Geometry of the first enabled day cell that is off-screen or covered: viewport
   * size, scroll position, its rectangle, what sits on top of it, and the chain of
   * ancestors with position/overflow. This is the evidence needed to see WHY a
   * click is reported as outside the viewport (clipping container, fixed popover...).
   */
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

  /** Human-readable calendar state, appended to errors so a failed run explains itself. */
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

  /**
   * Makes sure the visible months hold a run of `nights + 1` consecutive
   * bookable days at/after the preferred check-in. This property's near-term
   * availability can be genuinely thin (e.g. only 27 and 28 free), so when no
   * such run exists the calendar is advanced month by month until one does.
   */
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
   * Clicks the check-in cell, verifying the click registered (the enabled-day
   * list changes once a check-in is set). The very first click after opening can
   * be swallowed while the cells settle, and a swallowed click looks identical to
   * a successful one unless checked. Returns the check-in day number.
   */
  private async clickCheckIn(startOffset: number, nights: number): Promise<number> {
    const cells = await this.stableCells();
    const windowStart = this.findStayWindow(cells, startOffset, nights);
    const target = cells[windowStart >= 0 ? windowStart : Math.min(startOffset, cells.length - 1)];
    const before = cells.map((c) => c.label).join(',');

    for (let attempt = 0; attempt < 3; attempt++) {
      // 2nd attempt uses a plain DOM click in case Enter/mouse had no visible effect.
      await this.activate(target.cell, attempt === 1 ? 'dom' : 'auto');
      await this.page.waitForTimeout(500);
      const after = (await this.cells()).map((c) => c.label).join(',');
      if (after !== before) break; // calendar reacted -> check-in accepted
    }
    return Number(target.label);
  }

  /**
   * Finds the check-out cell `nights` days AFTER the check-in day.
   * The old code clicked "the Nth enabled cell on the page", which is only
   * `nights` after check-in when the calendar disables every earlier day; when it
   * doesn't, it landed 1 night after check-in and Apply stayed disabled.
   */
  private async findCheckOut(checkInDay: number, nights: number): Promise<DayCell | undefined> {
    const cells = await this.stableCells();
    const wanted = checkInDay + nights;

    // Prefer a cell that sits exactly `nights` days after the check-in inside one consecutive run.
    const runStart = cells.findIndex(
      (c, i) => Number(c.label) === checkInDay && Number(cells[i + nights]?.label) === wanted
    );
    if (runStart >= 0) return cells[runStart + nights];

    // Otherwise any cell carrying the wanted day number.
    return cells.find((c) => Number(c.label) === wanted);
  }

  private async applyEnabled(timeout: number): Promise<boolean> {
    const apply = this.page.getByRole('button', { name: 'Apply' }).filter({ visible: true }).first();
    try {
      await expect(apply).toBeEnabled({ timeout });
      return true;
    } catch {
      return false;
    }
  }

  private async clickApply(what: string = 'date range') {
    await this.dismissCookieBanner();
    const apply = this.page.getByRole('button', { name: 'Apply' }).filter({ visible: true }).first();
    // A disabled Apply button means the selection was never actually
    // completed - clicking it anyway (even with force) hides the real
    // problem behind a confusing "outside of viewport" error. Fail clearly
    // here instead, so the real cause (incomplete selection) is obvious.
    try {
      await expect(apply, `Apply stayed disabled - the ${what} was not completed`).toBeEnabled({
        timeout: 8_000,
      });
    } catch (error) {
      throw new Error(`${(error as Error).message}\n${await this.describeCalendar()}`);
    }
    await this.safeClick(apply);
  }

  /**
   * Opens the dates control, makes sure a usable run of days is showing
   * (advancing months if availability is thin), picks a verified check-in, then
   * a check-out `nights` days later. If the site enforces a minimum stay, Apply
   * stays disabled after the first check-out click, so later check-out days are
   * tried (+1 night at a time) until Apply enables. Then Apply, and verify the
   * "DD/MM/YYYY" placeholder is gone.
   */
  async selectStayDates(startOffset: number = 2, nights: number = 3) {
    await this.ensureTallViewport();
    await this.openDatesPicker();
    await this.ensureStayWindow(startOffset, nights);

    const checkInDay = await this.clickCheckIn(startOffset, nights);

    let completed = false;
    for (let extra = 0; extra <= 4 && !completed; extra++) {
      const checkOut = await this.findCheckOut(checkInDay, nights + extra);
      if (!checkOut) break;
      await this.activate(checkOut.cell);
      completed = await this.applyEnabled(2_500);
    }
    if (!completed) {
      throw new Error(
        `Apply stayed disabled - the date range was not completed (check-in day ${checkInDay}, ` +
          `tried check-outs ${nights}-${nights + 4} nights later).\n${await this.describeCalendar()}`
      );
    }

    await this.clickApply();
    await expect(this.page.getByText('DD/MM/YYYY'), 'Dates were not applied (placeholder still shown)').toHaveCount(
      0,
      { timeout: 10_000 }
    );
  }

  // ---------------------------------------------------------------------------
  // Guests, price, booking
  // ---------------------------------------------------------------------------

  async openGuestsSelector() {
    await this.dismissCookieBanner();
    const trigger = this.page.getByText(/adults?/i).filter({ visible: true }).last();
    await this.scrollToUpperViewport(trigger); // same reason as the dates picker: leave room for the popover
    await this.safeClick(trigger);
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