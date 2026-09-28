import { Page, expect } from '@playwright/test';
import { BasePage } from './base-page';

export class NavigationPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoHome() {
    await this.goto('/');
  }

  async clickNavLink(linkName: string) {
    await this.dismissCookieBanner();
    await this.page.getByRole('link', { name: new RegExp(linkName, 'i') }).click();
  }

  async expectOnPage(pathFragment: string) {
    await expect(this.page).toHaveURL(new RegExp(pathFragment, 'i'));
  }
}