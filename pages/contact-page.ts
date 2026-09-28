import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base-page';

export class ContactPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /** Reaches the contact page the same way the navigation test does: via the site's Contact link. */
  async gotoContact() {
    await this.goto('/');
    const link = this.page.getByRole('link', { name: /contact/i }).filter({ visible: true }).first();
    await this.safeClick(link);
    await this.page.waitForURL(/contact/i, { timeout: 15_000 });
    await this.dismissCookieBanner();
  }

  private nameField(): Locator {
    return this.page
      .getByRole('textbox', { name: /name/i })
      .or(this.page.getByPlaceholder(/name/i))
      .first();
  }

  private emailField(): Locator {
    return this.page
      .getByRole('textbox', { name: /email/i })
      .or(this.page.getByPlaceholder(/email/i))
      .first();
  }

  private messageField(): Locator {
    return this.page
      .getByRole('textbox', { name: /message|comment|enquiry|inquiry|help/i })
      .or(this.page.locator('textarea'))
      .first();
  }

  async fillForm(details: { name: string; email: string; message: string }) {
    await this.nameField().fill(details.name);
    await this.emailField().fill(details.email);
    await this.messageField().fill(details.message);
  }

  /** Custom role="checkbox": use click (with a retry), not .check(). Skipped if the form has none. */
  async acceptTermsIfPresent() {
    const checkbox = this.page.getByRole('checkbox').first();
    if ((await checkbox.count()) === 0) return;
    await this.safeClick(checkbox);
    if (!(await checkbox.isChecked().catch(() => false))) {
      await this.safeClick(checkbox);
    }
  }

  async submit() {
    await this.dismissCookieBanner();
    await this.safeClick(
      this.page.getByRole('button', { name: /submit|send/i }).filter({ visible: true }).last()
    );
  }

  /**
   * The exact success wording is not known, so accept any clear sign the form
   * went through: a thank-you style message, a thank-you/confirmation URL, or
   * the form being cleared/replaced. A form that still holds the typed message
   * (validation error, blocked submit) fails.
   */
  async expectSubmitted() {
    await expect
      .poll(
        async () => {
          if (/thank|success|confirm/i.test(this.page.url())) return true;

          const message = this.page
            .getByText(
              /thank|success|submitted|received|get back to you|in touch|has been sent|message sent/i
            )
            .filter({ visible: true })
            .first();
          if (await message.isVisible().catch(() => false)) return true;

          const value = await this.messageField()
            .inputValue({ timeout: 500 })
            .catch(() => null);
          return value === null || value === '';
        },
        { timeout: 20_000, message: 'Contact form did not show a sign of successful submission' }
      )
      .toBe(true);
  }
}