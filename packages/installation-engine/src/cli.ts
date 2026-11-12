import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { action, installerInput, result } from './contracts.js';
import { execute } from './engine.js';
import { atomic, privateText } from './files.js';
import { Unavailable } from './unavailable.js';

let input: ReturnType<typeof installerInput.parse> | undefined;
try {
  if (process.argv.length < 4 || process.argv.length > 5)
    throw new Error('One private operator input is required');
  const selected = action.parse(process.argv[2]);
  const path = process.argv[3];
  if (!path) throw new Error('Private input required');
  input = installerInput.parse(JSON.parse(privateText(path, 32768)));
  const command = process.argv[4],
    control = command ? JSON.parse(privateText(command, 32768)) : undefined;
  if (command) process.env.THAAREI_INSTALLER_COMMAND_REFERENCE = command;
  const output = result.parse(await execute(input, selected, control));
  console.log(JSON.stringify(output));
  process.exitCode =
    output.state === 'complete'
      ? 0
      : output.state === 'waiting'
        ? 10
        : output.state === 'conflict'
          ? 20
          : 30;
} catch (error) {
  const target = input ? join(input.directory, '.installer', 'last-error.log') : null;
  if (target && existsSync(join(input?.directory ?? '', '.installer')))
    try {
      atomic(target, String(error instanceof Error ? error.stack : error));
    } catch {}
  const unavailable =
    error instanceof Unavailable ||
    (error instanceof TypeError && error.message === 'fetch failed') ||
    (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name));
  console.log(
    JSON.stringify({
      version: 1,
      state: unavailable ? 'unavailable' : 'conflict',
      nextActor: 'operator',
      conditions: [
        unavailable
          ? 'resume-retained-operation-after-service-recovery'
          : 'private-installer-reconciliation-required',
      ],
    }),
  );
  process.exitCode = unavailable ? 30 : 20;
}
