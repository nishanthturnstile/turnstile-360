import { AsyncLocalStorage } from 'node:async_hooks';

// Only the private operator command enters this context. No request header can enable it.
const operator = new AsyncLocalStorage<{ clientId: string }>();

export function withOAuthOperator<T>(clientId: string, operation: () => Promise<T>) {
  return operator.run({ clientId }, operation);
}

export function isOAuthOperator() {
  return operator.getStore() !== undefined;
}

export function managedClientId() {
  const context = operator.getStore();
  if (!context) throw new Error('Client creation requires the private operator command');
  return context.clientId;
}
