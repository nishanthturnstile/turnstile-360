import { startReporter } from './modules/deployment/reporter.js';

const stop = startReporter();
// Keep the dedicated worker alive; reporter timers themselves do not block shutdown.
const keepAlive = setInterval(() => {}, 60000);
let stopping = false;
const close = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(keepAlive);
  await stop();
};
process.on('SIGTERM', () => void close());
process.on('SIGINT', () => void close());
