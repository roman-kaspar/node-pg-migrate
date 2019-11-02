import { MigrationOptions } from '../migration-builder';
import { formatLines } from '../utils';

export interface CreateMaterializedViewOptions {
  ifNotExists?: boolean;
  columns?: string | string[];
  tablespace?: string;
  storageParameters?: object;
  data?: boolean;
}

export interface AlterMaterializedViewOptions {
  cluster?: null | false | string;
  extension?: string;
  storageParameters?: object;
}

export interface RefreshMaterializedViewOptions {
  concurrently?: boolean;
  data?: boolean;
}

const dataClause = data =>
  data !== undefined ? ` WITH${data ? '' : ' NO'} DATA` : '';
const storageParameterStr = storageParameters => key => {
  const value =
    storageParameters[key] === true ? '' : ` = ${storageParameters[key]}`;
  return `${key}${value}`;
};

export function dropMaterializedView(mOptions: MigrationOptions) {
  const _drop = (viewName, { ifExists, cascade } = {}) => {
    const ifExistsStr = ifExists ? ' IF EXISTS' : '';
    const cascadeStr = cascade ? ' CASCADE' : '';
    const viewNameStr = mOptions.literal(viewName);
    return `DROP MATERIALIZED VIEW${ifExistsStr} ${viewNameStr}${cascadeStr};`;
  };
  return _drop;
}

export function createMaterializedView(mOptions: MigrationOptions) {
  const _create = (viewName, options, definition) => {
    const {
      ifNotExists,
      columns = [],
      tablespace,
      storageParameters = {},
      data
    } = options;
    // prettier-ignore
    const columnNames = (Array.isArray(columns) ? columns : [columns]).map(mOptions.literal).join(", ");
    const withOptions = Object.keys(storageParameters)
      .map(storageParameterStr(storageParameters))
      .join(', ');

    const ifNotExistsStr = ifNotExists ? ' IF NOT EXISTS' : '';
    const columnsStr = columnNames ? `(${columnNames})` : '';
    const withOptionsStr = withOptions ? ` WITH (${withOptions})` : '';
    const tablespaceStr = tablespace
      ? `TABLESPACE ${mOptions.literal(tablespace)}`
      : '';
    const dataStr = dataClause(data);
    const viewNameStr = mOptions.literal(viewName);

    return `CREATE MATERIALIZED VIEW${ifNotExistsStr} ${viewNameStr}${columnsStr}${withOptionsStr}${tablespaceStr} AS ${definition}${dataStr};`;
  };
  _create.reverse = dropMaterializedView(mOptions);
  return _create;
}

export function alterMaterializedView(mOptions: MigrationOptions) {
  const _alter = (viewName, options) => {
    const { cluster, extension, storageParameters = {} } = options;
    const clauses = [];
    if (cluster !== undefined) {
      if (cluster) {
        clauses.push(`CLUSTER ON ${mOptions.literal(cluster)}`);
      } else {
        clauses.push(`SET WITHOUT CLUSTER`);
      }
    }
    if (extension) {
      clauses.push(`DEPENDS ON EXTENSION ${mOptions.literal(extension)}`);
    }
    const withOptions = Object.keys(storageParameters)
      .filter(key => storageParameters[key])
      .map(storageParameterStr(storageParameters))
      .join(', ');
    if (withOptions) {
      clauses.push(`SET (${withOptions})`);
    }
    const resetOptions = Object.keys(storageParameters)
      .filter(key => !storageParameters[key])
      .join(', ');
    if (resetOptions) {
      clauses.push(`RESET (${resetOptions})`);
    }
    const clausesStr = formatLines(clauses);
    const viewNameStr = mOptions.literal(viewName);
    return `ALTER MATERIALIZED VIEW ${viewNameStr}\n${clausesStr};`;
  };
  return _alter;
}

export function renameMaterializedView(mOptions: MigrationOptions) {
  const _rename = (viewName, newViewName) => {
    const viewNameStr = mOptions.literal(viewName);
    const newViewNameStr = mOptions.literal(newViewName);
    return `ALTER MATERIALIZED VIEW ${viewNameStr} RENAME TO ${newViewNameStr};`;
  };
  _rename.reverse = (viewName, newViewName) => _rename(newViewName, viewName);
  return _rename;
}

export function renameMaterializedViewColumn(mOptions: MigrationOptions) {
  const _rename = (viewName, columnName, newColumnName) => {
    const viewNameStr = mOptions.literal(viewName);
    const columnNameStr = mOptions.literal(columnName);
    const newColumnNameStr = mOptions.literal(newColumnName);
    return `ALTER MATERIALIZED VIEW ${viewNameStr} RENAME COLUMN ${columnNameStr} TO ${newColumnNameStr};`;
  };
  _rename.reverse = (viewName, columnName, newColumnName) =>
    _rename(viewName, newColumnName, columnName);
  return _rename;
}

export function refreshMaterializedView(mOptions: MigrationOptions) {
  const _refresh = (viewName, { concurrently, data } = {}) => {
    const concurrentlyStr = concurrently ? ' CONCURRENTLY' : '';
    const dataStr = dataClause(data);
    const viewNameStr = mOptions.literal(viewName);
    return `REFRESH MATERIALIZED VIEW${concurrentlyStr} ${viewNameStr}${dataStr};`;
  };
  _refresh.reverse = _refresh;
  return _refresh;
}
