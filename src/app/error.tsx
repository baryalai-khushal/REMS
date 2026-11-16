"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="content"><section className="card narrow"><h1>Workspace unavailable</h1><p>Please try again shortly. If this continues, contact your room admin.</p><button onClick={reset}>Try again</button></section></main>;
}
