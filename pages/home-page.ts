import { Page, expect } from '@playwright/test';
import { BasePage } from './base-page';

export class HomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoHome() {
    await this.goto('/');
  }

  async expectLoaded() {
    await expect(this.page).toHaveURL(/banyanliving\.com/);
    await expect(this.page.locator('body')).toBeVisible();
  }
}