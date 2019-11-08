import { IfExistsOption, Name } from '../definitions';
import { MigrationOptions } from '../migration-builder';

export interface PolicyOptions {
  role: string | string[];
  using: string;
  check: string;
}

export interface CreatePolicyOptionsEn {
  command: 'ALL' | 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';
}

export type CreatePolicyOptions = CreatePolicyOptionsEn & PolicyOptions;

const makeClauses = ({ role, using, check }: Partial<PolicyOptions>) => {
  const roles = (Array.isArray(role) ? role : [role]).join(', ');
  const clauses: string[] = [];
  if (roles) {
    clauses.push(`TO ${roles}`);
  }
  if (using) {
    clauses.push(`USING (${using})`);
  }
  if (check) {
    clauses.push(`WITH CHECK (${check})`);
  }
  return clauses;
};

export function dropPolicy(mOptions: MigrationOptions) {
  const _drop = (
    tableName: Name,
    policyName: string,
    { ifExists }: IfExistsOption = {}
  ) => {
    const ifExistsStr = ifExists ? ' IF EXISTS' : '';
    const policyNameStr = mOptions.literal(policyName);
    const tableNameStr = mOptions.literal(tableName);
    return `DROP POLICY${ifExistsStr} ${policyNameStr} ON ${tableNameStr};`;
  };
  return _drop;
}

export function createPolicy(mOptions: MigrationOptions) {
  const _create = (
    tableName: Name,
    policyName: string,
    options: Partial<CreatePolicyOptions> = {}
  ) => {
    const createOptions: Partial<CreatePolicyOptions> = {
      ...options,
      role: options.role || 'PUBLIC'
    };
    const clauses = [
      `FOR ${options.command || 'ALL'}`,
      ...makeClauses(createOptions)
    ];
    const clausesStr = clauses.join(' ');
    const policyNameStr = mOptions.literal(policyName);
    const tableNameStr = mOptions.literal(tableName);
    return `CREATE POLICY ${policyNameStr} ON ${tableNameStr} ${clausesStr};`;
  };
  _create.reverse = dropPolicy(mOptions);
  return _create;
}

export function alterPolicy(mOptions: MigrationOptions) {
  const _alter = (
    tableName: Name,
    policyName: string,
    options: Partial<PolicyOptions> = {}
  ) => {
    const clausesStr = makeClauses(options).join(' ');
    const policyNameStr = mOptions.literal(policyName);
    const tableNameStr = mOptions.literal(tableName);
    return `ALTER POLICY ${policyNameStr} ON ${tableNameStr} ${clausesStr};`;
  };
  return _alter;
}

export function renamePolicy(mOptions: MigrationOptions) {
  const _rename = (
    tableName: Name,
    policyName: string,
    newPolicyName: string
  ) => {
    const policyNameStr = mOptions.literal(policyName);
    const newPolicyNameStr = mOptions.literal(newPolicyName);
    const tableNameStr = mOptions.literal(tableName);
    return `ALTER POLICY ${policyNameStr} ON ${tableNameStr} RENAME TO ${newPolicyNameStr};`;
  };
  _rename.reverse = (
    tableName: Name,
    policyName: string,
    newPolicyName: string
  ) => _rename(tableName, newPolicyName, policyName);
  return _rename;
}
