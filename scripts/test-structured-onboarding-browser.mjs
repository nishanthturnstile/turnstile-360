import assert from 'node:assert/strict';

// A separate fresh installation reuses the owning HTTPS/auth fixture. Completion
// is never reset to manufacture a second first-unit journey in one installation.
export async function testStructuredOnboarding({
  page,
  origin,
  login,
  restartProduct,
  setFault,
  clearRateLimits,
  activateFeature,
}) {
  const heading = (name) => page.getByRole('heading', { name, exact: true }).waitFor();
  const read = () =>
    page.evaluate(async () => {
      const paths = ['/api/organization', '/api/organization/units', '/api/setup'];
      const values = await Promise.all(
        paths.map(async (path) => {
          const response = await fetch(path, { cache: 'no-store' });
          if (!response.ok) throw new Error('Saved configuration read failed');
          return response.json();
        }),
      );
      return { profile: values[0], structure: values[1], setup: values[2] };
    });
  await login('member');
  await heading('Tell us about your organization');
  assert.equal(await page.getByLabel('Time zone', { exact: true }).inputValue(), 'Asia/Kolkata');
  assert.equal((await read()).profile.organization.timeZone, null);
  assert.equal(await page.locator('.workspace').count(), 0);
  await page
    .getByLabel('Organization name', { exact: true })
    .fill('Structured fixture organization');
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await heading('First unit');
  const profile = await read();
  assert.equal(profile.profile.organization.timeZone, 'Asia/Kolkata');
  assert.equal(profile.setup.nextStep, 'structure');
  assert.equal(profile.structure.units.length, 1);
  assert.equal(await page.getByLabel('Parent', { exact: true }).count(), 0);
  assert.equal(
    await page.getByRole('button', { name: 'Continue to review', exact: true }).isDisabled(),
    true,
  );
  await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
  await heading('Setup saved for later');
  assert.deepEqual(await read(), profile);
  await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
  await heading('First unit');
  await page.getByLabel('Unit type', { exact: true }).selectOption('department');
  await page.getByLabel('Unit name', { exact: true }).fill('Operations');
  await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
  await heading('Setup saved for later');
  await restartProduct();
  await page.reload();
  await heading('Setup saved for later');
  await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
  await heading('Ready to open your workspace?');
  let before = await read();
  // Separate expanded fixture phases within the real authority's request window.
  await clearRateLimits();
  assert.equal(before.setup.state, 'in_progress');
  assert.equal(before.setup.nextStep, 'review');
  assert.equal(before.structure.units.length, 2);
  const root = before.profile.organization.rootId;
  const first = before.structure.units.find((unit) => unit.type === 'department');
  assert.equal(first.name, 'Operations');
  assert.equal(first.parentId, root);
  assert.deepEqual(first.ancestorIds, [root]);
  await page.getByRole('link', { name: 'Edit first unit', exact: true }).click();
  await heading('First unit');
  await page
    .locator(`[data-unit-row="${first.id}"]`)
    .getByRole('button', { name: /^Details for / })
    .click();
  await page.getByRole('button', { name: /^Rename Operations / }).click();
  await heading('Rename unit');
  await page.getByLabel('New unit name', { exact: true }).fill('Operations team');
  await page.getByRole('button', { name: 'Save unit name', exact: true }).click();
  await page.getByText('Unit name saved.', { exact: true }).waitFor();
  before = await read();
  assert.equal(before.structure.units.find((unit) => unit.id === first.id).name, 'Operations team');
  await page.getByRole('button', { name: 'Add a unit', exact: true }).click();
  await page.getByLabel('Unit name', { exact: true }).fill('Unsent additional unit');
  const blocked = page.waitForEvent('dialog');
  const back = page.goBack();
  await (await blocked).dismiss();
  await back;
  assert.equal(
    await page.getByLabel('Unit name', { exact: true }).inputValue(),
    'Unsent additional unit',
  );
  page.once('dialog', (dialog) => dialog.accept());
  await page.goBack();
  await heading('Ready to open your workspace?');
  await page.goForward();
  await heading('First unit');
  assert.equal(await page.getByLabel('Unit name', { exact: true }).inputValue(), '');
  assert.deepEqual(await read(), before);
  await page.getByRole('link', { name: 'Continue to review', exact: true }).click();
  await heading('Ready to open your workspace?');
  await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
  await heading('Welcome, member.');
  const activated = await read();
  assert.equal(activated.setup.state, 'completed');
  assert.ok(activated.setup.completion);
  assert.equal(activated.profile.revision, before.profile.revision + 1);
  assert.deepEqual(activated.structure.units, before.structure.units);
  await clearRateLimits();

  try {
    setFault('dms');
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page
      .getByText(
        'The document service is temporarily unavailable. Your sign-in is still active. Try again later.',
        { exact: true },
      )
      .waitFor();
    assert.deepEqual(await read(), activated);
    await page.reload();
    await heading('Welcome, member.');
  } finally {
    setFault('none');
  }
  await restartProduct();
  await activateFeature();
  await page.goto(`${origin}/settings/organization/structure`);
  await heading('Structure');
  assert.equal(new URL(page.url()).pathname, '/structure');
  const list = page.getByRole('list', { name: 'Available organization units' });
  await list.getByText('Operations team', { exact: true }).waitFor();
  assert.deepEqual(await read(), activated);
  async function create(name) {
    await page.getByLabel('Unit name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Review new unit', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm and save', exact: true }).click();
    await list.getByText(name, { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'Add site', exact: true }).click();
  await create('North office');
  await page
    .getByRole('button', {
      name: 'View Structured fixture organization / North office',
      exact: true,
    })
    .click();
  await page.getByRole('button', { name: 'Add department', exact: true }).click();
  await create('Engineering');
  const ongoing = await read();
  const site = ongoing.structure.units.find((unit) => unit.type === 'site');
  const nested = ongoing.structure.units.find((unit) => unit.name === 'Engineering');
  assert.deepEqual(nested.ancestorIds, [root, site.id]);
  assert.equal(nested.parentId, site.id);
  assert.deepEqual(ongoing.setup.completion, activated.setup.completion);
  console.log(
    'Structured onboarding browser journey passed: fresh required Department, explicitly confirmed India suggestion, saved-unit resume after restart, Back/Forward dirty protection, preserved completion/session during DMS outage, owning administrator handover and ongoing nested units in canonical Structure.',
  );
}
