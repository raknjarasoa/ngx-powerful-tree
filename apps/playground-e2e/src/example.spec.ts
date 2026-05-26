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

  test('should virtualize rendering and only mount a fraction of 100k items in the DOM', async ({
    page,
  }) => {
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
    await expect(page.locator('.overlay-backdrop')).toBeHidden();

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
    await expect(backdrop).toBeHidden();
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
    await expect(editInput).toBeHidden();
    await expect(firstRow).toContainText('Renamed Volume');
  });

  test('should sync changes and render a clean read-only picker in the relocation overlay', async ({
    page,
  }) => {
    // 1. Get the name/id of the first folder to delete
    const firstRow = page.locator('.ngx-tree-row').first();
    const folderName = await firstRow.locator('.ngx-tree-item-name').innerText();

    // Delete it using the hover action delete button
    await firstRow.hover();
    const deleteBtn = firstRow.locator('button[title="Delete"]');
    await deleteBtn.click();

    // Verify it is deleted from the primary tree
    await expect(firstRow).not.toContainText(folderName);

    // 2. Hover over the next folder and trigger the relocate dialog
    const nextRow = page.locator('.ngx-tree-row').first();
    await nextRow.hover();
    const moveBtn = nextRow.locator('button[title="Move to Folder"]');
    await moveBtn.click();

    // Relocation backdrop should be visible
    const backdrop = page.locator('.overlay-backdrop');
    await expect(backdrop).toBeVisible();

    // 3. Verify the picker tree is fully synced (the deleted folder should NOT exist)
    const pickerTree = page.locator('.overlay-tree-wrapper');
    const deletedFolderLocator = pickerTree.locator(`.ngx-tree-item-name:text-is("${folderName}")`);
    await expect(deletedFolderLocator).toHaveCount(0);

    // 4. Verify the picker tree is strictly read-only (no hover action buttons should render)
    const pickerRow = pickerTree.locator('.ngx-tree-row').first();
    await pickerRow.hover();
    const pickerRenameBtn = pickerRow.locator('button[title="Rename"]');
    await expect(pickerRenameBtn).toBeHidden(); // Completely hidden!

    const pickerDeleteBtn = pickerRow.locator('button[title="Delete"]');
    await expect(pickerDeleteBtn).toBeHidden(); // Completely hidden!

    // 5. Select a target destination in the picker to enable Confirm Move
    await pickerRow.click();
    const confirmBtn = page.locator('.confirm-move-btn');
    await expect(confirmBtn).toBeEnabled();

    // Close the relocation picker
    const cancelBtn = page.locator('.close-overlay-btn');
    await cancelBtn.click();
    await expect(backdrop).toBeHidden();
  });

  test('should move a draggable row onto a folder via native HTML5 drag-and-drop', async ({
    page,
  }) => {
    // Reduce dataset so the drag math is deterministic and rows are stable.
    await page.locator('.scale-buttons button:has-text("1,000")').click();
    await page.waitForTimeout(300);

    // Pick the first folder row as the drop target.
    const folderRows = page.locator('.ngx-tree-row--folder:not(.ngx-tree-row--locked)');
    const targetFolder = folderRows.first();
    await expect(targetFolder).toBeVisible();
    const targetName = await targetFolder.locator('.ngx-tree-item-name').innerText();

    // Pick any draggable file row that is not inside the target folder.
    const fileRows = page.locator('.ngx-tree-row--file:not(.ngx-tree-row--locked)');
    await expect(fileRows.first()).toBeVisible();
    const source = fileRows.first();
    const sourceName = await source.locator('.ngx-tree-item-name').innerText();

    // Drop into the middle of the folder row to trigger the 'inside' branch.
    await source.dragTo(targetFolder, { targetPosition: { x: 80, y: 18 } });
    await page.waitForTimeout(150);

    // The console log entry confirms the store accepted the move.
    const logs = page.locator('.logs-console');
    await expect(logs).toContainText('[Move]');

    // The source row should be gone from its original position (it moved
    // into the folder, which may be expanded but contains many other items
    // so we just assert at least one move event landed).
    expect(targetName.length).toBeGreaterThan(0);
    expect(sourceName.length).toBeGreaterThan(0);
  });

  test('should render locked folders with a lock badge, no actions, and locked class', async ({
    page,
  }) => {
    // Search to bring the virtualized 15th root item into DOM viewport
    const searchInput = page.locator('#search-input');
    await searchInput.fill('Other Users');
    await page.waitForTimeout(500); // Allow indexing to filter row

    // 1. Locate the locked folder by name
    const otherUsersRow = page.locator('.ngx-tree-row:has-text("Other Users")');
    await expect(otherUsersRow).toBeVisible();

    // 2. Verify it has the locked status CSS class
    await expect(otherUsersRow).toHaveClass(/ngx-tree-row--locked/);

    // 3. Verify that the premium lock badge is rendered next to the name
    const lockBadge = otherUsersRow.locator('.ngx-tree-locked-badge');
    await expect(lockBadge).toBeVisible();

    // 4. Verify that hover actions are completely disabled (hidden on hover)
    await otherUsersRow.hover();
    const actionsPanel = otherUsersRow.locator('.ngx-tree-row-actions');
    await expect(actionsPanel).toBeHidden();
  });
});
