const { initNear } = require("./libs/near");
const { main: register } = require("./libs/reg_liquidator");
const log4js = require('log4js');


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
  const registerLogger = log4js.getLogger();
  register(nearObject).then(() => {
    registerLogger.info('Register End');
  }).catch(error => {
    registerLogger.error('Register failed:', error);
  })
});

