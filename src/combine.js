const { initNear } = require("./libs/near");
const { main: liquidate } = require("./libs/burrow");
const { main: tokenRegister } = require("./libs/reg_liquidator");
const { main: rebalance } = require("./libs/rebalance");
const log4js = require('log4js');


if (!process.env.NEAR_ACCOUNT_ID) {
    throw "Missing NEAR_ACCOUNT_ID"
}

if (process.env.DOCKER_ENV == 'true' && (process.env.NEAR_TX_SIGNING_MODE || 'local') !== 'remote') {
    if (!process.env.ENCODE_PRIVATE_KEY) {
        throw "Missing ENCODE_PRIVATE_KEY"
    }
}

initNear(true).then((nearObject) => {
    const { NearConfig } = nearObject;
    log4js.configure({
        appenders: {
            console: { type: 'console' },
        },
        categories: {
            default: { appenders: ['console'], level: NearConfig.logLevel }
        }
    });
    const logger = log4js.getLogger();
    const tokenRegisterAlreadyCheckList = [];
    const executeTokenRegisterAsyncOperation = () => {
        tokenRegister(nearObject, tokenRegisterAlreadyCheckList).then(() => {
            logger.info('Register End');
            setTimeout(executeTokenRegisterAsyncOperation, nearObject.NearConfig.loopInterval);
        }).catch(error => {
            logger.error('Register failed:', error);
            setTimeout(executeTokenRegisterAsyncOperation, nearObject.NearConfig.loopInterval);
        })
    }
    executeTokenRegisterAsyncOperation();

    const executeLiquidateAsyncOperation = () => {
        liquidate(nearObject, {
            liquidate: nearObject.NearConfig.liquidate,
            forceClose: nearObject.NearConfig.forceClose,
            marginLiquidate: nearObject.NearConfig.marginLiquidate,
            marginForceClose: nearObject.NearConfig.marginForceClose,
        }).then(() => {
            logger.info('Liquidate End');
            setTimeout(executeLiquidateAsyncOperation, nearObject.NearConfig.loopInterval);
        }).catch(error => {
            logger.error('Liquidate failed:', error);
            setTimeout(executeLiquidateAsyncOperation, nearObject.NearConfig.loopInterval);
        })
    }
    executeLiquidateAsyncOperation();

    const executeRebalanceAsyncOperation = () => {
        rebalance(nearObject).then(() => {
            logger.info('Rebalance End');
            setTimeout(executeRebalanceAsyncOperation, nearObject.NearConfig.loopInterval);
        }).catch(error => {
            logger.error('Rebalance failed:', error);
            setTimeout(executeRebalanceAsyncOperation, nearObject.NearConfig.loopInterval);
        })
    }
    executeRebalanceAsyncOperation();
})