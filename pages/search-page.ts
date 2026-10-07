import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base-page';

export class SearchPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoByState(state: string) {
    await this.goto(`/locations/${state}`);
  }

  async gotoByBrand(brand: string) {
    await this.goto(`/brands/${brand}`);
  }

  private visibleGuestsField(): Locator {
    return this.page
      .getByRole('button', { name: /guests?/i })
      .filter({ visible: true })
      .first();
  }

  /** Dates trigger reads "Dates" before selection, then the applied range text. */
  private visibleDatesField(): Locator {
    return this.page
      .getByRole('button', { name: /dates?|\d{1,2},\s?\d{4}/i })
      .filter({ visible: true })
      .first();
  }

  async openDatesPicker() {
    await this.dismissCookieBanner();
    await this.safeClick(this.visibleDatesField());
  }

  async openGuestsSelector() {
    await this.dismissCookieBanner();
    await this.safeClick(this.visibleGuestsField());
  }

  async incrementAdults(times: number = 1) {
    const button = this.page
      .getByRole('button', { name: 'Increase value' })
      .filter({ visible: true })
      .first();
    for (let i = 0; i < times; i++) {
      await this.dismissCookieBanner();
      await this.safeClick(button);
    }
  }

  async decrementAdults(times: number = 1) {
    const button = this.page
      .getByRole('button', { name: 'Decrease value' })
      .filter({ visible: true })
      .first();
    for (let i = 0; i < times; i++) {
      await this.dismissCookieBanner();
      await this.safeClick(button);
    }
  }

  /** One shared Apply button commits whichever panel (Dates or Guests) is open. */
  async confirmSelection() {
    await this.dismissCookieBanner();
    await this.safeClick(
      this.page.getByRole('button', { name: /apply/i }).filter({ visible: true }).first()
    );
  }

  async expectBookNowEnabled() {
    await expect(
      this.page.getByRole('button', { name: /book now/i }).filter({ visible: true }).first()
    ).toBeEnabled();
  }

  /**
   * The home page's "Where" search box offers an autocomplete of matching
   * properties/locations. There are 2 elements matching this field: a
   * readonly decoy (tabindex="-1") and the real editable input - exclude
   * readonly explicitly, since a plain visibility filter doesn't catch it.
   */
  private whereInput(): Locator {
    return this.page
      .locator('input[placeholder="Where"]:not([readonly])')
      .filter({ visible: true })
      .first();
  }

  /**
   * On narrower screens (tablet) the "Where" box may be collapsed behind a search
   * or menu button. On desktop the input is already there and this returns
   * immediately. Otherwise it presses search/menu openers until the input shows
   * up, and fails with the list of visible controls if none does.
   */
  private async revealWhereSearch() {
    await this.whereInput().waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
    if ((await this.whereInput().count()) > 0) return;

    // The read-only "Where" field may be the visible one at this size: pressing it
    // can open a panel that holds the real, editable input.
    const readonlyField = this.page
      .locator('input[placeholder="Where"][readonly]')
      .filter({ visible: true })
      .first();
    if ((await readonlyField.count()) > 0) {
      await this.dismissCookieBanner();
      await this.safeClick(readonlyField).catch(() => {});
      await this.page.waitForTimeout(700);
      if ((await this.whereInput().count()) > 0) return;
    }

    const openers = this.page
      .getByRole('button', { name: /search|where|destination|find|menu/i })
      .filter({ visible: true });
    const count = Math.min(await openers.count(), 4);
    for (let i = 0; i < count; i++) {
      await this.dismissCookieBanner();
      await this.safeClick(openers.nth(i)).catch(() => {});
      await this.page.waitForTimeout(700);
      if ((await this.whereInput().count()) > 0) return;
    }
    throw new Error(
      'The "Where" search input is not visible at this screen size and no button revealed it.\n' +
        `Visible controls -> ${await this.describeVisibleControls()}`
    );
  }

  private async reachedPropertyPage(timeout: number): Promise<boolean> {
    return this.page
      .waitForURL(/\/property\//, { timeout })
      .then(() => true)
      .catch(() => false);
  }

  /**
   * One try at: type the name into "Where", pick the suggestion, and reach the
   * property page. Returns whether it got there plus a short note for the error.
   *   - The name is typed key by key (not pasted with fill): autocomplete boxes
   *     usually react to key events, and a pasted value can leave the suggestion
   *     list empty or stale - the cause of the flaky tablet run where the suggestion
   *     was "clicked" but the page never moved.
   *   - The suggestion is looked for inside the dropdown first, then as option /
   *     button / link; with none visible, Enter submits what was typed.
   *   - If selecting it does not navigate, Search is pressed, and if that lands on
   *     a listing, the card with the property's name is opened.
   */
  private async attemptPropertySearch(name: string): Promise<{ reached: boolean; note: string }> {
    await this.dismissCookieBanner();
    await this.revealWhereSearch();
    const input = this.whereInput();
    await this.safeClick(input);
    await input.fill('');
    await input.pressSequentially(name, { delay: 40 });

    const nameRe = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const suggestionCandidates: Locator[] = [
      this.page
        .locator('[role="listbox"], [role="dialog"], [data-radix-popper-content-wrapper], [cmdk-list]')
        .getByText(nameRe)
        .filter({ visible: true })
        .first(),
      this.page.getByRole('option', { name: nameRe }).filter({ visible: true }).first(),
      this.page.getByRole('button', { name: nameRe }).filter({ visible: true }).first(),
      this.page.getByRole('link', { name: nameRe }).filter({ visible: true }).first(),
    ];

    let suggestionFound = false;
    for (const candidate of suggestionCandidates) {
      try {
        await candidate.waitFor({ state: 'visible', timeout: 4_000 });
        await this.safeClick(candidate);
        suggestionFound = true;
        break;
      } catch {
        /* try the next kind of element */
      }
    }
    if (!suggestionFound) {
      await input.press('Enter');
    }

    // A property page can take a while to load on staging, especially on the tablet profile.
    if (await this.reachedPropertyPage(10_000)) return { reached: true, note: '' };

    const searchButton = this.page.getByRole('button', { name: /^search$/i }).filter({ visible: true });
    if ((await searchButton.count()) > 0) {
      await this.safeClick(searchButton.first());
      if (await this.reachedPropertyPage(15_000)) return { reached: true, note: '' };
    }

    const card = this.page
      .locator('a[href*="/property/"]')
      .filter({ hasText: nameRe })
      .filter({ visible: true })
      .first();
    if ((await card.count()) > 0) {
      await this.safeClick(card);
      if (await this.reachedPropertyPage(15_000)) return { reached: true, note: '' };
    }

    return {
      reached: false,
      note: `URL ${this.page.url()}, suggestion found and clicked: ${suggestionFound}`,
    };
  }

  /**
   * Searches for a property by name and ends on its page. Because the autocomplete
   * is timing-sensitive, a try that does not reach the property page is repeated
   * from a freshly loaded home page, up to 3 times, before failing with what each
   * try saw.
   */
  async searchPropertyByName(name: string) {
    const notes: string[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        await this.goto('/');
      }
      const result = await this.attemptPropertySearch(name);
      if (result.reached) return;
      notes.push(`try ${attempt}: ${result.note}`);
    }
    throw new Error(
      `Searching for "${name}" did not reach a property page after 3 tries.\n${notes.join('\n')}\n` +
        'Check test-failed-1.png: if the dropdown has no match, the property was renamed/removed on staging ' +
        '(update the test data); if it has one, the suggestion locator needs adjusting.'
    );
  }

  /** Clicks the first property card/link on the current listing page. */
  async openFirstProperty() {
    await this.dismissCookieBanner();
    const link = this.page.locator('a[href*="/property/"]').filter({ visible: true }).first();
    await link.waitFor({ state: 'visible', timeout: 15_000 });
    await this.safeClick(link);
    await this.page.waitForURL(/\/property\//, { timeout: 15_000 });
  }
}