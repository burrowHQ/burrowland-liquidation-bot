#!/usr/bin/env node

const { initNear } = require("./libs/near");
const { main: liquidate } = require("./libs/burrow");
const readlineSync = require('readline-sync');

function getPassword() {
  return readlineSync.question('Please enter your password: ', {
    hideEchoBack: true
  });
}

initNear(true, getPassword()).then((nearObject) => {
  const executeAsyncOperation = () => {
    liquidate(nearObject, {
      liquidate: true,
      forceClose: nearObject.NearConfig.forceClose,
      marginPosition: nearObject.NearConfig.marginPosition,
    }).then(() => {
      setTimeout(executeAsyncOperation, nearObject.NearConfig.loopInterval);
    }).catch(error => {
      console.error('Liquidate failed:', error);
      setTimeout(executeAsyncOperation, nearObject.NearConfig.loopInterval);
    })
  }
  executeAsyncOperation();
})

