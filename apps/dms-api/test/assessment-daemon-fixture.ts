import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
// Explicit online native qualification only. No installed credentials, ports or volumes.
export async function assessmentDaemonFixture() {
  const child = spawn(
    'uv',
    ['run', '--locked', 'python', 'tests/assessment_native.py', '--serve'],
    { cwd: resolve('../dms-processing'), env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  let line = '';
  try {
    const socket = await new Promise<string>((accept, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Native scanner fixture startup deadline')),
        150000,
      );
      child.on('error', () => {
        clearTimeout(timer);
        reject(new Error('Native scanner fixture unavailable'));
      });
      child.on('exit', () => {
        clearTimeout(timer);
        reject(new Error('Native scanner fixture exited'));
      });
      child.stderr.on('data', () => {});
      child.stdout.on('data', (chunk) => {
        line += String(chunk);
        if (line.length > 4096) {
          clearTimeout(timer);
          reject(new Error('Native scanner fixture output limit'));
          return;
        }
        if (!line.includes('\n')) return;
        try {
          const data = JSON.parse(line.split('\n')[0] ?? '');
          if (typeof data.socket !== 'string' || !data.socket.startsWith('/tmp/dms-assessment-'))
            throw new Error();
          clearTimeout(timer);
          accept(data.socket);
        } catch {
          clearTimeout(timer);
          reject(new Error('Native scanner fixture identity rejected'));
        }
      });
    });
    return {
      socket,
      close: async () => {
        child.stdin.end();
        await new Promise<void>((accept) => {
          if (child.exitCode !== null) {
            accept();
            return;
          }
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            accept();
          }, 10000);
          child.once('exit', () => {
            clearTimeout(timer);
            accept();
          });
        });
      },
    };
  } catch (error) {
    child.stdin.end();
    child.kill('SIGTERM');
    throw error;
  }
}
