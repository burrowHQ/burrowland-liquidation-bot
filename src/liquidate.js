#!/usr/bin/env node

const { initNear } = require("./libs/near");
const { main: liquidate } = require("./libs/burrow");

initNear(true).then((nearObject) =>
  liquidate(nearObject, {
    liquidate: true,
    forceClose: nearObject.NearConfig.forceClose,
    marginPosition: nearObject.NearConfig.marginPosition,
  })
);
