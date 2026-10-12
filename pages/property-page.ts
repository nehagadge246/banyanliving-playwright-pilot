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

  /**
   * FIX: dayCellInfo() only scopes to an open dialog/popover when it can find one
   * ([role="dialog"] or a radix popper wrapper). When the calendar on this page
   * isn't wrapped that way, it falls back to querying enabled day buttons across
   * the WHOLE page - which also picks up this site's hidden duplicate calendar for
   * the other breakpoint (the same duplication the Dates/Guests triggers already
   * work around elsewhere in this file via firstReachable()). Those extra cells
   * were getting interleaved into the list, which corrupts every index-based
   * lookup downstream (findStayWindow / anchorIndex / consecutiveRunLength) and
   * was the likely cause of check-in/check-out landing on the wrong day. Filtering
   * to `clickable` keeps only cells that are actually reachable on screen.
   */
  private async cells(): Promise<DayCell[]> {
    return (await this.dayCellInfo()).filter((c) => c.clickable);
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

  /**
   * FIX: previously ended with `.first()`, so only one candidate ever reached
   * ensureStayWindow() and it was clicked without checking it was actually
   * reachable (same duplicate-breakpoint risk as the day cells above). Reachability
   * is now resolved by the caller via firstReachable(), so this returns every
   * matching candidate.
   */
  private nextMonthButton(): Locator {
    const byName = this.page.getByRole('button', { name: /next month|go to next/i }).filter({ visible: true });
    const byClass = this.page
      .locator('button[name="next-month"], button.rdp-nav_button_next, button[class*="button_next"]')
      .filter({ visible: true });
    const inPopover = this.page
      .locator('[data-radix-popper-content-wrapper], [role="dialog"]')
      .getByRole('button', { name: /next/i })
      .filter({ visible: true });
    return byName.or(byClass).or(inPopover);
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

      const candidates = this.nextMonthButton();
      if ((await candidates.count()) === 0) break;
      const next = await this.firstReachable(candidates);
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
      .evaluate(() => {
        // On the tablet calendar the "selected" styling is not necessarily on the day button
        // itself (it can sit on the wrapper cell), so the fingerprint covers the button, its
        // two ancestors (every attribute) and any text on the page that mentions nights / dates.
        const attrs = (e: Element | null) =>
          e ? Array.from(e.attributes).map((a) => `${a.name}=${a.value}`).join(';') : '';
        const cells = Array.from(document.querySelectorAll('button'))
          .filter((b) => /^\d{1,2}$/.test((b.textContent || '').trim()))
          .map((b) =>
            [
              (b.textContent || '').trim(),
              attrs(b),
              attrs(b.parentElement),
              attrs(b.parentElement ? b.parentElement.parentElement : null),
              (b as HTMLButtonElement).disabled ? 'd' : 'e',
            ].join('|')
          );
        const lines = (document.body.innerText || '')
          .split('\n')
          .map((t) => t.trim())
          .filter((t) => t.length < 90 && /\bnights?\b|check-?(in|out)|selected|[A-Za-z]{3} \d{1,2}, \d{4}/i.test(t))
          .slice(0, 12);
        return cells.join('\n') + '\n##' + lines.join('~');
      })
      .catch(() => '');
  }

  /** Short description of what changed between two fingerprints (for the failure log). */
  private describeChange(before: string, after: string): string {
    if (before === after) return 'nothing changed';
    const a = before.split('\n');
    const b = after.split('\n');
    const diffs: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length) && diffs.length < 2; i++) {
      if (a[i] !== b[i]) diffs.push(`[${(a[i] ?? '').slice(0, 110)}] -> [${(b[i] ?? '').slice(0, 110)}]`);
    }
    return diffs.join(' ; ');
  }

  /**
   * Clicks a check-in cell and checks that the click registered by comparing the
   * day-button fingerprint before/after. Only if NOTHING changed (the first click
   * after opening can be swallowed while the cells settle) is it clicked once more.
   */
  private async clickCheckIn(
    startOffset: number,
    nights: number
  ): Promise<{ label: string; index: number; registered: boolean; change: string }> {
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
    return { label: target.label, index, registered, change: this.describeChange(beforeKey, await this.dayStateKey()) };
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
   *
   * FIX: 'guests' used to fall into the 'any' branch below, which just grabs the
   * first reachable "Apply" button ANYWHERE on the page - with no guarantee it's
   * the guests panel's own Apply. If a stray reachable Apply existed elsewhere
   * (e.g. a dates sheet that stays mounted on this tablet layout), confirmGuests()
   * could click that one instead: it "succeeds" (no error), but the guests panel
   * never actually closes. That is exactly what the tablet failures showed - a
   * lingering visible "Apply" and two "Edit" buttons after the booking flow, no
   * price, and a Book Now click that later failed because the page was still
   * mid-transition. 'guests' now gets the same scoped lookup 'calendar' already
   * had: walk up from the guest stepper's own "Increase value"/"Decrease value"
   * button to find that panel's Apply, instead of guessing.
   */
  private async applyButton(scope: 'calendar' | 'guests' | 'any' = 'any'): Promise<Locator> {
    if (scope === 'calendar' || scope === 'guests') {
      // The page can hold several Apply buttons (the tablet layout's sheet, the
      // guests panel). Walk up from an element that only exists inside the panel
      // we actually care about - a day cell for 'calendar', the guest stepper for
      // 'guests' - to the nearest container that holds an Apply button, and tag it.
      const anchorIsCalendar = scope === 'calendar';
      const tagged = await this.page
        .evaluate((anchorIsCalendar) => {
          document.querySelectorAll('[data-pw-apply]').forEach((e) => e.removeAttribute('data-pw-apply'));
          const anchor = anchorIsCalendar
            ? Array.from(document.querySelectorAll('button')).find(
                (b) =>
                  /^\d{1,2}$/.test((b.textContent || '').trim()) &&
                  !(b as HTMLButtonElement).disabled &&
                  b.getBoundingClientRect().width > 0
              )
            : Array.from(document.querySelectorAll('button')).find(
                (b) =>
                  /^(increase|decrease) value$/i.test((b.textContent || b.getAttribute('aria-label') || '').trim()) &&
                  b.getBoundingClientRect().width > 0
              );
          let node: Element | null = anchor || null;
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
        }, anchorIsCalendar)
        .catch(() => false);
      if (tagged) return this.page.locator('[data-pw-apply="1"]').first();
    }
    return this.firstReachable(this.page.getByRole('button', { name: 'Apply' }).filter({ visible: true }));
  }

  private async applyEnabled(timeout: number, scope: 'calendar' | 'guests' | 'any' = 'calendar'): Promise<boolean> {
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
    const scope = what === 'date range' ? 'calendar' : what === 'guest selection' ? 'guests' : 'any';
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
    // The Apply button can be re-rendered between finding it and clicking it (the tagged node then
    // no longer exists): look it up again for each of up to 3 tries.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.safeClick(await this.applyButton(scope));
        return;
      } catch (error) {
        if (attempt === 3) throw error;
        if (scope === 'calendar' && (await this.datesApplied(1_000))) return; // it applied after all
        await this.page.waitForTimeout(500);
      }
    }
  }

  /**
   * True once the guests panel's own stepper is gone, i.e. the panel actually
   * closed. confirmGuests() previously had no equivalent check (unlike dates'
   * datesApplied()), so a guests Apply click that silently missed its target
   * went unnoticed until the price check failed much later with no clear cause.
   */
  private async guestsApplied(timeout: number): Promise<boolean> {
    try {
      await expect
        .poll(async () => this.page.getByRole('button', { name: 'Increase value' }).filter({ visible: true }).count(), {
          timeout,
        })
        .toBe(0);
      return true;
    } catch {
      return false;
    }
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

  /** Day-button fingerprint plus the dates control's text: changes when a click on a day registered. */
  private async stateFingerprint(): Promise<string> {
    const trigger = await this.datesTrigger()
      .first()
      .textContent({ timeout: 500 })
      .catch(() => '');
    return `${await this.dayStateKey()}##${trigger ?? ''}`;
  }

  /**
   * Reads the applied range from the dates control (e.g. "DatesOct 13, 2026 - Oct 13, 2026Edit" on
   * the tablet, "Check-In 13/10/2026 ... Check-Out" on desktop) and returns the number of nights, or
   * null if two dates cannot be read. A same-day range (0 nights) is what produced "no price" and
   * "The property requires a minimum stay of 3 night(s)" in the failing runs.
   */
  private async appliedRange(): Promise<{ text: string; nights: number | null }> {
    const text = ((await this.datesTrigger().first().textContent({ timeout: 2_000 }).catch(() => '')) ?? '').trim();
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const found: number[] = [];
    const re = /([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\/(\d{1,2})\/(\d{4})/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m[1]) {
        const mi = months.indexOf(m[1].toLowerCase());
        if (mi >= 0) found.push(Date.UTC(Number(m[3]), mi, Number(m[2])));
      } else {
        found.push(Date.UTC(Number(m[6]), Number(m[5]) - 1, Number(m[4])));
      }
    }
    if (found.length < 2) return { text, nights: null };
    return { text, nights: Math.round((found[1] - found[0]) / 86_400_000) };
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
    log.push(`check-in: day ${checkIn.label} (list position ${checkIn.index}), click registered: ${checkIn.registered} (${checkIn.change})`);

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

      // The first check-out day is tried with every kind of click, but only while the click had
      // no visible effect: on the tablet Apply is already enabled after the check-in alone (a
      // same-day range), so "Apply enabled" proves nothing. A check-out click counts only if it
      // changed the calendar state, and a click that did register is never repeated on the same day.
      const modes: Array<'auto' | 'force' | 'key'> = attempt === 0 ? ['auto', 'force', 'key'] : ['auto'];
      for (const mode of modes) {
        const before = await this.stateFingerprint();
        await this.activate(target.cell, mode).catch(() => {});
        await this.page.waitForTimeout(500);
        const afterFp = await this.stateFingerprint();
        const registered = afterFp !== before;
        const enabled = registered && (await this.applyEnabled(2_500));
        log.push(
          `check-out attempt ${attempt + 1}: day ${target.label} (${offset} cells after check-in), ` +
            `${mode} click -> ${registered ? 'registered' : 'no effect'} (${registered ? this.describeChange(before, afterFp).slice(0, 160) : ''}), Apply ${enabled ? 'enabled' : 'disabled'}`
        );
        if (enabled) return { ok: true, log };
        if (registered) break; // registered but rejected (e.g. minimum stay): move on to the next day
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
        const range = await this.appliedRange();
        if (range.nights === null || range.nights >= nights) return;
        logs.push(`  applied range "${range.text}" is ${range.nights} night(s), at least ${nights} needed - retrying`);
      }
    }
    throw new Error(
      `The date range was not completed (Apply stayed disabled, or a range shorter than ${nights} night(s) was applied).\n${logs.join('\n')}\n${await this.describeCalendar()}`
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
   *
   * FIX: this used to grab the `.last()` "Adults" text match, with no reachability
   * check - the same duplicate-breakpoint hazard as the calendar cells above. Now
   * resolved through firstReachable(), matching how every other trigger in this
   * file (datesTrigger, applyButton) is already resolved.
   */
  async openGuestsSelector() {
    await this.dismissCookieBanner();
    const candidates = this.page.getByText(/adults?/i).filter({ visible: true });
    if ((await candidates.count()) > 0) {
      const trigger = await this.firstReachable(candidates);
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
    if (!(await this.guestsApplied(6_000))) {
      // The Apply click may have landed on the wrong (already-enabled) Apply
      // button elsewhere on the page instead of the guests panel's own - press
      // the correctly-scoped one once more before failing.
      await this.activate(await this.applyButton('guests'), 'dom').catch(() => {});
      if (!(await this.guestsApplied(6_000))) {
        throw new Error(
          'Guests were not applied (the guest stepper is still open after pressing Apply).\n' +
            `Visible controls -> ${await this.describeVisibleControls()}`
        );
      }
    }
  }

  /**
   * Desktop: a Search button recalculates the price after dates/guests change. The
   * tablet layout has no such button (the tablet run showed none, only Book Now), so
   * it presumably recalculates when Apply is pressed. If no Search button shows up
   * within a few seconds, there is nothing to press and the price check that follows
   * decides whether the price really appeared.
   */
  async clickSearch() {
    await this.closeAnyOpenPanel();
    await this.dismissCookieBanner();
    const search = this.page.getByRole('button', { name: 'Search' }).filter({ visible: true }).first();
    const present = await search
      .waitFor({ state: 'visible', timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!present) return;
    await this.safeClick(search);
  }

  /**
   * Waits for the "Total for N nights" text. If it is slow (the price is fetched
   * after Search, and staging can take longer than 15s - that made the desktop test
   * flaky), press Search once more if it is there and wait longer. On failure the
   * error lists the price-related lines on the page, so a different wording on the
   * tablet layout is visible at once.
   */
  async getTotalPrice(): Promise<string> {
    const total = this.page.getByText(/total for \d+ nights?/i).filter({ visible: true }).first();
    try {
      await total.waitFor({ state: 'visible', timeout: 12_000 });
    } catch {
      const search = this.page.getByRole('button', { name: 'Search' }).filter({ visible: true }).first();
      if (await search.isVisible().catch(() => false)) {
        await this.safeClick(search).catch(() => {});
      }
      try {
        await total.waitFor({ state: 'visible', timeout: 25_000 });
      } catch {
        const lines = await this.page
          .evaluate(() =>
            (document.body.innerText || '')
              .split('\n')
              .map((s) => s.trim())
              .filter((s) => /total|night|price|book/i.test(s))
              .slice(0, 15)
          )
          .catch(() => [] as string[]);
        throw new Error(
          'The "Total for N nights" price did not appear.\n' +
            `Price-related text on the page: ${JSON.stringify(lines)}\n` +
            `Visible controls -> ${await this.describeVisibleControls()}`
        );
      }
    }
    return (await total.locator('xpath=..').innerText()).trim();
  }

  async expectTotalPriceShown() {
    const text = await this.getTotalPrice();
    expect(text).toMatch(/\d/);
  }

  /**
   * If a date/guests panel is still open (its Apply button is visible and
   * reachable), press Apply to close it before interacting with anything else.
   * A lingering open panel - specifically the guests panel not closing, see the
   * applyButton()/confirmGuests() fix above - is what left the page mid-transition
   * right when Book Now was clicked in the failing tablet run, which is the most
   * likely reason the exact "Book Now" button wasn't found within its wait and the
   * regex fallback target then disappeared mid-click.
   */
  private async closeAnyOpenPanel() {
    const apply = this.page.getByRole('button', { name: /^apply$/i }).filter({ visible: true }).first();
    if (await apply.isVisible().catch(() => false)) {
      await this.safeClick(apply).catch(() => {});
      await this.page.waitForTimeout(300);
    }
  }

  async clickBookNow() {
    await this.closeAnyOpenPanel();
    await this.dismissCookieBanner();
    // The booking button reads "Book Now". A different, lower-case "Book now" control exists
    // elsewhere on the page and leads to /search, so the exact spelling is preferred; only if it
    // is absent is the case-insensitive match used, and then the LAST one (the booking widget
    // comes after the header).
    const exact = this.page.getByRole('button', { name: 'Book Now', exact: true }).filter({ visible: true });
    const found = await exact
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    const target = found
      ? exact.first()
      : this.page.getByRole('button', { name: /^\s*book now\s*$/i }).filter({ visible: true }).last();
    await this.safeClick(target);
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