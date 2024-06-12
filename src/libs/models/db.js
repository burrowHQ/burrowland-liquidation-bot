const { Sequelize } = require('sequelize');

const DB_PORT = process.env.DB_PORT || 5432;
const DATABASE = process.env.DB_NAME || 'refstats';
const seq = new Sequelize(DATABASE, process.env.DB_USER,  process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    dialect: 'postgres',
    port: DB_PORT,
    pool: {
        max: 40,
        min: 0,
        acquire: 30000,
        idle: 10000
    },
    logging: false

});
module.exports = seq;