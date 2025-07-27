const { Sequelize } = require('sequelize');

const sequelize = new Sequelize('test', 'root', 'obituary', {
    host: 'localhost',
    dialect: 'mysql'
});

async function testConexion(){
    try {
        await sequelize.authenticate();
        console.log('CONEXION EXITOSA CON BD.');
      } catch (error) {
        console.error('ERROR DE CONEXION!!!: ', error);
      }
}

testConexion();

module.exports = sequelize;