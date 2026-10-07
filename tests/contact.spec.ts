import { test } from '@playwright/test';
import { ContactPage } from '../pages/contact-page';

const DETAILS = {
  name: 'QA Automation',
  email: 'qa-automation@example.com',
  message: 'Automated pilot run - please disregard.',
};

test.describe('Contact form @regression', () => {
  test('submits a valid contact request', async ({ page }) => {
    const contact = new ContactPage(page);
    await contact.gotoContact();
    await contact.fillForm(DETAILS);
    await contact.acceptTermsIfPresent();

    // The staging form is protected by CAPTCHA, which exists to stop automated
    // submissions - this suite does not try to get around it. Instead of skipping,
    // the test verifies everything up to the CAPTCHA (fields filled, required
    // fields complete, Submit enabled) and stops there.
    //
    // To run the real submit, ask the developers to set up the staging form with
    // Google's reCAPTCHA test keys (or switch the CAPTCHA off on staging), then run
    // with BANYAN_CAPTCHA_DISABLED=1.
    if (!process.env.BANYAN_CAPTCHA_DISABLED && (await contact.hasHumanVerification())) {
      await contact.expectReadyToSubmit(DETAILS);
      return;
    }

    await contact.submit();
    await contact.expectSubmitted();
  });
});