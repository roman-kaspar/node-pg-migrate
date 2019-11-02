import { MigrationOptions } from '../migration-builder';
import { createTransformer } from '../utils';

export function sql(mOptions: MigrationOptions) {
  const t = createTransformer(mOptions.literal);
  return (sql: string, args?: object) => {
    // applies some very basic templating using the utils.p
    let s: string = t(sql, args);
    // add trailing ; if not present
    if (s.lastIndexOf(';') !== s.length - 1) {
      s += ';';
    }
    return s;
  };
}
