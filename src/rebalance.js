const { initNear } = require("./libs/near");
const { main: rebalance } = require("./libs/rebalance");
const { sendHeartBeat } = require("./libs/utils");
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
  const executeAsyncOperation = async () => {
    try {
      await rebalance(nearObject);
      try {
        await sendHeartBeat(nearObject.NearConfig.heartbeatUrl, `${nearObject.NearConfig.accountId}-rebalance`);
      } catch (error) {
        rebalanceLogger.error('Heartbeat Failed:', error);
      }
      rebalanceLogger.info('Rebalance End');
    } catch (error) {
      rebalanceLogger.error('Rebalance Failed:', error);
    } finally {
      setTimeout(executeAsyncOperation, nearObject.NearConfig.loopInterval);
    }
  }
  executeAsyncOperation();
})
