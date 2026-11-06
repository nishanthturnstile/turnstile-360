// Filename is presentation metadata only; every storage key remains a server UUID.
export function downloadName(value: string) {
  let name =
    Buffer.from(value, 'utf8')
      .toString('utf8')
      .normalize('NFC')
      .replace(/[\p{Cc}\p{Cf}/\\]/gu, '_')
      .replace(/^\.+|[. ]+$/g, '') || 'download';
  // Bound the double-encoded signed query while retaining whole Unicode code points.
  const points = Array.from(name);
  while (Buffer.byteLength(name, 'utf8') > 180) {
    points.pop();
    name = points.join('');
  }
  const ascii = name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 96) || 'download';
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return {
    fileName: name,
    disposition: `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
  };
}
