const constraint = require('./014_add_constraint')

exports.up = pgm => {
  pgm.dropConstraint('t1', constraint.constraint)
}

exports.down = pgm => {
  pgm.addConstraint('t1', constraint.constraint, {
    check: 'true',
  })
}
