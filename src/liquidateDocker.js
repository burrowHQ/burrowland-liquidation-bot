#!/usr/bin/env node

const { initNear } = require("./libs/near");
const { main: liquidateDocker } = require("./libs/burrowDocker");
const { main: rebalanceDocker} = require("./rebalanceDocker");
const { main: tokenRegisterDocker} = require("./tokenRegisterDocker");
const readlineSync = require('readline-sync');

function getPassword() {
  return readlineSync.question('Please enter your password: ', {
    hideEchoBack: true
  });
}

initNear(true, getPassword()).then((nearObject) => {
  const executeTokenRegisterAsyncOperation = () => {
    tokenRegisterDocker(nearObject).then(() => {
      setTimeout(executeTokenRegisterAsyncOperation, nearObject.NearConfig.loopInterval);
    }).catch(error => {
      console.error('Token register failed:', error);
      setTimeout(executeTokenRegisterAsyncOperation, nearObject.NearConfig.loopInterval);
    })
  }
  executeTokenRegisterAsyncOperation();

  const executeLiquidateAsyncOperation = () => {
    liquidateDocker(nearObject, {
      liquidate: true,
      forceClose: nearObject.NearConfig.forceClose,
      marginPosition: nearObject.NearConfig.marginPosition,
    }).then(() => {
      setTimeout(executeLiquidateAsyncOperation, nearObject.NearConfig.loopInterval);
    }).catch(error => {
      console.error('Liquidate failed:', error);
      setTimeout(executeLiquidateAsyncOperation, nearObject.NearConfig.loopInterval);
    })
  }
  executeLiquidateAsyncOperation();

  const executeRebalanceAsyncOperation = () => {
    rebalanceDocker(nearObject, true).then(() => {
      setTimeout(executeRebalanceAsyncOperation, nearObject.NearConfig.loopInterval);
    }).catch(error => {
      console.error('Rebalance failed:', error);
      setTimeout(executeRebalanceAsyncOperation, nearObject.NearConfig.loopInterval);
    })
  }
  executeRebalanceAsyncOperation();
})

