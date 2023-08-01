#!/usr/bin/env node

const { initNear } = require("./libs/near");
const { main } = require("./libs/burrow");

initNear(true).then((nearObject) =>
  main(nearObject, {
    liquidate: false,
    forceClose: false,
    export2db: true,
  })
);
