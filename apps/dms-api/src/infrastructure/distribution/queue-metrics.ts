let raw = '';
try {
  for await (const part of process.stdin) {
    raw += part;
    if (Buffer.byteLength(raw) > 16384) throw new Error();
  }
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows) || rows.length > 32) throw new Error();
  const counts: Record<string, number> = { scan: 0, extract: 0, heavy: 0 };
  for (const role of ['scan', 'extract', 'heavy']) {
    const row = rows.find((row) => row.name === `document.${role}.dead`);
    if (!row || !Number.isSafeInteger(row.messages) || row.messages < 0) throw new Error();
    counts[role] = row.messages;
  }
  console.log(
    JSON.stringify({
      type: 'broker',
      deadLetters: counts,
      alert: Object.values(counts).some((count) => count > 0) ? 'DEAD_LETTERS' : null,
    }),
  );
} catch {
  console.error('Broker observation unavailable');
  process.exitCode = 1;
}

export {};
