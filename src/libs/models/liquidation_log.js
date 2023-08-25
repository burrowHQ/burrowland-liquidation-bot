// import module
const seq = require('./db');
const { DataTypes } = require('sequelize');


// 定义模型的属性--除主键外的字段
const LiquidationLog = seq.define('BurrowLiquidationLog', {
    id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
        allowNull: false
    },
    account_id: {
        type: DataTypes.STRING,
        allowNull: false
    },
    healhFactor_before: {
        type: DataTypes.STRING,
        allowNull: false
    },
    healhFactor_after: {
        type: DataTypes.STRING,
        allowNull: false
    },
    liquidation_type:{
        type: DataTypes.STRING,
        allowNull: false
    },
    RepaidAssets: {
        type: DataTypes.JSONB,
        allowNull: false
    },
    LiquidatedAssets: {
        type: DataTypes.JSONB,
        allowNull: false
    },
    isRead: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    },
    isDeleted: {
        type: DataTypes.BOOLEAN,
        allowNull: false
    },
}, {
    /* 模型参数：*/
    // freezeTableName:true,// 强制指定表名
    // tableName:"表名",//提供表名
    createdAt: true, //创建时间
    updatedAt: true, //修改时间
    paranoid: false, // deletedAt:"删除时间"-只是在数据上增加一个标记，避免真正意义上的删除
});

// export module
module.exports = LiquidationLog;