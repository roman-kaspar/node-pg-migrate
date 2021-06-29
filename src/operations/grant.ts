import { MigrationOptions } from '../types'
import { Grant, Revoke } from './grantTypes'

export function revoke(mOptions: MigrationOptions) {
  const _revoke: Revoke = (privilege, tableName, roleName) => {
    const tableNameStr = mOptions.literal(tableName)
    const roleNameStr = mOptions.literal(roleName)
    return `REVOKE ${privilege} ON ${tableNameStr} FROM ${roleNameStr}`
  }
  return _revoke
}

export function grant(mOptions: MigrationOptions) {
  const _grant: Grant = (privilege, tableName, roleName) => {
    const tableNameStr = mOptions.literal(tableName)
    const roleNameStr = mOptions.literal(roleName)
    return `GRANT ${privilege} ON ${tableNameStr} TO ${roleNameStr}`
  }
  _grant.reverse = revoke(mOptions)
  return _grant
}
