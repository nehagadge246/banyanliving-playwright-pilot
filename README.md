# BanyanLiving Playwright Pilot Project

## Overview
Playwright TypeScript automation framework created as a pilot project for banyanliving.com (staging), following the same POM + fixture-injection structure as the team's `qa-playwright-production` reference repo.

## Tech Stack
- Playwright
- TypeScript

## Project Structure

```
BanyanLiving_Pilot/
├── pages/
│   ├── base-page.ts
│   ├── home-page.ts
│   ├── contact-page.ts
│   ├── navigation-page.ts
│   ├── search-page.ts        # includes booking-widget + wishlist heart toggle
│   ├── wishlist-page.ts
│   └── property-page.ts      # property detail page: dates, guests, promo, price, Book Now, wishlist toggle
├── tests/
│   ├── home.spec.ts
│   ├── contact.spec.ts
│   ├── navigation.spec.ts
│   ├── search.spec.ts
│   ├── booking-widget.spec.ts
│   ├── wishlist.spec.ts
│   └── book-now.spec.ts
├── playwright.config.ts
├── package.json
├── tsconfig.json
└── .env.example
```

## Automated Scenarios

### Home / Navigation
- Homepage loads past Basic Auth
- Main nav routes to Contact

### Contact
- Valid contact form submission (custom checkbox handling)

### Search / Booking Widget
- State listing page loads
- Date range selection (handles the visible/hidden trigger duplication and the Dates label changing after selection)
- Guest increment/decrement
- Book Now button reaches an enabled state

### Wishlist
- Add a property to the wishlist via the heart icon on its card, confirm it shows on `/wishlist`
- Remove a property from the wishlist, confirm it no longer shows

### Book Now
- Property listing → click a property card → property detail page loads
- Set Check-In / Check-Out dates and Guests on the detail page's booking panel
- Price total (`Payment Summary` → `Total for N Nights`) updates
- Click Book Now
- Also covered directly via a known property slug (`/property/<slug>`)

> **Note on locators:** `search-page.ts` and `contact-page.ts` are scaffolded around patterns already confirmed against the live/staging site in the team's other Banyan suite (duplicate hidden/visible triggers, digit-only day cells, a shared Apply button, custom checkbox retry). The exact role names/regexes here are a starting point — run `npx playwright codegen` against staging to confirm or adjust them before relying on these specs.

## Setup

1. `npm install`
2. `npx playwright install`
3. Copy `.env.example` to `.env.pilot` and fill in the staging URL and Basic Auth credentials.
4. `npm test`

## Running Tests

```
npm test                # full suite
npm run test:headed     # headed/visible browser
npm run test:ui         # Playwright UI mode
npm run test:smoke      # only @smoke tagged tests
npm run test:regression # only @regression tagged tests
npm run test:report     # open last HTML report
```

## Run a single spec

```
npx playwright test tests/home.spec.ts
```

## Environment

Copy `.env.example` to `.env.pilot` and provide the staging base URL and Basic Auth credentials. This file is git-ignored — credentials are never committed to the repository.

## CI

`.github/workflows/playwright.yml` runs the suite on every push/PR to `main` via GitHub Actions. It needs three repo secrets set under **Settings → Secrets and variables → Actions**:
- `BANYAN_BASE_URL`
- `BANYAN_HTTP_USERNAME`
- `BANYAN_HTTP_PASSWORD`

The HTML report and, on failure, traces/videos/screenshots are uploaded as workflow artifacts for 14 days.
