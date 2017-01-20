/*
  This file just manages the database connection and provides a query method
*/

var pg = require('pg');
//or native libpq bindings
//var pg = require('pg').native

var client;
var client_active = false;

module.exports.init = function(connection_string){
  client = new pg.Client(connection_string || process.env.DATABASE_URL);
}

module.exports.query = function(query, callback){
  createConnection(function(err){
    if (err) return callback(err);

    // console.log('sql>> ' + query);
    client.query(query, function(err, result){
      if (err) return callback(err);
      return callback(null, result);
    });

  });
}

module.exports.close = function(){
  client_active = false;
  client.end();
}


function createConnection(callback){
  if (client_active) return callback();

  client.connect(function(err){
    if (err) {
      console.error('could not connect to postgres', err);
      return callback(err);
    }
    client_active = true;
    callback();
  });
}
