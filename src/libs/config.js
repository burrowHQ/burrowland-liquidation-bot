const Big = require("big.js");
const fs = require('fs');

module.exports = {
  getConfig: (env) => {
    const config = (() => {
      switch (env) {
        case "production":
        case "mainnet":
          return {
            networkId: "mainnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.mainnet.near.org",
            walletUrl: "https://wallet.near.org",
            helperUrl: "https://helper.mainnet.near.org",
            explorerUrl: "https://explorer.mainnet.near.org",
            refFinanceContractId: "v2.ref-finance.near",
            priceOracleContractId: "priceoracle.near",
            pythOracleContractId: "pyth-oracle.near",
            burrowContractId: "contract.main.burrow.near",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.near",
            loopInterval: process.env.LOOP_INTERVAL || 30000,
            encodePrivateKey: process.env.ENCODE_PRIVATE_KEY
          };
        default:
          throw Error(
            `Unconfigured environment '${env}'. Can be configured in src/config.js.`
          );
      }
    })();
    config.minProfit = Big(process.env.MIN_PROFIT || "1.0");
    config.minDiscount = Big(process.env.MIN_DISCOUNT || "0.05");
    config.showWhales = !!process.env.SHOW_WHALES;
    config.minSwapAmount = Big(process.env.MIN_SWAP_AMOUNT || "1");
    config.minRepayAmount = Big(process.env.MIN_REPAY_AMOUNT || "0.5");
    config.maxSlippage = Big(process.env.MAX_SLIPPAGE || "0.5");
    config.maxLiquidationAmount = Big(
      process.env.MAX_LIQUIDATION_AMOUNT || "20000"
    );
    config.maxWithdrawCount = parseInt(process.env.MAX_WITHDRAW_COUNT || "5");
    config.forceClose = !!process.env.FORCE_CLOSE;
    config.marginPosition = !!process.env.MARGIN_POSITION;

    const customConfigData = fs.readFileSync('/app/config.json', 'utf8');
    const customConfig = JSON.parse(customConfigData);
    return Object.assign(config, {
      accountId: customConfig.accountId,
      encodePrivateKey: customConfig.encodePrivateKey,
      nodeUrl: customConfig.nodeUrl,
      minProfit: Big(customConfig.minProfit),
      minDiscount: Big(customConfig.minDiscount),
      maxLiquidationAmount: Big(customConfig.maxLiquidationAmount),
      loopInterval: customConfig.loopInterval
    });
  },
};
