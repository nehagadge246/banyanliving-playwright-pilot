import { test } from '@playwright/test';
import { PropertyPage } from '../pages/property-page';
import { WishlistPage } from '../pages/wishlist-page';

const PROPERTY_SLUG = 'reef-residences-3-three-bedroom-3b-premium';

test.describe('Wishlist @regression', () => {
  test('adds a property to the wishlist and sees it on the wishlist page', async ({ page }) => {
    const property = new PropertyPage(page);
    const wishlist = new WishlistPage(page);

    await property.gotoProperty(PROPERTY_SLUG);
    await property.toggleWishlist();

    await wishlist.gotoWishlist();
    await wishlist.expectPropertyListed(PROPERTY_SLUG);
  });

  test('removes a property from the wishlist', async ({ page }) => {
    const property = new PropertyPage(page);
    const wishlist = new WishlistPage(page);

    await property.gotoProperty(PROPERTY_SLUG);
    await property.toggleWishlist(); // add
    await property.toggleWishlist(); // remove

    await wishlist.gotoWishlist();
    await wishlist.expectPropertyNotListed(PROPERTY_SLUG);
  });
});