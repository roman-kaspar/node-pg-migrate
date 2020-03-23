/*
 A new Migration is instantiated for each migration file.

 It is responsible for storing the name of the file and knowing how to execute
 the up and down migrations defined in the file.

 */

import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'
import { promisify } from 'util'
import { DBConnection } from './db'
import MigrationBuilder from './migration-builder'
import { MigrationAction, MigrationBuilderActions, MigrationDirection, RunnerOption } from './types'
import { getMigrationTableSchema } from './utils'
import { ColumnDefinitions } from './operations/tablesTypes'

const readdir = promisify(fs.readdir) // eslint-disable-line security/detect-non-literal-fs-filename
const lstat = promisify(fs.lstat) // eslint-disable-line security/detect-non-literal-fs-filename

const SEPARATOR = '_'

export const loadMigrationFiles = async (dir: string, ignorePattern?: string) => {
  const dirContent = await readdir(`${dir}/`)
  const files = (
    await Promise.all(
      dirContent.map(async (file) => {
        const stats = await lstat(`${dir}/${file}`)
        return stats.isFile() ? file : null
      }),
    )
  )
    .filter((file): file is string => Boolean(file))
    .sort()
  const filter = new RegExp(`^(${ignorePattern})$`) // eslint-disable-line security/detect-non-literal-regexp
  return ignorePattern === undefined ? files : files.filter((i) => !filter.test(i))
}

const getLastSuffix = async (dir: string, ignorePattern?: string) => {
  try {
    const files = await loadMigrationFiles(dir, ignorePattern)
    return files.length > 0 ? path.extname(files[files.length - 1]).substr(1) : undefined
  } catch (err) {
    return undefined
  }
}

export interface RunMigration {
  readonly path: string
  readonly name: string
  readonly timestamp: number
}

export class Migration implements RunMigration {
  // class method that creates a new migration file by cloning the migration template
  static async create(name: string, directory: string, language?: 'js' | 'ts' | 'sql', ignorePattern?: string) {
    // ensure the migrations directory exists
    mkdirp.sync(directory)

    const suffix = language || (await getLastSuffix(directory, ignorePattern)) || 'js'

    // file name looks like migrations/1391877300255_migration-title.js
    const newFile = `${directory}/${Date.now()}${SEPARATOR}${name}.${suffix}`

    // copy the default migration template to the new file location
    await new Promise((resolve) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.createReadStream(path.resolve(__dirname, `../templates/migration-template.${suffix}`))
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        .pipe(fs.createWriteStream(newFile))
        .on('end', resolve)
    })

    return newFile
  }

  public readonly db: DBConnection

  public readonly path: string

  public readonly name: string

  public readonly timestamp: number

  public up?: false | MigrationAction

  public down?: false | MigrationAction

  public readonly options: RunnerOption

  public readonly typeShorthands?: ColumnDefinitions

  public readonly log: typeof console.log

  constructor(
    db: DBConnection,
    migrationPath: string,
    { up, down }: MigrationBuilderActions,
    options: RunnerOption,
    typeShorthands?: ColumnDefinitions,
    log = console.log,
  ) {
    this.db = db
    this.path = migrationPath
    this.name = path.basename(migrationPath, path.extname(migrationPath))
    this.timestamp = Number(this.name.split(SEPARATOR)[0]) || 0
    this.up = up
    this.down = down
    this.options = options
    this.typeShorthands = typeShorthands
    this.log = log
  }

  _getMarkAsRun(action: MigrationAction) {
    const schema = getMigrationTableSchema(this.options)
    const { migrationsTable } = this.options
    const { name } = this
    switch (action) {
      case this.down:
        this.log(`### MIGRATION ${this.name} (DOWN) ###`)
        return `DELETE FROM "${schema}"."${migrationsTable}" WHERE name='${name}';`
      case this.up:
        this.log(`### MIGRATION ${this.name} (UP) ###`)
        return `INSERT INTO "${schema}"."${migrationsTable}" (name, run_on) VALUES ('${name}', NOW());`
      default:
        throw new Error('Unknown direction')
    }
  }

  async _apply(action: MigrationAction, pgm: MigrationBuilder) {
    if (action.length === 2) {
      await new Promise((resolve) => action(pgm, resolve))
    } else {
      await action(pgm)
    }

    const sqlSteps = pgm.getSqlSteps()

    sqlSteps.push(this._getMarkAsRun(action))

    if (!this.options.singleTransaction && pgm.isUsingTransaction()) {
      // if not in singleTransaction mode we need to create our own transaction
      sqlSteps.unshift('BEGIN;')
      sqlSteps.push('COMMIT;')
    } else if (this.options.singleTransaction && !pgm.isUsingTransaction()) {
      // in singleTransaction mode we are already wrapped in a global transaction
      this.log('#> WARNING: Need to break single transaction! <')
      sqlSteps.unshift('COMMIT;')
      sqlSteps.push('BEGIN;')
    } else if (!this.options.singleTransaction || !pgm.isUsingTransaction()) {
      this.log('#> WARNING: This migration is not wrapped in a transaction! <')
    }

    this.log(`${sqlSteps.join('\n')}\n\n`)

    return sqlSteps.reduce(
      (promise: Promise<unknown>, sql) => promise.then((): unknown => this.options.dryRun || this.db.query(sql)),
      Promise.resolve(),
    )
  }

  _getAction(direction: MigrationDirection) {
    if (direction === 'down' && this.down === undefined) {
      this.down = this.up
    }

    const action: MigrationAction | false | undefined = this[direction]

    if (action === false) {
      throw new Error(`User has disabled ${direction} migration on file: ${this.name}`)
    }

    if (typeof action !== 'function') {
      throw new Error(
        `Unknown value for direction: ${direction}. Is the migration ${this.name} exporting a '${direction}' function?`,
      )
    }

    return action
  }

  apply(direction: MigrationDirection) {
    const pgm = new MigrationBuilder(this.db, this.typeShorthands, Boolean(this.options.decamelize))
    const action = this._getAction(direction)

    if (this.down === this.up) {
      // automatically infer the down migration by running the up migration in reverse mode...
      pgm.enableReverseMode()
    }

    return this._apply(action, pgm)
  }

  markAsRun(direction: MigrationDirection) {
    return this.db.query(this._getMarkAsRun(this._getAction(direction)))
  }
}
