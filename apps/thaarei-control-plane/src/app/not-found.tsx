export default function NotFound() {
  return (
    <main>
      <p className="eyebrow">THAAREI CONTROL PLANE · 404</p>
      <h1>This record is unavailable</h1>
      <p>
        The address may be incorrect or this record is no longer available. Return to the workspace
        to find the current record.
      </p>
      <a className="button" href="/">
        Open workspace
      </a>
      <a className="button secondary" href="/clients">
        View clients
      </a>
    </main>
  );
}
