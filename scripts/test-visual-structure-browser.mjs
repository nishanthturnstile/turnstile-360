import assert from 'node:assert/strict';

// Runs only inside the disposable production-profile HTTPS/authority fixture.
export async function testVisualStructure({ page, context, origin, login, clearRateLimits }) {
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor();
  const saved = () =>
    page.evaluate(async () => await (await fetch('/api/organization/units')).json());
  const row = (id) => page.locator(`[data-unit-row="${id}"]`);
  const action = (id, prefix) => row(id).getByRole('button', { name: new RegExp(`^${prefix} `) });
  async function collapseTools() {
    const collapse = page.getByRole('button', { name: 'Collapse structure tools', exact: true });
    if (await collapse.isVisible()) await collapse.click();
  }
  async function selectUnit(id) {
    await collapseTools();
    await action(id, 'Details for').click();
  }
  async function unitAction(id, prefix) {
    await selectUnit(id);
    return page
      .getByRole('complementary', { name: 'Unit details and actions' })
      .getByRole('button', { name: new RegExp(`^${prefix} `) });
  }
  try {
    await login('member');
    await heading('Tell us about your organization');
    await page.getByLabel('Organization name', { exact: true }).fill('Visual fixture');
    // Another manager confirms a zone while this form still has the untouched India suggestion.
    assert.equal(await page.getByLabel('Time zone', { exact: true }).inputValue(), 'Asia/Kolkata');
    const concurrentZone = await page.evaluate(async () => {
      const session = await (await fetch('/api/auth/session')).json();
      return (
        await fetch('/api/organization', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
          body: JSON.stringify({ expectedRevision: 0, timeZone: 'UTC' }),
        })
      ).status;
    });
    assert.equal(concurrentZone, 200);
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await page.getByText(/Saved setup has changed/).waitFor();
    await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
    await page.getByText(/Latest saved data loaded\. Your entries are kept/).waitFor();
    assert.equal(await page.getByLabel('Time zone', { exact: true }).inputValue(), 'UTC');
    assert.equal(
      await page.getByLabel('Organization name', { exact: true }).inputValue(),
      'Visual fixture',
    );
    await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
    await heading('Setup saved for later');
    await page.getByText('UTC', { exact: true }).waitFor();
    await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
    await heading('First unit');
    async function create(name, parent, type = 'department') {
      if (parent) {
        await collapseTools();
        await row(parent)
          .getByRole('button', { name: /^Add (first unit )?below / })
          .click();
      }
      await page.getByLabel('Unit type', { exact: true }).selectOption(type);
      await page.getByLabel('Unit name', { exact: true }).fill(name);
      if (name === 'Alpha') {
        await page.getByRole('button', { name: 'Collapse structure tools', exact: true }).click();
        assert.equal(await page.getByLabel('Unit name', { exact: true }).isVisible(), false);
        await page.getByRole('button', { name: 'Expand structure tools', exact: true }).click();
        assert.equal(await page.getByLabel('Unit name', { exact: true }).inputValue(), name);
      }
      await page.getByRole('button', { name: 'Add unit', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Request confirmed.' }).waitFor();
      const value = await saved();
      return value.units.find((unit) => unit.name === name && (!parent || unit.parentId === parent))
        .id;
    }
    const root = (await saved()).units[0].id;
    const source = await create('Alpha', root);
    const leaf = await create('Leaf', source);
    const target = await create('Beta', root, 'site');
    const duplicate = await create('Leaf', target);
    await clearRateLimits();
    // A committed rename that stops matching the filter must keep its recovery editor reachable.
    await page.getByLabel('Search structure', { exact: true }).fill('Alpha');
    await (await unitAction(source, 'Rename')).click();
    await page.getByLabel('New unit name', { exact: true }).fill('Gamma');
    let releaseRename;
    let renameReached;
    const heldRename = new Promise((resolve) => {
      releaseRename = resolve;
    });
    const committedRename = new Promise((resolve) => {
      renameReached = resolve;
    });
    const lostRename = async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace('auth.fixture.test', '127.0.0.1'),
        headers: { ...route.request().headers(), host: new URL(origin).host },
        maxRetries: 0,
      });
      assert.equal(response.status(), 200);
      renameReached();
      await heldRename;
      await route.abort('failed');
    };
    await page.route(`**/api/organization/units/${source}`, lostRename);
    await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
    await committedRename;
    await page.getByRole('button', { name: 'Collapse structure tools', exact: true }).click();
    releaseRename();
    await page.getByText(/We couldn’t confirm this change/).waitFor();
    assert.equal(
      await page
        .getByRole('button', { name: 'Collapse structure tools', exact: true })
        .getAttribute('aria-expanded'),
      'true',
    );
    await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
    await page.getByText(/Latest saved data loaded\. Compare it with your entry/).waitFor();
    assert.equal(await page.getByLabel('New unit name', { exact: true }).inputValue(), 'Gamma');
    assert.equal((await saved()).units.find((unit) => unit.id === source).name, 'Gamma');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.getByLabel('Search structure', { exact: true }).isEnabled(), true);
    assert.equal(await row(source).count(), 0);
    await page.unroute(`**/api/organization/units/${source}`, lostRename);
    await page.getByLabel('Search structure', { exact: true }).fill('');
    await (await unitAction(source, 'Rename')).click();
    await page.getByLabel('New unit name', { exact: true }).fill('Alpha');
    await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
    await page.getByText('Unit name saved.', { exact: true }).waitFor();
    await clearRateLimits();
    await page.getByLabel('Search structure', { exact: true }).fill('Leaf');
    assert.equal(await row(source).count(), 1);
    assert.equal(await row(target).count(), 1);
    assert.equal(await action(source, 'Drag or move').isDisabled(), true);
    assert.notEqual(
      await action(leaf, 'Details for').getAttribute('aria-label'),
      await action(duplicate, 'Details for').getAttribute('aria-label'),
    );
    await page.getByLabel('Search structure', { exact: true }).fill('');
    await selectUnit(leaf);
    await page
      .getByRole('complementary', { name: 'Unit details and actions' })
      .getByRole('heading', { name: 'Leaf', exact: true })
      .waitFor();
    await selectUnit(root);
    await (await unitAction(source, 'Move')).focus();
    await page.keyboard.press('Space');
    await heading('Move unit');
    assert.equal(
      await page
        .getByLabel('Destination', { exact: true })
        .locator(`option[value="${leaf}"]`)
        .isDisabled(),
      true,
    );
    await page.getByLabel('Find destination', { exact: true }).fill('Beta');
    await page.getByLabel('Destination', { exact: true }).selectOption(target);
    await page.getByRole('button', { name: 'Collapse structure tools', exact: true }).click();
    await page.getByRole('button', { name: 'Expand structure tools', exact: true }).click();
    assert.equal(await page.getByLabel('Destination', { exact: true }).inputValue(), target);
    assert.equal((await saved()).units.find((unit) => unit.id === source).parentId, root);
    // Duplicate sibling Leaf cannot move to Beta; the whole source subtree can.
    await page.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await page.getByText('Unit moved. Saved structure updated.', { exact: true }).waitFor();
    assert.deepEqual((await saved()).units.find((unit) => unit.id === leaf).ancestorIds, [
      root,
      target,
      source,
    ]);

    // Lost success is reconciled by a GET, never by replaying the PATCH.
    let writes = 0;
    const lost = async (route) => {
      writes++;
      const response = await route.fetch({
        url: route.request().url().replace('auth.fixture.test', '127.0.0.1'),
        headers: { ...route.request().headers(), host: new URL(origin).host },
        maxRetries: 0,
      });
      assert.equal(response.status(), 200);
      await route.abort('failed');
    };
    await (await unitAction(source, 'Move')).click();
    await heading('Move unit');
    await page.getByLabel('Destination', { exact: true }).selectOption(root);
    await page.route('**/api/organization/units/*/parent', lost);
    await page.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await page.getByText(/the intended destination is kept/).waitFor();
    assert.equal(
      await page.getByRole('button', { name: 'Confirm move', exact: true }).isDisabled(),
      true,
    );
    assert.equal(writes, 1);
    await page.getByRole('button', { name: 'Read saved structure', exact: true }).click();
    await page
      .getByText('Saved destination confirmed. No move was replayed.', { exact: true })
      .waitFor();
    assert.equal(writes, 1);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.unroute('**/api/organization/units/*/parent', lost);
    await clearRateLimits();

    // A real concurrent revision change preserves the chosen destination until readback.
    await (await unitAction(source, 'Move')).click();
    await heading('Move unit');
    await page.getByLabel('Destination', { exact: true }).selectOption(target);
    const changed = await page.evaluate(async (id) => {
      const current = await (await fetch('/api/organization/units')).json();
      const session = await (await fetch('/api/auth/session')).json();
      return (
        await fetch(`/api/organization/units/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken },
          body: JSON.stringify({ expectedRevision: current.revision, name: 'Beta updated' }),
        })
      ).status;
    }, target);
    assert.equal(changed, 200);
    await page.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await page.getByText(/the intended destination is kept/).waitFor();
    assert.equal(await page.getByLabel('Destination', { exact: true }).inputValue(), target);
    await page.getByRole('button', { name: 'Read saved structure', exact: true }).click();
    await page.getByText(/Compare the paths/).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();

    assert.equal(await page.locator('.structure-connections path').count(), 4);
    // Navigation changes only the camera; cards keep canonical positions and no write occurs.
    await collapseTools();
    await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
    const chartRegion = page.getByRole('region', { name: 'Organization chart', exact: true });
    const chartBounds = await chartRegion.boundingBox();
    assert.ok(chartBounds);
    const camera = () =>
      page.locator('.structure-camera-layer').evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return { x: matrix.e, y: matrix.f, zoom: matrix.a };
      });
    const navigationBefore = await saved();
    let navigationWrites = 0;
    const watchNavigation = (request) => {
      if (
        /\/api\/organization\/units/.test(request.url()) &&
        ['POST', 'PATCH', 'DELETE'].includes(request.method())
      )
        navigationWrites += 1;
    };
    page.on('request', watchNavigation);
    let beforeCamera = await camera();
    const blank = { x: chartBounds.x + 5, y: chartBounds.y + 170 };
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x + 84, blank.y + 45, { steps: 8 });
    await page.mouse.up();
    let afterCamera = await camera();
    assert.ok(Math.abs(afterCamera.x - beforeCamera.x - 84) < 1);
    assert.ok(Math.abs(afterCamera.y - beforeCamera.y - 45) < 1);
    assert.equal(afterCamera.zoom, beforeCamera.zoom);
    assert.equal(await chartRegion.getAttribute('data-panning'), null);

    await page.getByRole('button', { name: 'Hand tool', exact: true }).click();
    beforeCamera = await camera();
    const rootCard = await row(root).boundingBox();
    assert.ok(rootCard);
    await page.mouse.move(rootCard.x + 24, rootCard.y + rootCard.height / 2);
    await page.mouse.down();
    await page.mouse.move(rootCard.x + 84, rootCard.y + rootCard.height / 2 - 20, { steps: 8 });
    await page.mouse.up();
    afterCamera = await camera();
    assert.ok(Math.abs(afterCamera.x - beforeCamera.x - 60) < 1);
    assert.equal(
      await page.getByRole('button', { name: 'Expand structure tools', exact: true }).isVisible(),
      true,
    );
    await page.getByRole('button', { name: 'Hand tool', exact: true }).click();

    // Wheel pan and pointer-anchored zoom must not be followed by selection recentering.
    beforeCamera = await camera();
    const anchor = { x: 120, y: 140 };
    await page.mouse.move(chartBounds.x + anchor.x, chartBounds.y + anchor.y);
    await page.mouse.wheel(40, -30);
    await page.waitForFunction(
      (x) =>
        Math.abs(
          new DOMMatrixReadOnly(
            getComputedStyle(document.querySelector('.structure-camera-layer')).transform,
          ).e - x,
        ) < 1,
      beforeCamera.x - 40,
    );
    afterCamera = await camera();
    assert.ok(Math.abs(afterCamera.y - beforeCamera.y - 30) < 1);
    beforeCamera = afterCamera;
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -1000);
    await page.keyboard.up('Control');
    await page.waitForFunction(
      (zoom) =>
        new DOMMatrixReadOnly(
          getComputedStyle(document.querySelector('.structure-camera-layer')).transform,
        ).a > zoom,
      beforeCamera.zoom,
    );
    afterCamera = await camera();
    assert.ok(Math.abs(afterCamera.zoom - beforeCamera.zoom - 0.1) < 0.00001);
    assert.ok(
      Math.abs(
        (anchor.x - beforeCamera.x) / beforeCamera.zoom -
          (anchor.x - afterCamera.x) / afterCamera.zoom,
      ) < 1,
    );
    assert.ok(
      Math.abs(
        (anchor.y - beforeCamera.y) / beforeCamera.zoom -
          (anchor.y - afterCamera.y) / afterCamera.zoom,
      ) < 1,
    );
    beforeCamera = afterCamera;
    await page.keyboard.down('Meta');
    await page.mouse.wheel(0, 120);
    await page.keyboard.up('Meta');
    await page.waitForFunction(
      (zoom) =>
        new DOMMatrixReadOnly(
          getComputedStyle(document.querySelector('.structure-camera-layer')).transform,
        ).a < zoom,
      beforeCamera.zoom,
    );
    assert.ok(Math.abs((await camera()).zoom - beforeCamera.zoom + 0.1) < 0.00001);
    beforeCamera = await camera();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    assert.ok(Math.abs((await camera()).zoom - beforeCamera.zoom - 0.1) < 0.00001);
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    assert.ok(Math.abs((await camera()).zoom - beforeCamera.zoom) < 0.00001);
    await chartRegion.focus();
    beforeCamera = await camera();
    await page.keyboard.press('ArrowRight');
    assert.ok(Math.abs((await camera()).x - beforeCamera.x + 60) < 1);
    await page.keyboard.press('+');
    assert.ok(Math.abs((await camera()).zoom - beforeCamera.zoom - 0.1) < 0.00001);
    await page.keyboard.press('0');
    assert.equal((await camera()).zoom, 1);
    await page.keyboard.press('Home');
    await page.keyboard.down('Space');
    const spaceCard = await row(root).boundingBox();
    assert.ok(spaceCard);
    beforeCamera = await camera();
    await page.mouse.move(spaceCard.x + 24, spaceCard.y + spaceCard.height / 2);
    await page.mouse.down();
    await page.mouse.move(spaceCard.x + 54, spaceCard.y + spaceCard.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    assert.ok(Math.abs((await camera()).x - beforeCamera.x - 30) < 1);
    assert.equal(await chartRegion.getAttribute('data-hand'), null);
    await page.mouse.move(blank.x, blank.y);
    await page.mouse.down();
    await page.mouse.move(blank.x + 20, blank.y + 20, { steps: 4 });
    await page.keyboard.press('Escape');
    beforeCamera = await camera();
    await page.mouse.move(blank.x + 60, blank.y + 60, { steps: 4 });
    await page.mouse.up();
    assert.deepEqual(await camera(), beforeCamera);
    await page.keyboard.press('Home');

    const navigationTouch = await context.newCDPSession(page);
    beforeCamera = await camera();
    await navigationTouch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { id: 0, x: chartBounds.x + 12, y: chartBounds.y + 30 },
        { id: 1, x: chartBounds.x + 120, y: chartBounds.y + 30 },
      ],
    });
    await navigationTouch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { id: 0, x: chartBounds.x + 8, y: chartBounds.y + 30 },
        { id: 1, x: chartBounds.x + 170, y: chartBounds.y + 30 },
      ],
    });
    await navigationTouch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok((await camera()).zoom > beforeCamera.zoom);
    assert.equal(await chartRegion.getAttribute('data-panning'), null);
    await navigationTouch.detach();
    assert.deepEqual(await saved(), navigationBefore);
    assert.equal(navigationWrites, 0);
    page.off('request', watchNavigation);
    await page.getByRole('button', { name: 'Expand structure tools', exact: true }).click();
    // An empty filtered result remains visible/clickable after a camera gesture.
    await page.getByLabel('Search structure', { exact: true }).fill('no matching fixture');
    await page.getByText('No matching units', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    assert.equal(await page.getByLabel('Search structure', { exact: true }).inputValue(), '');
    await row(root).waitFor();
    const zoom = page.getByRole('status', { name: 'Zoom level' });
    const initialZoom = Number.parseFloat(await zoom.textContent());
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
    assert.ok(Number.parseFloat(await zoom.textContent()) < initialZoom);
    await page.getByRole('button', { name: 'Fit chart', exact: true }).click();
    const chart = await page
      .getByRole('region', { name: 'Organization chart', exact: true })
      .boundingBox();
    assert.ok(chart);
    for (const unit of (await saved()).units) {
      const card = await row(unit.id).boundingBox();
      assert.ok(
        card &&
          card.x >= chart.x &&
          card.y >= chart.y &&
          card.x + card.width <= chart.x + chart.width &&
          card.y + card.height <= chart.y + chart.height,
      );
    }
    await page.getByLabel('Structure view', { exact: true }).selectOption('outline');
    await selectUnit(root);
    await page.getByRole('button', { name: 'Collapse structure tools', exact: true }).click();
    await page.getByRole('region', { name: 'Organization outline', exact: true }).waitFor();
    // The outline stays dense and keeps counts/actions aligned across hierarchy depths.
    const outlineRows = await page.locator('[data-unit-row]').evaluateAll((elements) =>
      elements.map((element) => {
        const rect = (selector) => element.querySelector(selector).getBoundingClientRect();
        const add = rect('button[aria-label^="Add "]');
        const move = element.querySelector('button[aria-label^="Drag or move "]');
        return {
          id: element.dataset.unitRow,
          height: element.getBoundingClientRect().height,
          name: rect('.structure-outline-name').x,
          count: rect('.structure-outline-count').x,
          add: { x: add.x, y: add.y },
          move: move
            ? { x: move.getBoundingClientRect().x, y: move.getBoundingClientRect().y }
            : null,
        };
      }),
    );
    assert.ok(outlineRows.every((item) => item.height >= 48 && item.height <= 56));
    assert.ok(outlineRows.every((item) => Math.abs(item.count - outlineRows[0].count) < 1));
    assert.ok(
      outlineRows.every(
        (item) =>
          !item.move || (item.move.x > item.add.x && Math.abs(item.move.y - item.add.y) < 1),
      ),
    );
    assert.ok(
      outlineRows.find((item) => item.id === source).name >
        outlineRows.find((item) => item.id === root).name,
    );
    assert.ok(
      outlineRows.find((item) => item.id === leaf).name >
        outlineRows.find((item) => item.id === source).name,
    );
    await page.screenshot({ path: '/tmp/turnstile-outline-desktop.png', fullPage: true });
    // Collapse child branches so both pointer targets fit the bounded native pane.
    for (const id of [source, target]) {
      const collapse = row(id).getByRole('button', { name: /^Collapse / });
      if (await collapse.count()) await collapse.click();
    }
    async function points() {
      const handle = action(source, 'Drag or move');
      await handle.scrollIntoViewIfNeeded();
      const from = await handle.boundingBox();
      const to = await row(target).boundingBox();
      assert.ok(from && to);
      return {
        from: { x: from.x + from.width / 2, y: from.y + from.height / 2 },
        to: { x: to.x + to.width / 2, y: to.y + 24 },
      };
    }
    let point = await points();
    await page.mouse.move(point.from.x, point.from.y);
    await page.mouse.down();
    await page.mouse.move(point.to.x, point.to.y, { steps: 8 });
    assert.equal(await row(target).getAttribute('data-drop'), 'valid');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.equal(await page.locator('[data-slot="move-editor"]').count(), 0);
    point = await points();
    await page.mouse.move(point.from.x, point.from.y);
    await page.mouse.down();
    await page.mouse.move(point.to.x, point.to.y, { steps: 8 });
    await page.mouse.up();
    await heading('Move unit');
    assert.equal((await saved()).units.find((unit) => unit.id === source).parentId, root);
    await page.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await page.getByText('Unit moved. Saved structure updated.', { exact: true }).waitFor();
    await clearRateLimits();

    await page.getByRole('button', { name: 'Collapse structure tools', exact: true }).click();
    // Chromium emits real touch Pointer Events from these native touch contacts.
    const cdp = await context.newCDPSession(page);
    const handle = action(source, 'Drag or move');
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const to = await row(root).boundingBox();
    assert.ok(from && to);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: to.x + to.width / 2, y: to.y + 24 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await heading('Move unit');
    await page.getByRole('button', { name: 'Confirm move', exact: true }).click();
    await page.getByText('Unit moved. Saved structure updated.', { exact: true }).waitFor();
    await cdp.detach();
    const final = await saved();
    assert.equal(final.units.find((unit) => unit.id === source).parentId, root);
    assert.equal(final.units.length, 5);
    await page.setViewportSize({ width: 320, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await collapseTools();
    await action(source, 'Details for').focus();
    await page.keyboard.press('Enter');
    await page
      .getByRole('complementary', { name: 'Unit details and actions' })
      .getByRole('heading', { name: 'Alpha', exact: true })
      .waitFor();
    await collapseTools();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    await page.evaluate(() => {
      document.querySelector('[aria-label="Setup content"]').scrollTop = 0;
      document.querySelector('.structure-tree').scrollTop = 0;
    });
    await page.screenshot({ path: '/tmp/turnstile-rd06-editor-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.screenshot({ path: '/tmp/turnstile-rd06-editor-desktop.png', fullPage: true });
    await page.getByRole('link', { name: 'Continue to review', exact: true }).click();
    await heading('Ready to open your workspace?');
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
    await heading('Welcome, member.');
    await page.goto(`${origin}/settings/organization/structure`);
    await heading('Organization structure');
    assert.deepEqual((await saved()).units, final.units);
    console.log(
      'Visual structure browser passed: concurrent saved-zone reconciliation, filtered lost-rename recovery, shared setup/Settings, contextual create, search ancestry, dense aligned outline/keyboard details, retained drafts/recovery, whiteboard blank/Hand/Space pan, wheel pan, anchored zoom, keyboard reset/Fit, Escape cancellation, real touch pinch with zero navigation writes, confirmed keyboard/pointer/touch unit moves and narrow/reduced-motion layout.',
    );
  } catch (error) {
    console.error(
      'Visual editor failure location:',
      error instanceof Error
        ? error.stack?.match(/test-visual-structure-browser\.mjs:\d+:\d+/g)
        : 'unknown',
    );
    await page.screenshot({ path: '/tmp/turnstile-rd06-editor-failure.png' });
    throw error;
  }
}
