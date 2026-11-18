export function resetEntry(search: string) {
  const query = new URLSearchParams(search);
  if (query.get('flow') !== 'reset') return undefined;
  const token = query.get('token');
  if (query.has('error') || !token || token.length > 1024)
    return {
      mode: 'forgot' as const,
      token: '',
      message: 'This reset link is invalid or has expired. Request a new password reset email.',
    };
  return { mode: 'reset' as const, token, message: '' };
}
