import { Page, expect } from '@playwright/test';
import { BasePage } from './base-page';

export class WishlistPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async gotoWishlist() {
    await this.goto('/wishlist');
  }

  /** Match by the property's link (href contains its slug) instead of display text. */
  async expectPropertyListed(slug: string) {
    await expect(this.page.locator(`a[href*="${slug}"]`).first()).toBeVisible({ timeout: 10_000 });
  }

  async expectPropertyNotListed(slug: string) {
    await expect(this.page.locator(`a[href*="${slug}"]`)).toHaveCount(0, { timeout: 10_000 });
  }
}