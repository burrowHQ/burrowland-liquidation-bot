const { initNear } = require("./libs/near");
const { main: rebalance } = require("./libs/rebalance");
const log4js = require('log4js');

initNear(true).then((nearObject) => {
  const { NearConfig } = nearObject;
  log4js.configure({
    appenders: {
      console: { type: 'console' },
      dateFileAppender: {
        type: 'dateFile',
        filename: 'logs/rebalance',
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
  const rebalanceLogger = log4js.getLogger();
  const executeAsyncOperation = () => {
    rebalance(nearObject).then(() => {
      rebalanceLogger.info('Rebalance End');
      setTimeout(executeAsyncOperation, nearObject.NearConfig.loopInterval);
    }).catch(error => {
      rebalanceLogger.error('Rebalance Failed:', error);
      setTimeout(executeAsyncOperation, nearObject.NearConfig.loopInterval);
    })
  }
  executeAsyncOperation();
})
