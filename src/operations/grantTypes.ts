/** @see [Privileges](https://www.postgresql.org/docs/current/ddl-priv.html) */
export type Privilege =
  | 'SELECT'
  | 'INSERT'
  | 'UPDATE'
  | 'DELETE'
  | 'TRUNCATE'
  | 'REFERENCES'
  | 'TRIGGER'
  | 'CREATE'
  | 'CONNECT'
  | 'TEMPORARY'
  | 'EXECUTE'
  | 'USAGE'
  | 'ALL'
  | 'ALL PRIVILEGES'

type GrantFn = (privilege: Privilege | Privilege[], table: string, roleSpecification: string) => string
/** @see [GRANT](https://www.postgresql.org/docs/current/sql-grant.html) */
export type Grant = GrantFn & { reverse: GrantFn }
/** @see [REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html) */
export type Revoke = (privilege: Privilege | Privilege[], table: string, roleSpecification: string) => string
