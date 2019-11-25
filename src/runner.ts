import fs from 'fs'
import path from 'path'
import { promisify } from 'util'
import Db, { DBConnection } from './db'
import { ColumnDefinitions } from './operations/tablesTypes'
import { Migration, loadMigrationFiles, RunMigration } from './migration'
import { MigrationBuilderActions, MigrationDirection, RunnerOptionClient, RunnerOptionUrl, RunnerOption } from './types'
import { createSchemalize, getMigrationTableSchema, getSchemas } from './utils'

// Random but well-known identifier shared by all instances of node-pg-migrate
const PG_MIGRATE_LOCK_ID = 7241865325823964

const readFile = promisify(fs.readFile) // eslint-disable-line security/detect-non-literal-fs-filename

const idColumn = 'id'
const nameColumn = 'name'
const runOnColumn = 'run_on'

const loadMigrations = async (db: DBConnection, options: RunnerOption, log: typeof console.log) => {
  try {
    let shorthands: ColumnDefinitions = {}
    const files = await loadMigrationFiles(options.dir, options.ignorePattern)
    return files.map(file => {
      const filePath = `${options.dir}/${file}`
      const actions: MigrationBuilderActions =
        path.extname(filePath) === '.sql'
          ? // eslint-disable-next-line security/detect-non-literal-fs-filename
            { up: async pgm => pgm.sql(await readFile(filePath, 'utf8')) }
          : // eslint-disable-next-line global-require,import/no-dynamic-require,security/detect-non-literal-require
            require(path.relative(__dirname, filePath))
      shorthands = { ...shorthands, ...actions.shorthands }
      return new Migration(
        db,
        filePath,
        actions,
        options,
        {
          ...shorthands,
        },
        log,
      )
    })
  } catch (err) {
    throw new Error(`Can't get migration files: ${err.stack}`)
  }
}

const lock = async (db: DBConnection): Promise<void> => {
  const [lockObtained] = await db.select(`select pg_try_advisory_lock(${PG_MIGRATE_LOCK_ID}) as "lockObtained"`)
  if (!lockObtained) {
    throw new Error('Another migration is already running')
  }
}

