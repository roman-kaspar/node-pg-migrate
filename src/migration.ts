/*
 A new Migration is instantiated for each migration file.

 It is responsible for storing the name of the file and knowing how to execute
 the up and down migrations defined in the file.

 */

import fs from 'fs'
import mkdirp from 'mkdirp'
import path from 'path'
import { DBConnection } from './db'
import MigrationBuilder from './migration-builder'
import { MigrationAction, MigrationBuilderActions, MigrationDirection, RunnerOption, Logger } from './types'
import { getMigrationTableSchema } from './utils'
import { ColumnDefinitions } from './operations/tablesTypes'

const { readdir } = fs.promises

export interface RunMigration {
  readonly path: string
  readonly name: string
  readonly timestamp: number
}

export enum FilenameFormat {
  timestamp = 'timestamp',
  utc = 'utc',
}

export interface CreateOptionsTemplate {
  templateFileName: string
}

export interface CreateOptionsDefault {
  language?: 'js' | 'ts' | 'sql'
  ignorePattern?: string
}

export type CreateOptions = {
  filenameFormat?: FilenameFormat
} & (CreateOptionsTemplate | CreateOptionsDefault)

const SEPARATOR = '_'

export const loadMigrationFiles = async (dir: string, ignorePattern?: string) => {
  const dirContent = await readdir(`${dir}/`, { withFileTypes: true })
  const files = dirContent
    .map((file) => (file.isFile() || file.isSymbolicLink() ? file.name : null))
    .filter((file): file is string => Boolean(file))
    .sort()
  const filter = new RegExp(`^(${ignorePattern})$`) // eslint-disable-line security/detect-non-literal-regexp
  return ignorePattern === undefined ? files : files.filter((i) => !filter.test(i))
}

const getSuffixFromFileName = (fileName: string) => path.extname(fileName).substr(1)

const getLastSuffix = async (dir: string, ignorePattern?: string) => {
  try {
    const files = await loadMigrationFiles(dir, ignorePattern)
    return files.length > 0 ? getSuffixFromFileName(files[files.length - 1]) : undefined
  } catch (err) {
    return undefined
  }
}

export const getTimestamp = (logger: Logger, filename: string): number => {
  const prefix = filename.split(SEPARATOR)[0]
  if (prefix && /^\d+$/.test(prefix)) {
    if (prefix.length === 13) {
      // timestamp: 1391877300255
      return Number(prefix)
    }
    if (prefix && prefix.length === 17) {
      // utc: 20200513070724505
      const year = prefix.substr(0, 4)
      const month = prefix.substr(4, 2)
      const date = prefix.substr(6, 2)
      const hours = prefix.substr(8, 2)
      const minutes = prefix.substr(10, 2)
      const seconds = prefix.substr(12, 2)
      const ms = prefix.substr(14)
      return new Date(`${year}-${month}-${date}T${hours}:${minutes}:${seconds}.${ms}Z`).valueOf()
    }
  }
  logger.error(`Can't determine timestamp for ${prefix}`)
  return Number(prefix) || 0
}

const resolveSuffix = async (directory: string, { language, ignorePattern }: CreateOptionsDefault) =>
  language || (await getLastSuffix(directory, ignorePattern)) || 'js'

export class Migration implements RunMigration {
  // class method that creates a new migration file by cloning the migration template
  static async create(
    name: string,
    directory: string,
    _language?: 'js' | 'ts' | 'sql' | CreateOptions,
    _ignorePattern?: string,
    _filenameFormat?: FilenameFormat,
  ) {
    if (typeof _language === 'string') {
      // eslint-disable-next-line no-console
      console.warn('This usage is deprecated. Please use this method with options object argument')
    }
    const options =
      typeof _language === 'object'
        ? _language
        : { language: _language, ignorePattern: _ignorePattern, filenameFormat: _filenameFormat }
    const { filenameFormat = FilenameFormat.timestamp } = options

    // ensure the migrations directory exists
    mkdirp.sync(directory)

    const now = new Date()
    const time = filenameFormat === FilenameFormat.utc ? now.toISOString().replace(/[^\d]/g, '') : now.valueOf()

    const templateFileName =
      'templateFileName' in options
        ? path.resolve(process.cwd(), options.templateFileName)
        : path.resolve(__dirname, `../templates/migration-template.${await resolveSuffix(directory, options)}`)
    const suffix = getSuffixFromFileName(templateFileName)

    // file name looks like migrations/1391877300255_migration-title.js
    const newFile = `${directory}/${time}${SEPARATOR}${name}.${suffix}`

    // copy the default migration template to the new file location
    await new Promise((resolve, reject) => {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.createReadStream(templateFileName)
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        .pipe(fs.createWriteStream(newFile))
        .on('close', resolve)
        .on('error', reject)
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

  public readonly logger: Logger

  constructor(
    db: DBConnection,
    migrationPath: string,
    { up, down }: MigrationBuilderActions,
    options: RunnerOption,
    typeShorthands?: ColumnDefinitions,
    logger: Logger = console,
  ) {
    this.db = db
    this.path = migrationPath
    this.name = path.basename(migrationPath, path.extname(migrationPath))
    this.timestamp = getTimestamp(logger, this.name)
    this.up = up
    this.down = down
    this.options = options
    this.typeShorthands = typeShorthands
    this.logger = logger
  }

  _getMarkAsRun(action: MigrationAction) {
    const schema = getMigrationTableSchema(this.options)
    const { migrationsTable } = this.options
    const { name } = this
    switch (action) {
      case this.down:
        this.logger.info(`### MIGRATION ${this.name} (DOWN) ###`)
        return `DELETE FROM "${schema}"."${migrationsTable}" WHERE name='${name}';`
      case this.up:
        this.logger.info(`### MIGRATION ${this.name} (UP) ###`)
        return `INSERT INTO "${schema}"."${migrationsTable}" (name, run_on) VALUES ('${name}', CURRENT_TIMESTAMP);`
      default:
        throw new Error('Unknown direction')
    }
  }

  async _apply(action: MigrationAction, pgm: MigrationBuilder) {
    if (action.length === 2) {
      await new Promise<void>((resolve) => action(pgm, resolve))
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
      this.logger.warn('#> WARNING: Need to break single transaction! <')
      sqlSteps.unshift('COMMIT;')
      sqlSteps.push('BEGIN;')
    } else if (!this.options.singleTransaction || !pgm.isUsingTransaction()) {
      this.logger.warn('#> WARNING: This migration is not wrapped in a transaction! <')
    }

    if (typeof this.logger.debug === 'function') {
      this.logger.debug(`${sqlSteps.join('\n')}\n\n`)
    }

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
    const pgm = new MigrationBuilder(this.db, this.typeShorthands, Boolean(this.options.decamelize), this.logger)
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
