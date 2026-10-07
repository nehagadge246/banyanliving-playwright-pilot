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
   * Types the name into "Where", picks the matching suggestion, and ends up on
   * the property page. The old version assumed the suggestion is a <button> and
   * that selecting it (plus an optional Search click) lands on /property/. If the
   * suggestion is another role, or Search leads to a listing instead, the test
   * only failed 15s later with a bare waitForURL timeout. This version:
   *   1. looks for the suggestion inside the dropdown first (so a same-named card
   *      elsewhere on the page cannot match), then falls back to option/button/link;
   *   2. checks whether selecting it navigated straight to /property/;
   *   3. otherwise clicks Search and checks again;
   *   4. otherwise, if a listing is shown, opens the card whose text matches the name;
   *   5. fails with the URL and what was found, so "property no longer exists on
   *      staging" is distinguishable from "locator is wrong".
   */
  async searchPropertyByName(name: string) {
    await this.dismissCookieBanner();
    const input = this.whereInput();
    await this.safeClick(input);
    await input.fill(name);

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
        await candidate.waitFor({ state: 'visible', timeout: 3_000 });
        await this.safeClick(candidate);
        suggestionFound = true;
        break;
      } catch {
        /* try the next kind of element */
      }
    }
    if (!suggestionFound) {
      // No visible suggestion: submit what was typed.
      await input.press('Enter');
    }

    if (await this.reachedPropertyPage(5_000)) return;

    // Selecting the suggestion may only fill the field rather than navigate
    // immediately - if a Search button exists, use it to actually go there.
    const searchButton = this.page.getByRole('button', { name: /^search$/i }).filter({ visible: true });
    if ((await searchButton.count()) > 0) {
      await this.safeClick(searchButton.first());
      if (await this.reachedPropertyPage(8_000)) return;
    }

    // Search may land on a results listing - open the card that matches the name.
    const card = this.page
      .locator('a[href*="/property/"]')
      .filter({ hasText: nameRe })
      .filter({ visible: true })
      .first();
    if ((await card.count()) > 0) {
      await this.safeClick(card);
      if (await this.reachedPropertyPage(10_000)) return;
    }

    throw new Error(
      `Searching for "${name}" did not reach a property page.\n` +
        `Current URL: ${this.page.url()}\n` +
        `Suggestion found and clicked: ${suggestionFound}\n` +
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