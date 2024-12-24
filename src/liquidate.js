#!/usr/bin/env node

const { initNear } = require("./libs/near");
const { main: liquidate } = require("./libs/burrow");
const readlineSync = require('readline-sync');
const log4js = require('log4js');

function getPassword() {
  return readlineSync.question('Please enter your password: ', {
    hideEchoBack: true
  });
}

initNear(true, getPassword()).then((nearObject) => {
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
  const executeAsyncOperation = () => {
    liquidate(nearObject, {
      liquidate: nearObject.NearConfig.liquidate,
      forceClose: nearObject.NearConfig.forceClose,
      marginLiquidate: nearObject.NearConfig.marginLiquidate,
      marginForceClose: nearObject.NearConfig.marginForceClose,
    }).then(() => {
      liquidateLogger.info('Liquidate End');
      setTimeout(executeAsyncOperation, nearObject.NearConfig.loopInterval);
    }).catch(error => {
      liquidateLogger.error('Liquidate Failed:', error);
      setTimeout(executeAsyncOperation, nearObject.NearConfig.loopInterval);
    })
  }
  executeAsyncOperation();
})

