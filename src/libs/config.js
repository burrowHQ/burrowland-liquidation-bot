const Big = require("big.js");
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
            burrowContractId: process.env.BURROW_CONTRACT_ID || "contract.main.burrow.near",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.near",
            loopInterval: process.env.LOOP_INTERVAL || 5000,
            encodePrivateKey: process.env.ENCODE_PRIVATE_KEY,
            dataServiceUrl: process.env.DATA_SERVICE_URL,
            topN: process.env.TOPN || 50
          };
        case "development":
          return {
            networkId: "testnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.testnet.near.org",
            walletUrl: "https://wallet.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            refFinanceContractId: "dev-1704418570028-31304846290234",
            // refFinanceContractId: "ref-finance-101.testnet",
            priceOracleContractId: "dev-1700791085144-86637101874849",
            pythOracleContractId: "pyth-oracle.testnet",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "dev-1707132736890-13749887598327",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.testnet",
            marginRouter: {
              // "usdt.fakes.testnet&dai.fakes.testnet": {
              //   dex_id: "dev-1707134085683-95275841586061",
              //   dex_type: 1,
              //   pool_id: 0
              // },
              // "dai.fakes.testnet&usdt.fakes.testnet": {
              //   dex_id: "dev-1707134085683-95275841586061",
              //   dex_type: 1,
              //   pool_id: 0
              // },
              "usdt.fakes.testnet&dai.fakes.testnet": {
                dex_id: "dev-1707136746796-79997967772528",
                dex_type: 2,
                pool_ids: ["dai.fakes.testnet|usdt.fakes.testnet|100"]
              },
              "dai.fakes.testnet&usdt.fakes.testnet": {
                dex_id: "dev-1707136746796-79997967772528",
                dex_type: 2,
                pool_ids: ["dai.fakes.testnet|usdt.fakes.testnet|100"]
              },
            },
            loopInterval: process.env.LOOP_INTERVAL || 5000,
            encodePrivateKey: process.env.ENCODE_PRIVATE_KEY,
            dataServiceUrl: process.env.DATA_SERVICE_URL,
            topN: process.env.TOPN || 50
          };
        case "testnet_dev":
          return {
            networkId: "testnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.testnet.near.org",
            walletUrl: "https://wallet.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            refFinanceContractId: "exchange.ref-dev.testnet",
            priceOracleContractId: "mock-priceoracle.testnet",
            pythOracleContractId: "pyth-oracle.testnet",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "contract.dev-burrow.testnet",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.testnet",
            loopInterval: process.env.LOOP_INTERVAL || 5000,
            encodePrivateKey: process.env.ENCODE_PRIVATE_KEY,
            dataServiceUrl: process.env.DATA_SERVICE_URL,
            topN: process.env.TOPN || 50,
            marginRouter: {
              "wrap.testnet&usdcc.ft.ref-labs.testnet": {
                dex_id: "exchange.ref-dev.testnet",
                dex_type: 1,
                pool_id: 758
              },
              "usdcc.ft.ref-labs.testnet&wrap.testnet": {
                dex_id: "exchange.ref-dev.testnet",
                dex_type: 1,
                pool_id: 758
              },
              // "wrap.testnet&usdcc.ft.ref-labs.testnet": {
              //   dex_id: "dev-1707136746796-79997967772528",
              //   dex_type: 2,
              //   pool_ids: ["usdcc.ft.ref-labs.testnet|wrap.testnet|400"]
              // },
              // "usdcc.ft.ref-labs.testnet&wrap.testnet": {
              //   dex_id: "dev-1707136746796-79997967772528",
              //   dex_type: 2,
              //   pool_ids: ["usdcc.ft.ref-labs.testnet|wrap.testnet|400"]
              // },
              "wrap.testnet&usdte.ft.ref-labs.testnet": {
                dex_id: "exchange.ref-dev.testnet",
                dex_type: 1,
                pool_id: 726
              },
              "usdte.ft.ref-labs.testnet&wrap.testnet": {
                dex_id: "exchange.ref-dev.testnet",
                dex_type: 1,
                pool_id: 726
              },
            },
          };
        case "testnet_public":
          return {
            networkId: "testnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.testnet.near.org",
            walletUrl: "https://wallet.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            refFinanceContractId: "ref-finance-101.testnet",
            priceOracleContractId: "priceoracle.services.ref-labs.testnet",
            pythOracleContractId: "pyth-oracle.testnet",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "burrow.services.ref-labs.testnet",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.testnet",
            loopInterval: process.env.LOOP_INTERVAL || 5000,
            encodePrivateKey: process.env.ENCODE_PRIVATE_KEY,
            dataServiceUrl: process.env.DATA_SERVICE_URL,
            topN: process.env.TOPN || 50
          };
        default:
          throw Error(
            `Unconfigured environment '${env}'. Can be configured in src/config.js.`
          );
      }
    })();
    config.minProfit = Big(process.env.MIN_PROFIT || "1.0");
    config.minAdjustGap = Big(process.env.MIN_ADJUSTGAP || "0");
    config.minDiscount = Big(process.env.MIN_DISCOUNT || "0.025");
    config.showWhales = !!process.env.SHOW_WHALES;
    config.minSwapAmount = Big(process.env.MIN_SWAP_AMOUNT || "1");
    config.minRepayAmount = Big(process.env.MIN_REPAY_AMOUNT || "0.5");
    config.maxSlippage = Big(process.env.MAX_SLIPPAGE || "0.5");
    config.maxLiquidationAmount = Big(
      process.env.MAX_LIQUIDATION_AMOUNT || "20000"
    );
    config.stopLiquidationHealthFactor = Big(process.env.STOP_LIQUIDATION_HEALTH_FACTOR || "10");
    config.maxWithdrawCount = parseInt(process.env.MAX_WITHDRAW_COUNT || "5");
    config.liquidate = !!process.env.LIQUIDATE;
    config.forceClose = !!process.env.FORCE_CLOSE;
    config.marginLiquidate = !!process.env.MARGIN_LIQUIDATE;
    config.marginForceClose = !!process.env.MARGIN_FORCE_CLOSE;
    config.swapFailedLimit = process.env.SWAP_FAILED_LIMIT || 5;
    config.logLevel = process.env.LOG_LEVEL || 'info';
    return config;
  },
};
