import assert from 'node:assert/strict';

// Runs only inside the disposable production-profile HTTPS/authority fixture.
export async function testVisualStructure({ page, context, origin, login, clearRateLimits }) {
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor();
  const saved = () =>
    page.evaluate(async () => await (await fetch('/api/organization/units')).json());
  const row = (id) => page.locator(`[data-unit-row="${id}"]`);
  const action = (id, prefix) => row(id).getByRole('button', { name: new RegExp(`^${prefix} `) });
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
      if (parent)
        await row(parent)
          .getByRole('button', { name: /^Add (first unit )?below / })
          .click();
      await page.getByLabel('Unit type', { exact: true }).selectOption(type);
      await page.getByLabel('Unit name', { exact: true }).fill(name);
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
    await action(source, 'Rename').click();
    await page.getByLabel('New unit name', { exact: true }).fill('Gamma');
    const lostRename = async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace('auth.fixture.test', '127.0.0.1'),
        headers: { ...route.request().headers(), host: new URL(origin).host },
        maxRetries: 0,
      });
      assert.equal(response.status(), 200);
      await route.abort('failed');
    };
    await page.route(`**/api/organization/units/${source}`, lostRename);
    await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
    await page.getByText(/We couldn’t confirm this change/).waitFor();
    await page.getByRole('button', { name: 'Load latest saved data', exact: true }).click();
    await page.getByText(/Latest saved data loaded\. Compare it with your entry/).waitFor();
    assert.equal(await page.getByLabel('New unit name', { exact: true }).inputValue(), 'Gamma');
    assert.equal((await saved()).units.find((unit) => unit.id === source).name, 'Gamma');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await page.getByLabel('Search structure', { exact: true }).isEnabled(), true);
    assert.equal(await row(source).count(), 0);
    await page.unroute(`**/api/organization/units/${source}`, lostRename);
    await page.getByLabel('Search structure', { exact: true }).fill('');
    await action(source, 'Rename').click();
    await page.getByLabel('New unit name', { exact: true }).fill('Alpha');
    await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
    await page.getByText('Unit name saved.', { exact: true }).waitFor();
    await clearRateLimits();
    await page.getByLabel('Search structure', { exact: true }).fill('Leaf');
    assert.equal(await row(source).count(), 1);
    assert.equal(await row(target).count(), 1);
    assert.equal(await action(source, 'Drag or move').isDisabled(), true);
    assert.notEqual(await row(leaf).textContent(), await row(duplicate).textContent());
    await page.getByLabel('Search structure', { exact: true }).fill('');
    await action(leaf, 'Details for').click();
    await heading('Selected unit');
    await page.getByRole('button', { name: 'Close details', exact: true }).click();
    await action(source, 'Move').focus();
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
    await action(source, 'Move').click();
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
    await action(source, 'Move').click();
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

    await page.getByLabel('Structure view', { exact: true }).selectOption('outline');
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
      'Visual structure browser passed: concurrent saved-zone reconciliation, filtered lost-rename recovery, shared setup/Settings, contextual create, search ancestry, outline/details, keyboard Move to, invalid destinations, lost-response readback, stale revision recovery, pointer cancellation/confirmation, real touch drag and narrow/reduced-motion layout.',
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
