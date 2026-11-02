import assert from 'node:assert/strict';

// A separate fresh installation reuses the owning HTTPS/auth fixture. Completion
// is never reset to manufacture a second onboarding path in the same installation.
export async function testStructuredOnboarding({ page, origin, login, restartProduct, setFault }) {
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
  await page
    .getByLabel('Organization name', { exact: true })
    .fill('Structured fixture organization');
  await page.getByLabel('Time zone', { exact: true }).selectOption('UTC');
  await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
  await heading('Add structure, if you need it');
  const list = page.getByRole('list', { name: 'Saved units' });
  async function create(name) {
    await page.getByLabel('Unit name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Add unit', exact: true }).click();
    await list.getByText(name, { exact: true }).waitFor();
  }
  await create('North office');
  await page.getByLabel('Unit type', { exact: true }).selectOption('department');
  await page.getByLabel('Parent', { exact: true }).selectOption({
    label: 'Structured fixture organization / North office',
  });
  await create('Operations');
  await page.getByRole('link', { name: 'Continue to review', exact: true }).click();
  await heading('Ready to open your workspace?');
  await page.getByText(/2 optional sites or departments saved/).waitFor();
  const before = await read();
  assert.equal(before.setup.state, 'in_progress');
  assert.equal(before.setup.nextStep, 'review');
  assert.equal(before.structure.units.length, 3);
  const root = before.profile.organization.rootId;
  const site = before.structure.units.find((unit) => unit.type === 'site');
  const department = before.structure.units.find((unit) => unit.type === 'department');
  assert.equal(site.parentId, root);
  assert.equal(department.parentId, site.id);
  assert.deepEqual(department.ancestorIds, [root, site.id]);
  await page.getByRole('button', { name: 'Activate workspace', exact: true }).click();
  await heading('Welcome, member.');
  const activated = await read();
  assert.equal(activated.setup.state, 'completed');
  assert.ok(activated.setup.completion);
  assert.equal(activated.profile.revision, before.profile.revision + 1);
  assert.deepEqual(activated.structure.units, before.structure.units);

  try {
    setFault('dms');
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page
      .getByText(
        'The document service is temporarily unavailable. Your sign-in is still active. Try again later.',
        { exact: true },
      )
      .waitFor();
    const unavailable = await read();
    assert.deepEqual(unavailable, activated);
    await page.reload();
    await heading('Welcome, member.');
  } finally {
    setFault('none');
  }
  await restartProduct();
  await page.goto(`${origin}/settings/organization/structure`);
  await heading('Organization structure');
  await list.getByText('North office', { exact: true }).waitFor();
  await list.getByText('Operations', { exact: true }).waitFor();
  assert.deepEqual(await read(), activated);
  console.log(
    'Structured onboarding browser journey passed: fresh root/site/nested department, retained units on activation, DMS outage preserves completion/session, and canonical Settings after API restart.',
  );
}
