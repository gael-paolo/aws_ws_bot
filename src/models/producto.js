// models/Producto.js
const { DataTypes } = require('sequelize');
const sequelize = require('./conexion.js'); 

const Producto = sequelize.define('motocicletas', {
    ID: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    Marca: { type: DataTypes.STRING },
    Modelo: { type: DataTypes.STRING },
    Cilindrada: { type: DataTypes.INTEGER },
    Color: { type: DataTypes.STRING },
    Año: { type: DataTypes.INTEGER },
    Precio: { type: DataTypes.DECIMAL(10, 2) },
    Tipo: { type: DataTypes.STRING },
    Stock_Disponible: { type: DataTypes.INTEGER },
    Estado: { type: DataTypes.STRING },
    Pais_Origen: { type: DataTypes.STRING }
}, {
    timestamps: false, // Para no crear columnas createdAt/updatedAt
    tableName: 'motocicletas'
});

Producto.sync()

module.exports = Producto;









