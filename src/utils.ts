import decamelize from 'decamelize'
import { ColumnDefinitions, ColumnDefinition } from './operations/tablesTypes'
import { Name, Type, Value } from './operations/generalTypes'
import { MigrationOptions, Literal, RunnerOption } from './types'
import { FunctionParam, FunctionParamType } from './operations/functionsTypes'
import { PgLiteral } from '.'

const identity = <T>(v: T) => v
const quote = (str: string) => `"${str}"`

export const createSchemalize = (shouldDecamelize: boolean, shouldQuote: boolean) => {
  const transform = [shouldDecamelize ? decamelize : identity, shouldQuote ? quote : identity].reduce((acc, fn) =>
    fn === identity ? acc : (x: string) => acc(fn(x)),
  )
  return (v: Name) => {
    if (typeof v === 'object') {
      const { schema, name } = v
      return (schema ? `${transform(schema)}.` : '') + transform(name)
    }
    return transform(v)
  }
}

const isPgLiteral = (val: unknown): val is PgLiteral =>
  typeof val === 'object' && val !== null && 'literal' in val && (val as { literal: unknown }).literal === true

export const createTransformer = (literal: Literal) => (s: string, d?: { [key: string]: Name | PgLiteral }) =>
  Object.keys(d || {}).reduce((str: string, p) => {
    const v = d?.[p]
    return str.replace(
      // eslint-disable-next-line security/detect-non-literal-regexp
      new RegExp(`{${p}}`, 'g'),
      // eslint-disable-next-line no-nested-ternary
      v === undefined ? '' : isPgLiteral(v) ? v.value : literal(v),
    )
  }, s)

export const escapeValue = (val: Value): string | number => {
  if (val === null) {
    return 'NULL'
  }
  if (typeof val === 'boolean') {
    return val.toString()
  }
  if (typeof val === 'string') {
    let dollars: string
    let index = 0
    do {
      index += 1
      dollars = `$pg${index}$`
    } while (val.indexOf(dollars) >= 0)
    return `${dollars}${val}${dollars}`
  }
  if (typeof val === 'number') {
    return val
  }
  if (Array.isArray(val)) {
    const arrayStr = val.map(escapeValue).join(',').replace(/ARRAY/g, '')
    return `ARRAY[${arrayStr}]`
  }
  if (isPgLiteral(val)) {
    return val.value
  }
  return ''
}

export const getSchemas = (schema?: string | string[]): string[] => {
  const schemas = (Array.isArray(schema) ? schema : [schema]).filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  )
  return schemas.length > 0 ? schemas : ['public']
}

export const getMigrationTableSchema = (options: RunnerOption): string =>
  options.migrationsSchema !== undefined ? options.migrationsSchema : getSchemas(options.schema)[0]

const typeAdapters = {
  int: 'integer',
  string: 'text',
  float: 'real',
  double: 'double precision',
  datetime: 'timestamp',
  bool: 'boolean',
} as const

const defaultTypeShorthands: ColumnDefinitions = {
  id: { type: 'serial', primaryKey: true }, // convenience type for serial primary keys
}

// some convenience adapters -- see above
export const applyTypeAdapters = (type: string): string =>
  type in typeAdapters ? typeAdapters[type as keyof typeof typeAdapters] : type

const toType = (type: string | ColumnDefinition): ColumnDefinition => (typeof type === 'string' ? { type } : type)

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const removeType = ({ type, ...rest }: Partial<ColumnDefinition>) => rest

export const applyType = (
  type: Type,
  extendingTypeShorthands: ColumnDefinitions = {},
): ColumnDefinition & FunctionParamType => {
  const typeShorthands: ColumnDefinitions = {
    ...defaultTypeShorthands,
    ...extendingTypeShorthands,
  }
  const options = toType(type)
  let ext: ColumnDefinition | null = null
  const types: string[] = [options.type]
  while (typeShorthands[types[types.length - 1]]) {
    ext = {
      ...toType(typeShorthands[types[types.length - 1]]),
      ...(ext === null ? {} : removeType(ext)),
    }
    if (types.includes(ext.type)) {
      throw new Error(`Shorthands contain cyclic dependency: ${types.join(', ')}, ${ext.type}`)
    } else {
      types.push(ext.type)
    }
  }
  return {
    ...ext,
    ...options,
    type: applyTypeAdapters(ext?.type ?? options.type),
  }
}

const formatParam = (mOptions: MigrationOptions) => (param: FunctionParam) => {
  const { mode, name, type, default: defaultValue } = applyType(param, mOptions.typeShorthands)
  const options: string[] = []
  if (mode) {
    options.push(mode)
  }
  if (name) {
    options.push(mOptions.literal(name))
  }
  if (type) {
    options.push(type)
  }
  if (defaultValue) {
    options.push(`DEFAULT ${escapeValue(defaultValue)}`)
  }
  return options.join(' ')
}

export const formatParams = (params: FunctionParam[] = [], mOptions: MigrationOptions) =>
  `(${params.map(formatParam(mOptions)).join(', ')})`

export const makeComment = (object: string, name: string, text?: string | null) => {
  const cmt = escapeValue(text || null)
  return `COMMENT ON ${object} ${name} IS ${cmt};`
}

export const formatLines = (lines: string[], replace = '  ', separator = ',') =>
  lines
    .map((line) => line.replace(/(?:\r\n|\r|\n)+/g, ' '))
    .join(`${separator}\n`)
    .replace(/^/gm, replace)
