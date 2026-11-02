import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import pg from 'pg';
import {
  organizationPatchSchema,
  workspaceStatusSchema,
} from '../packages/turnstile-contracts/dist/index.js';
import { readLocalRelease } from './rehearse-local-onboarding-upgrade.mjs';

let browser;
let pool;
let stage = 'private-input';
try {
  const [directory, passwordFile, name, timeZone, ...extra] = process.argv.slice(2);
  assert.equal(extra.length, 0);
  const env = readLocalRelease(directory);
  assert.equal((await stat(passwordFile)).mode & 0o077, 0);
  const password = await readFile(passwordFile, 'utf8');
  const assignment = JSON.parse(await readFile(resolve(directory, 'manager-access.json'), 'utf8'));
  const profile = organizationPatchSchema.parse({ expectedRevision: 0, name, timeZone });
  pool = new pg.Pool({ connectionString: env.AUTH_DATABASE_URL, max: 1 });
  const account = (
    await pool.query('SELECT email,email_verified,banned FROM auth."user" WHERE id=$1', [
      assignment.userId,
    ])
  ).rows[0];
  assert.ok(account?.email_verified && !account.banned);
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const heading = (text) => page.getByRole('heading', { name: text, exact: true }).waitFor();
  const setup = () =>
    page.evaluate(async () => {
      const response = await fetch('/api/setup', { cache: 'no-store' });
      if (!response.ok) throw new Error('Setup read failed');
      return response.json();
    });
  async function login() {
    await page.goto(`${env.AUTH_PUBLIC_ORIGIN}/api/auth/login`);
    await page.getByLabel('Email address', { exact: true }).fill(account.email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    const submitted = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/identity/sign-in/email',
    );
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const response = await submitted;
    if (!response.ok()) {
      stage = `authority-login-http-${response.status()}`;
      const result = await response.json().catch(() => ({}));
      if (['INVALID_PASSWORD', 'INVALID_EMAIL_OR_PASSWORD'].includes(result.code))
        stage = 'authority-login-credentials-rejected';
      throw new Error('Authority login failed');
    }
    await page
      .getByRole('heading', {
        name: /^(Waiting for setup|Tell us about your organization|Ready to open your workspace\?|Welcome, .*)$/,
      })
      .waitFor();
  }
  function command(args, input) {
    const result = spawnSync(process.execPath, args, {
      env,
      input,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000,
    });
    assert.equal(result.status, 0, 'Private operator command failed');
  }
  stage = 'verified-login-and-early-access';
  await login();
  const status = workspaceStatusSchema.parse(
    await page.evaluate(async () => (await fetch('/api/workspace/status')).json()),
  );
  let ordinaryWaiting = false;
  if (status.status === 'incomplete' && !status.canManageConfiguration) {
    await heading('Waiting for setup');
    ordinaryWaiting = true;
    const denied = await page.evaluate(async () => (await fetch('/api/dms/capabilities')).status);
    assert.equal(denied, 409);
    stage = 'preserving-manager-grant';
    command(
      ['apps/turnstile-api/dist/modules/auth/set-user-access.js'],
      JSON.stringify(assignment),
    );
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page
      .getByRole('heading', {
        name: /Tell us about your organization|Ready to open your workspace\?/,
      })
      .waitFor();
  }
  stage = 'manager-setup';
  const current = workspaceStatusSchema.parse(
    await page.evaluate(async () => (await fetch('/api/workspace/status')).json()),
  );
  let partialSaveRestartResume = false;
  if (current.status !== 'complete') {
    stage = 'organization-navigation';
    await page.goto(`${env.AUTH_PUBLIC_ORIGIN}/onboarding/organization`);
    await heading('Tell us about your organization');
    stage = 'organization-name';
    await page.getByLabel('Organization name', { exact: true }).fill(profile.name);
    stage = 'partial-profile-save';
    await page.getByRole('button', { name: 'Save and exit', exact: true }).click();
    stage = 'partial-profile-readback';
    await heading('Setup saved for later');
    stage = 'saved-progress-through-restart';
    assert.equal(
      spawnSync('docker', ['compose', 'restart', 'turnstile-api'], {
        stdio: 'ignore',
        timeout: 120000,
      }).status,
      0,
    );
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        if (
          (
            await fetch('http://localhost:23602/health/ready/auth', {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          ready = true;
          break;
        }
      } catch {
        /* The compiled process is still restarting. */
      }
      await delay(200);
    }
    assert.ok(ready);
    await page.reload();
    await heading('Setup saved for later');
    await page.getByRole('link', { name: 'Resume setup', exact: true }).click();
    await page
      .getByRole('heading', {
        name: /Tell us about your organization|Ready to open your workspace\?/,
      })
      .waitFor();
    if (await page.getByLabel('Organization name', { exact: true }).count()) {
      assert.equal(
        await page.getByLabel('Organization name', { exact: true }).inputValue(),
        profile.name,
      );
      await page.getByLabel('Time zone', { exact: true }).selectOption(profile.timeZone);
      await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
      await heading('Add structure, if you need it');
      await page.getByRole('link', { name: 'Continue to review', exact: true }).click();
    }
    await heading('Ready to open your workspace?');
    stage = 'activation';
    await page.getByRole('button', { name: 'Activate workspace', exact: true }).click();
    partialSaveRestartResume = true;
  }
  await page.getByRole('heading', { name: /^Welcome, / }).waitFor();
  const completed = await setup();
  assert.equal(completed.state, 'completed');
  stage = 'existing-machine-connection';
  await page.getByRole('button', { name: 'Check connection', exact: true }).click();
  await page
    .getByText('Connected. Document features will appear here when available.', { exact: true })
    .waitFor();
  stage = 'canonical-settings';
  await page.goto(`${env.AUTH_PUBLIC_ORIGIN}/settings`);
  await heading('Setup overview');
  await page.getByText(profile.name, { exact: true }).waitFor();
  await page.getByText(profile.timeZone, { exact: true }).waitFor();
  assert.deepEqual((await setup()).completion, completed.completion);
  const cookie = (await context.cookies()).find((value) => value.name.includes('turnstile'));
  assert.ok(
    cookie?.httpOnly &&
      !cookie.secure &&
      cookie.sameSite === 'Lax' &&
      cookie.domain === 'localhost',
  );
  stage = 'logout-and-account-handover';
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  stage = 'logout-confirmation';
  await heading('You’re signed out');
  stage = 'verified-relogin';
  await login();
  await page.getByRole('heading', { name: /^Welcome, / }).waitFor();
  stage = 'relogin-settings';
  await page.goto(`${env.AUTH_PUBLIC_ORIGIN}/settings`);
  await heading('Setup overview');
  assert.deepEqual((await setup()).completion, completed.completion);
  await writeFile(
    resolve(directory, 'local-verification.json'),
    JSON.stringify({
      at: new Date().toISOString(),
      target: env.AUTH_PUBLIC_ORIGIN,
      ordinaryWaiting,
      partialSaveRestartResume,
      state: 'completed',
      completion: completed.completion,
      localCookiePolicy: 'HTTP host-only HttpOnly SameSite=Lax',
      managerLogin: true,
      settings: true,
      machineConnection: true,
      logoutRelogin: true,
    }),
    { mode: 0o600 },
  );
  console.log(
    `Selected local installation passed: verified login, canonical Settings, machine access, local cookie policy and logout/relogin. Early ordinary waiting observed: ${ordinaryWaiting}; partial save/restart/resume and activation performed: ${partialSaveRestartResume}.`,
  );
} catch {
  console.error(
    `Local onboarding release verification failed (${stage}); inspect saved state before retrying. No password or signed URL diagnostics were recorded.`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close();
  await pool?.end();
}
