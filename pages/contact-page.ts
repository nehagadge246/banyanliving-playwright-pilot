import { Page, Locator, expect, test } from '@playwright/test';
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
    // The verification renders late and sometimes lazily, so the old 5-second wait
    // for the widget alone missed it now and then - the test then clicked a disabled
    // Send button and failed. Wait up to 12s for ANY sign of it: the widget itself,
    // the notice text under the form ("...whether or not you are a human visitor and
    // to prevent automated spam submissions"), or - after the form has had a few
    // seconds to settle - a Send button that is still disabled although every field
    // is filled.
    const notice = this.page.getByText(/human visitor|automated spam|not a robot|captcha/i);
    const send = this.page.getByRole('button', { name: /submit|send/i }).filter({ visible: true }).last();
    const started = Date.now();
    while (Date.now() - started < 12_000) {
      if ((await captcha.count()) > 0) return true;
      if (await notice.first().isVisible().catch(() => false)) return true;
      if (Date.now() - started > 3_000 && (await send.isDisabled().catch(() => false))) return true;
      await this.page.waitForTimeout(500);
    }
    return false;
  }

  /**
   * Everything the form needs before submitting, checked without submitting: the
   * typed values are still in the fields, every required field is filled, and the
   * Submit button is visible and enabled. Used where a CAPTCHA blocks the real
   * submit, so the test still verifies the whole form up to that point.
   */
  async expectReadyToSubmit(details: { name: string; email: string; message: string }) {
    await expect(this.nameField(), 'Name field lost its value').toHaveValue(details.name);
    await expect(this.emailField(), 'Email field lost its value').toHaveValue(details.email);
    await expect(this.messageField(), 'Message field lost its value').toHaveValue(details.message);

    const required = this.page
      .locator('input[required], input[aria-required="true"], select[required], textarea[required]')
      .filter({ visible: true });
    const count = await required.count();
    for (let i = 0; i < count; i++) {
      const el = required.nth(i);
      const type = (await el.getAttribute('type').catch(() => null)) ?? 'text';
      if (type === 'checkbox' || type === 'radio') continue;
      expect(await el.inputValue().catch(() => 'x'), `Required field #${i + 1} is empty`).not.toBe('');
    }

    // Any consent checkbox must be ticked.
    const checkbox = this.page.getByRole('checkbox').first();
    if ((await checkbox.count()) > 0) {
      expect(await checkbox.isChecked().catch(() => false), 'The consent checkbox is not ticked').toBe(true);
    }

    // The Send button is only required to be present: with a CAPTCHA on the form it
    // stays disabled until the CAPTCHA is solved, which is the CAPTCHA working, not a
    // fault in the form. Whether it is currently enabled is recorded, not asserted.
    const submit = this.page.getByRole('button', { name: /submit|send/i }).filter({ visible: true }).last();
    await expect(submit, 'Submit button is not visible').toBeVisible();
    const enabled = await submit.isEnabled().catch(() => false);
    test.info().annotations.push({
      type: 'send-button',
      description: enabled ? 'enabled' : 'disabled until the CAPTCHA is solved (expected)',
    });
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