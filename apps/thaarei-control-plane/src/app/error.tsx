'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main>
      <p className="eyebrow">THAAREI CONTROL PLANE</p>
      <h1>We couldn’t load this page</h1>
      <p>
        Try loading it again. If a change was already submitted, review the current saved record
        before creating another request.
      </p>
      <button type="button" onClick={reset}>
        Try again
      </button>
      <a className="button secondary" href="/">
        Return to workspace
      </a>
    </main>
  );
}
