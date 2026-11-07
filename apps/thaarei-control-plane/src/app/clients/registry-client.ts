'use client';
import type { RegistryCommand } from '../../contracts/registry.ts';
import { clientDetail, clientList, receipt } from '../../contracts/registry.ts';
import { request } from '../access/client.ts';
export async function sendCommand(command: RegistryCommand) {
  return receipt.parse(await request('/api/registry', command));
}
export async function readClient(id: string) {
  return clientDetail.parse(await request(`/api/registry/clients/${id}`, undefined, 'GET'));
}
export async function readClients(query: URLSearchParams) {
  return clientList.parse(await request(`/api/registry/clients?${query}`, undefined, 'GET'));
}
export function nullable(value: FormDataEntryValue | null) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
export function date(value: string | null) {
  return value === null
    ? 'Not recorded'
    : `${new Date(value).toLocaleString('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      })} UTC`;
}
