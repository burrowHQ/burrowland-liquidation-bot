#!/usr/bin/env node

const { initNear } = require("./libs/near");
const { main: daily_check } = require("./libs/daily_check");

initNear(false).then((nearObject) =>
  daily_check(nearObject)
);
