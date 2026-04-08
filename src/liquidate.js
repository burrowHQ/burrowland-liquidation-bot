#!/usr/bin/env node

const { initNear } = require("./libs/near");
const { main: liquidate } = require("./libs/burrow");
const { sendHeartBeat } = require("./libs/utils");
const log4js = require('log4js');

initNear(true).then((nearObject) => {
  const { NearConfig } = nearObject;
  log4js.configure({
    appenders: {
      console: { type: 'console' },
      dateFileAppender: {
        type: 'dateFile',
        filename: 'logs/liquidate',
        pattern: 'yyyy-MM-dd.log',
        numBackups: 7,
        compress: true,
        maxLogSize: 1024 * 1024 * 1024,
        alwaysIncludePattern: true
      }
    },
    categories: {
      default: { appenders: ['console', 'dateFileAppender'], level: NearConfig.logLevel }
    }
  });
  const liquidateLogger = log4js.getLogger();
  const executeAsyncOperation = async () => {
    try {
      await liquidate(nearObject, {
        liquidate: nearObject.NearConfig.liquidate,
        forceClose: nearObject.NearConfig.forceClose,
        marginLiquidate: nearObject.NearConfig.marginLiquidate,
        marginForceClose: nearObject.NearConfig.marginForceClose,
        stopKeeper: nearObject.NearConfig.stopKeeper,
      });
      try {
        await sendHeartBeat(nearObject.NearConfig.heartbeatUrl, `${nearObject.NearConfig.accountId}-liquidate`);
      } catch (error) {
        liquidateLogger.error('Heartbeat Failed:', error);
      }
      liquidateLogger.info('Liquidate End');
    } catch (error) {
      liquidateLogger.error('Liquidate Failed:', error);
    } finally {
      setTimeout(executeAsyncOperation, nearObject.NearConfig.loopInterval);
    }
  }
  executeAsyncOperation();
})

