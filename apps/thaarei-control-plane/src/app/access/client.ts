'use client';
export async function request(path: string, input?: unknown, method = 'POST') {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(typeof data.error === 'string' ? data.error : 'Unable to complete request');
  return data;
}
