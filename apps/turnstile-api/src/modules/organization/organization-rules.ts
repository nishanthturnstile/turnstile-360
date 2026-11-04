import {
  CONFIGURATION_LIMITS,
  configurationNameKey,
  type OrganizationUnitDto,
} from '@thaarei/turnstile-contracts';
import { ConfigurationException } from '../../infrastructure/configuration-exception.js';
import {
  type ConfigurationRecord,
  configurationConflict,
  invalidConfiguration,
} from './persistence/organization.repository.js';

export function unitById(units: OrganizationUnitDto[], id: string) {
  const unit = units.find((row) => row.id === id);
  if (!unit) throw new ConfigurationException({ code: 'CONFIGURATION_NOT_FOUND' });
  return unit;
}
function mutable(units: OrganizationUnitDto[], id: string) {
  const unit = unitById(units, id);
  if (unit.type === 'organization') return invalidConfiguration('id', 'unsupported');
  return unit;
}
function siblingName(
  record: ConfigurationRecord,
  units: OrganizationUnitDto[],
  parent: string,
  name: string,
  id?: string,
) {
  if (
    units.some(
      (row) =>
        row.id !== id &&
        row.parentId === parent &&
        configurationNameKey(row.name ?? '') === configurationNameKey(name),
    )
  )
    configurationConflict(record, 'duplicate_name');
}
function required(record: ConfigurationRecord, units: OrganizationUnitDto[], id: string) {
  if (
    record.completed_at &&
    record.requirement_version === 2 &&
    !units.some((row) => row.id !== id && row.parentId === record.root_id)
  )
    configurationConflict(record, 'required_unit');
}
export function validateCreate(
  record: ConfigurationRecord,
  units: OrganizationUnitDto[],
  value: { parentId: string; name: string; type: 'site' | 'department' },
) {
  const parent = units.find((unit) => unit.id === value.parentId);
  if (!parent) return invalidConfiguration('parentId');
  if (value.type === 'site' && parent.type !== 'organization')
    return invalidConfiguration('parentId', 'unsupported');
  if (
    parent.ancestorIds.length + 1 >= CONFIGURATION_LIMITS.depth ||
    units.length >= CONFIGURATION_LIMITS.units
  )
    return invalidConfiguration('parentId', 'limit_reached');
  siblingName(record, units, parent.id, value.name);
}
export function validateRename(
  record: ConfigurationRecord,
  units: OrganizationUnitDto[],
  id: string,
  name: string,
) {
  const unit = mutable(units, id);
  if (unit.name !== name) siblingName(record, units, unit.parentId as string, name, id);
  return unit;
}
export function validateDelete(
  record: ConfigurationRecord,
  units: OrganizationUnitDto[],
  id: string,
) {
  const unit = mutable(units, id);
  if (units.some((row) => row.parentId === id)) configurationConflict(record, 'unit_in_use');
  if (unit.parentId === record.root_id) required(record, units, id);
  return unit;
}
export function validateMove(
  record: ConfigurationRecord,
  units: OrganizationUnitDto[],
  id: string,
  parentId: string,
) {
  const unit = mutable(units, id),
    parent = unitById(units, parentId);
  if (
    parent.id === id ||
    parent.ancestorIds.some((ancestor) => ancestor === id) ||
    (unit.type === 'site' && parent.type !== 'organization')
  )
    return invalidConfiguration('parentId');
  if (unit.parentId === parent.id) return { unit, parent, changed: false };
  const height = Math.max(
    1,
    ...units
      .filter((row) => row.ancestorIds.some((ancestor) => ancestor === id))
      .map((row) => row.ancestorIds.length - unit.ancestorIds.length + 1),
  );
  if (parent.ancestorIds.length + 1 + height > CONFIGURATION_LIMITS.depth)
    return invalidConfiguration('parentId', 'limit_reached');
  siblingName(record, units, parent.id, unit.name ?? '', id);
  if (unit.parentId === record.root_id && parent.id !== record.root_id) required(record, units, id);
  return { unit, parent, changed: true };
}
