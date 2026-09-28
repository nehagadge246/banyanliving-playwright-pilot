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
    await this.fillRemainingRequiredFields();
  }

  /** Fills any other visible required field (phone, subject, dropdown, consent) so the form can submit. */
  private async fillRemainingRequiredFields() {
    const required = this.page
      .locator('input[required], input[aria-required="true"], select[required], textarea[required]')
      .filter({ visible: true });
    const count = await required.count();
    for (let i = 0; i < count; i++) {
      const el = required.nth(i);
      const tag = await el.evaluate((e) => e.tagName.toLowerCase()).catch(() => 'input');
      const type = (await el.getAttribute('type').catch(() => null)) ?? 'text';
      if (tag === 'select') {
        await el.selectOption({ index: 1 }).catch(() => {});
        continue;
      }
      if (type === 'checkbox' || type === 'radio') {
        await el.check({ force: true }).catch(() => {});
        continue;
      }
      if ((await el.inputValue().catch(() => 'x')) !== '') continue;
      const value =
        type === 'email' ? 'qa-automation@example.com' : type === 'tel' ? '9999999999' : type === 'number' ? '5' : 'Test';
      await el.fill(value).catch(() => {});
    }
  }

  /** Short dump of errors and page text, so a failure tells us what the form really showed. */
  private async describeState(): Promise<string> {
    const alerts = await this.page
      .locator('[role="alert"], [class*="error" i], [aria-invalid="true"]')
      .allInnerTexts()
      .catch(() => [] as string[]);
    const body = (await this.page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    return `URL: ${this.page.url()}\nErrors: ${JSON.stringify(alerts.filter(Boolean).slice(0, 5))}\nPage text (end): ${body.slice(-600)}`;
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

  /**
   * True when the form carries a CAPTCHA (reCAPTCHA, hCaptcha or Turnstile).
   * These widgets render a moment after load, so wait briefly for one to attach.
   */
  async hasHumanVerification(): Promise<boolean> {
    const captcha = this.page.locator(
      [
        'iframe[src*="recaptcha"]',
        'iframe[title*="reCAPTCHA" i]',
        '.g-recaptcha',
        '[data-sitekey]',
        'iframe[src*="hcaptcha"]',
        'iframe[src*="turnstile"]',
        '.cf-turnstile',
      ].join(', ')
    );
    await captcha.first().waitFor({ state: 'attached', timeout: 5_000 }).catch(() => {});
    return (await captcha.count()) > 0;
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
    try {
      await this.waitForSubmitSign();
    } catch {
      throw new Error(`Contact form did not show a sign of successful submission.\n${await this.describeState()}`);
    }
  }

  private async waitForSubmitSign() {
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
        { timeout: 20_000 }
      )
      .toBe(true);
  }
}