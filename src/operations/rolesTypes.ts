import { Name, Value, IfExistsOption } from './generalTypes'

export interface RoleOptions {
  superuser?: boolean
  createdb?: boolean
  createrole?: boolean
  inherit?: boolean
  login?: boolean
  replication?: boolean
  bypassrls?: boolean
  limit?: number
  password?: Value
  encrypted?: boolean
  valid?: Value
  inRole?: string | string[]
  role?: string | string[]
  admin?: string | string[]
}

type CreateRoleFn = (roleName: Name, roleOptions?: RoleOptions) => string | string[]
export type CreateRole = CreateRoleFn & { reverse: CreateRoleFn }
export type DropRole = (roleName: Name, options?: IfExistsOption) => string | string[]
export type AlterRole = (roleName: Name, roleOptions: RoleOptions) => string | string[]
type RenameRoleFn = (oldRoleName: Name, newRoleName: Name) => string | string[]
export type RenameRole = RenameRoleFn & { reverse: RenameRoleFn }
