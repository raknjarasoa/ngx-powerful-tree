import { test, expect } from '@playwright/test';

test.describe('ngx-powerful-tree Playground E2E Tests', () => {
  
  test.beforeEach(async ({ page }) => {
    // Navigate to playground home
    await page.goto('/');
  });

  test('should load playground header and performance stats', async ({ page }) => {
    // Check main title
    await expect(page.locator('h1')).toContainText('ngx-powerful-tree');
    
    // Check loading metrics
    const statsCard = page.locator('.stats-card');
    await expect(statsCard).toContainText('100,000 items');
    await expect(statsCard).toContainText('Zoneless');
  });

  test('should virtualize rendering and only mount a fraction of 100k items in the DOM', async ({ page }) => {
    // Out of 100k items, only a few visible rows should be rendered in the DOM viewport
    const rows = page.locator('.ngx-tree-row');
    const count = await rows.count();
    
    // The default viewport is around 400px height, showing roughly 10-25 items at a time
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(100); // Definitely virtualized!
  });

  test('should perform fluid search filtering and highlight matching items', async ({ page }) => {
    const searchInput = page.locator('#search-input');
    await searchInput.fill('Collection_10');
    
    // Allow search indexing to update the reactive state
    await page.waitForTimeout(500);

    const matches = page.locator('.ngx-tree-name--matched, .ngx-tree-item-name--matched');
    const matchCount = await matches.count();
    
    // We expect some highlighted matches containing 'Collection_10'
    expect(matchCount).toBeGreaterThan(0);
    await expect(matches.first()).toContainText('Collection_10');
  });

  test('should handle WAI-ARIA keyboard navigation focus transitions', async ({ page }) => {
    // 1. Focus the first tree item
    const firstRow = page.locator('.ngx-tree-row').first();
    await firstRow.click();
    
    // Assert focused class is attached
    await expect(firstRow).toHaveClass(/ngx-tree-row--focused/);
    
    // 2. Press ArrowDown to transition focus
    await page.keyboard.press('ArrowDown');
    
    // The second row should now be focused
    const secondRow = page.locator('.ngx-tree-row').nth(1);
    await expect(secondRow).toHaveClass(/ngx-tree-row--focused/);
    await expect(firstRow).not.toHaveClass(/ngx-tree-row--focused/);

    // 3. Press ArrowRight to expand a folder if focused
    const focusedRow = page.locator('.ngx-tree-row--focused');
    if (await focusedRow.locator('.ngx-tree-arrow-btn').isVisible()) {
      await expect(focusedRow).toHaveClass(/ngx-tree-row--collapsed/);
      await page.keyboard.press('ArrowRight');
      await expect(focusedRow).toHaveClass(/ngx-tree-row--expanded/);
    }
  });

  test('should display and operate the tree successfully inside overlays', async ({ page }) => {
    // Check that overlay doesn't exist initially
    await expect(page.locator('.overlay-backdrop')).not.toBeVisible();

    // Click button to trigger overlay dialog
    const overlayBtn = page.locator('.action-btn-overlay');
    await overlayBtn.click();

    // Backdrop should now be visible
    const backdrop = page.locator('.overlay-backdrop');
    await expect(backdrop).toBeVisible();

    // Verify a virtualized tree is rendered inside the overlay
    const overlayTreeRows = page.locator('.overlay-tree-wrapper .ngx-tree-row');
    const count = await overlayTreeRows.count();
    expect(count).toBeGreaterThan(0);

    // Close the overlay modal
    const closeBtn = page.locator('.close-overlay');
    await closeBtn.click();
    await expect(backdrop).not.toBeVisible();
  });

  test('should allow folder renaming inline', async ({ page }) => {
    // 1. Hover first row and click rename button
    const firstRow = page.locator('.ngx-tree-row').first();
    await firstRow.hover();
    
    const renameBtn = firstRow.locator('button[title="Rename"]');
    await renameBtn.click();

    // 2. An input element should appear containing the folder name
    const editInput = page.locator('.ngx-tree-edit-input');
    await expect(editInput).toBeVisible();

    // 3. Type new name and press enter
    await editInput.fill('📁 Renamed Volume');
    await editInput.press('Enter');

    // 4. Input should disappear and name should update in row
    await expect(editInput).not.toBeVisible();
    await expect(firstRow).toContainText('Renamed Volume');
  });
});
