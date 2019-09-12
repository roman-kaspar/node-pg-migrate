const _ = require('lodash');

function dropExtension(mOptions) {
  const _drop = (extensions, { ifExists, cascade } = {}) => {
    if (!_.isArray(extensions)) extensions = [extensions]; // eslint-disable-line no-param-reassign
    const ifExistsStr = ifExists ? ' IF EXISTS' : '';
    const cascadeStr = cascade ? ' CASCADE' : '';
    return _.map(extensions, extension => {
      const extensionStr = mOptions.literal(extension);
      return `DROP EXTENSION${ifExistsStr} ${extensionStr}${cascadeStr};`;
    });
  };
  return _drop;
}

function createExtension(mOptions) {
  const _create = (extensions, { ifNotExists, schema } = {}) => {
    if (!_.isArray(extensions)) extensions = [extensions]; // eslint-disable-line no-param-reassign
    const ifNotExistsStr = ifNotExists ? ' IF NOT EXISTS' : '';
    const schemaStr = schema ? ` SCHEMA ${mOptions.literal(schema)}` : '';
    return _.map(extensions, extension => {
      const extensionStr = mOptions.literal(extension);
      return `CREATE EXTENSION${ifNotExistsStr} ${extensionStr}${schemaStr};`;
    });
  };
  _create.reverse = dropExtension(mOptions);
  return _create;
}

module.exports = {
  createExtension,
  dropExtension
};
