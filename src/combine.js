const { initNear } = require("./libs/near");
const { main: liquidate } = require("./libs/burrow");
const { main: tokenRegister } = require("./libs/reg_liquidator");
const { main: rebalance } = require("./libs/rebalance");
const { sendHeartBeat } = require("./libs/utils");
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
    const executeTokenRegisterAsyncOperation = async () => {
        try {
            await tokenRegister(nearObject, tokenRegisterAlreadyCheckList);
            try {
                await sendHeartBeat(nearObject.NearConfig.heartbeatUrl, `${nearObject.NearConfig.accountId}-register`);
            } catch (error) {
                logger.error('Register heartbeat failed:', error);
            }
            logger.info('Register End');
        } catch (error) {
            logger.error('Register failed:', error);
        } finally {
            setTimeout(executeTokenRegisterAsyncOperation, nearObject.NearConfig.loopInterval);
        }
    }
    executeTokenRegisterAsyncOperation();

    const executeLiquidateAsyncOperation = async () => {
        try {
            await liquidate(nearObject, {
                liquidate: nearObject.NearConfig.liquidate,
                forceClose: nearObject.NearConfig.forceClose,
                marginLiquidate: nearObject.NearConfig.marginLiquidate,
                marginForceClose: nearObject.NearConfig.marginForceClose,
            });
            try {
                await sendHeartBeat(nearObject.NearConfig.heartbeatUrl, `${nearObject.NearConfig.accountId}-liquidate`);
            } catch (error) {
                logger.error('Liquidate heartbeat failed:', error);
            }
            logger.info('Liquidate End');
        } catch (error) {
            logger.error('Liquidate failed:', error);
        } finally {
            setTimeout(executeLiquidateAsyncOperation, nearObject.NearConfig.loopInterval);
        }
    }
    executeLiquidateAsyncOperation();

    const executeRebalanceAsyncOperation = async () => {
        try {
            await rebalance(nearObject);
            try {
                await sendHeartBeat(nearObject.NearConfig.heartbeatUrl, `${nearObject.NearConfig.accountId}-rebalance`);
            } catch (error) {
                logger.error('Rebalance heartbeat failed:', error);
            }
            logger.info('Rebalance End');
        } catch (error) {
            logger.error('Rebalance failed:', error);
        } finally {
            setTimeout(executeRebalanceAsyncOperation, nearObject.NearConfig.loopInterval);
        }
    }
    executeRebalanceAsyncOperation();
})