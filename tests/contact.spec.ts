import { test } from '@playwright/test';
import { ContactPage } from '../pages/contact-page';

test.describe('Contact form @regression', () => {
  test('submits a valid contact request', async ({ page }) => {
    const contact = new ContactPage(page);
    await contact.gotoContact();
    await contact.fillForm({
      name: 'QA Automation',
      email: 'qa-automation@example.com',
      message: 'Automated pilot run - please disregard.',
    });
    await contact.acceptTermsIfPresent();
    await contact.submit();
    await contact.expectSubmitted();
  });
});