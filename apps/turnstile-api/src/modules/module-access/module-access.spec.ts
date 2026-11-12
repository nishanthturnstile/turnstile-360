import { describe, expect, it } from 'vitest';
import { locallyEnabledIds } from './module-access.service.js';

describe('local module reductions', () => {
  it('removes disabled modules and transitive dependants without expanding signed authority', () => {
    const definitions = [
      { id: 'foundation', requires: [] },
      { id: 'risk-management', requires: ['foundation'] },
      { id: 'incident-management', requires: ['risk-management'] },
    ];
    expect([
      ...locallyEnabledIds(['foundation', 'risk-management', 'incident-management'], definitions, [
        'risk-management',
      ]),
    ]).toEqual(['foundation']);
    expect([...locallyEnabledIds(['foundation'], definitions, [])]).toEqual(['foundation']);
  });
});