const ensureMigrationsTable = async (db: DBConnection, options: RunnerOption): Promise<void> => {
  try {
    const schema = getMigrationTableSchema(options)
    const { migrationsTable } = options
    const fullTableName = createSchemalize(
      options.decamelize,
      true,
    )({
      schema,
      name: migrationsTable,
    })

    const migrationTables = await db.select(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = '${schema}' AND table_name = '${migrationsTable}'`,
    )

    if (migrationTables && migrationTables.length === 1) {
      const primaryKeyConstraints = await db.select(
        `SELECT constraint_name FROM information_schema.table_constraints WHERE table_schema = '${schema}' AND table_name = '${migrationsTable}' AND constraint_type = 'PRIMARY KEY'`,
      )
      if (!primaryKeyConstraints || primaryKeyConstraints.length !== 1) {
        await db.query(`ALTER TABLE ${fullTableName} ADD PRIMARY KEY (${idColumn})`)
      }
    } else {
      await db.query(
        `CREATE TABLE ${fullTableName} ( ${idColumn} SERIAL PRIMARY KEY, ${nameColumn} varchar(255) NOT NULL, ${runOnColumn} timestamp NOT NULL)`,
      )
    }
  } catch (err) {
    throw new Error(`Unable to ensure migrations table: ${err.stack}`)
  }
}

const getRunMigrations = async (db: DBConnection, options: RunnerOption) => {
  const schema = getMigrationTableSchema(options)
  const { migrationsTable } = options
  const fullTableName = createSchemalize(
    options.decamelize,
    true,
  )({
    schema,
    name: migrationsTable,
  })
  return db.column(nameColumn, `SELECT ${nameColumn} FROM ${fullTableName} ORDER BY ${runOnColumn}, ${idColumn}`)
}

const getMigrationsToRun = (options: RunnerOption, runNames: string[], migrations: Migration[]): Migration[] => {
  if (options.direction === 'down') {
    const downMigrations: Array<string | Migration> = runNames
      .filter(migrationName => !options.file || options.file === migrationName)
      .map(migrationName => migrations.find(({ name }) => name === migrationName) || migrationName)
    const toRun = (options.timestamp
      ? downMigrations.filter(migration => typeof migration === 'object' && migration.timestamp >= options.count)
      : downMigrations.slice(-Math.abs(options.count === undefined ? 1 : options.count))
    ).reverse()
    const deletedMigrations = toRun.filter((migration): migration is string => typeof migration === 'string')
    if (deletedMigrations.length) {
      const deletedMigrationsStr = deletedMigrations.join(', ')
      throw new Error(`Definitions of migrations ${deletedMigrationsStr} have been deleted.`)
    }
    return toRun as Migration[]
  }
  const upMigrations = migrations.filter(
    ({ name }) => runNames.indexOf(name) < 0 && (!options.file || options.file === name),
  )
  return options.timestamp
    ? upMigrations.filter(({ timestamp }) => timestamp <= options.count)
    : upMigrations.slice(0, Math.abs(options.count === undefined ? Infinity : options.count))
}

const checkOrder = (runNames: string[], migrations: Migration[]) => {
  const len = Math.min(runNames.length, migrations.length)
  for (let i = 0; i < len; i += 1) {
    const runName = runNames[i]
    const migrationName = migrations[i].name
    if (runName !== migrationName) {
      throw new Error(`Not run migration ${migrationName} is preceding already run migration ${runName}`)
    }
  }
}

const runMigrations = (toRun: Migration[], method: 'markAsRun' | 'apply', direction: MigrationDirection) =>
  toRun.reduce((promise, migration) => promise.then(() => migration[method](direction)), Promise.resolve())

export default async (options: RunnerOption): Promise<RunMigration[]> => {
  const log = options.log || console.log
  const db = Db((options as RunnerOptionClient).dbClient || (options as RunnerOptionUrl).databaseUrl, log)
  try {
    await db.createConnection()
    if (options.schema) {
      const schemas = getSchemas(options.schema)
      if (options.createSchema) {
        await Promise.all(schemas.map(schema => db.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`)))
      }
      await db.query(`SET search_path TO ${schemas.map(s => `"${s}"`).join(', ')}`)
    }
    if (options.migrationsSchema && options.createMigrationsSchema) {
      await db.query(`CREATE SCHEMA IF NOT EXISTS "${options.migrationsSchema}"`)
    }

    await ensureMigrationsTable(db, options)

    if (!options.noLock) {
      await lock(db)
    }

    const [migrations, runNames] = await Promise.all([loadMigrations(db, options, log), getRunMigrations(db, options)])

    if (options.checkOrder) {
      checkOrder(runNames, migrations)
    }

    const toRun: Migration[] = getMigrationsToRun(options, runNames, migrations)

    if (!toRun.length) {
      log('No migrations to run!')
      return []
    }

    // TODO: add some fancy colors to logging
    log('> Migrating files:')
    toRun.forEach(m => {
      log(`> - ${m.name}`)
    })

    if (options.fake) {
      await runMigrations(toRun, 'markAsRun', options.direction)
    } else if (options.singleTransaction) {
      await db.query('BEGIN')
      try {
        await runMigrations(toRun, 'apply', options.direction)
        await db.query('COMMIT')
      } catch (err) {
        log('> Rolling back attempted migration ...')
        await db.query('ROLLBACK')
        throw err
      }
    } else {
      await runMigrations(toRun, 'apply', options.direction)
    }

    return toRun.map(m => ({
      path: m.path,
      name: m.name,
      timestamp: m.timestamp,
    }))
  } finally {
    db.close()
  }
}
