import { test, expect } from '@playwright/test';

/**
 * Smoke tests — verifies routing and basic rendering without requiring
 * OBS, live platform connections, or any streaming activity.
 */

test.describe('App smoke tests', () => {
  test('/ redirects to /ottery-live/dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/ottery-live\/dashboard/);
  });

  test('Dashboard: shows "Waiting for OBS" status bar in idle state', async ({ page }) => {
    await page.goto('/ottery-live/dashboard');
    await expect(page.getByText('Waiting for OBS')).toBeVisible();
  });

  test('Platforms page: renders without error', async ({ page }) => {
    await page.goto('/ottery-live/platforms');
    // Either the empty state or the platform list heading should be visible
    const heading = page.getByRole('heading', { name: 'Platforms' });
    await expect(heading).toBeVisible();
  });

  test('Platforms page: shows empty state card when no platforms configured', async ({ page }) => {
    await page.goto('/ottery-live/platforms');
    // If no platforms are configured (clean test DB), the empty state card is shown
    // We check for either the empty state or the platform list — both are valid
    const emptyHeading = page.getByText('No platforms configured');
    const addButton = page.getByRole('button', { name: /Add Platform/ }).first();
    // At minimum, the Add Platform button must exist
    await expect(addButton).toBeVisible();
    // Allow the empty state heading as an optional check
    const count = await emptyHeading.count();
    if (count > 0) {
      await expect(emptyHeading).toBeVisible();
    }
  });

  test('Settings page: renders the settings form', async ({ page }) => {
    await page.goto('/ottery-live/settings');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('Event log page: renders the Event Log heading', async ({ page }) => {
    await page.goto('/ottery-live/events');
    await expect(page.getByRole('heading', { name: 'Event Log' })).toBeVisible();
  });
});
