const Big = require("big.js");

const generateMarginRouterV1 = (dex_id, details) => {
  const actions = details.map(([pool_id, token_in, token_out]) => {
    return {
      pool_id,
      token_in,
      token_out,
      min_amount_out: '0',
    }
  });
  return {
    dex_id,
    dex_type: 1,
    actions,
  }
}

const generateMarginRouterV2 = (dex_id, pool_ids) => {
  return {
    dex_id,
    dex_type: 2,
    pool_ids,
  }
}

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
            refFinanceContractId: process.env.REF_EXCHANGE_CONTRACT_ID || "v2.ref-finance.near",
            priceOracleContractId: process.env.PRICE_ORACLE_CONTRACT_ID || "priceoracle.near",
            pythOracleContractId: "pyth-oracle.near",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "contract.main.burrow.near",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.near",
          };
        case "development":
          return {
            networkId: "testnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.testnet.near.org",
            walletUrl: "https://wallet.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            refFinanceContractId: process.env.REF_EXCHANGE_CONTRACT_ID || "dev-1704418570028-31304846290234",
            // refFinanceContractId: "ref-finance-101.testnet",
            priceOracleContractId: process.env.PRICE_ORACLE_CONTRACT_ID || "dev-1700791085144-86637101874849",
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
              "usdt.fakes.testnet&dai.fakes.testnet": generateMarginRouterV2("dev-1707136746796-79997967772528", ["dai.fakes.testnet|usdt.fakes.testnet|100"]),
              "dai.fakes.testnet&usdt.fakes.testnet": generateMarginRouterV2("dev-1707136746796-79997967772528", ["dai.fakes.testnet|usdt.fakes.testnet|100"]),
            },
          };
        case "testnet_dev":
          return {
            networkId: "testnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.testnet.near.org",
            walletUrl: "https://wallet.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            refFinanceContractId: process.env.REF_EXCHANGE_CONTRACT_ID || "exchange.ref-dev.testnet",
            priceOracleContractId: process.env.PRICE_ORACLE_CONTRACT_ID || "mock-priceoracle.testnet",
            pythOracleContractId: "pyth-oracle.testnet",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "contract.dev-burrow.testnet",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.testnet",
            marginRouter: {
              "wrap.testnet&usdcc.ft.ref-labs.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [758, 'wrap.testnet', 'usdcc.ft.ref-labs.testnet'],
                ]),
              "usdcc.ft.ref-labs.testnet&wrap.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [758, 'usdcc.ft.ref-labs.testnet', 'wrap.testnet'], 
                ]),
              // "wrap.testnet&usdcc.ft.ref-labs.testnet": generateMarginRouterV2("refv2-dev.ref-dev.testnet", ["usdcc.ft.ref-labs.testnet|wrap.testnet|400"]),
              // "usdcc.ft.ref-labs.testnet&wrap.testnet": generateMarginRouterV2("refv2-dev.ref-dev.testnet", ["usdcc.ft.ref-labs.testnet|wrap.testnet|400"]),
              "wrap.testnet&usdte.ft.ref-labs.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [726, 'wrap.testnet', 'usdte.ft.ref-labs.testnet'],
                ]),
              "usdte.ft.ref-labs.testnet&wrap.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [726, 'usdte.ft.ref-labs.testnet', 'wrap.testnet'], 
                ]),
              "usdte.ft.ref-labs.testnet&token.dev-burrow.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [726, 'usdte.ft.ref-labs.testnet', 'wrap.testnet'], 
                  [759, 'wrap.testnet', 'token.dev-burrow.testnet'],
                ]),
              "token.dev-burrow.testnet&usdte.ft.ref-labs.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [759, 'token.dev-burrow.testnet', 'wrap.testnet'],
                  [726, 'wrap.testnet', 'usdte.ft.ref-labs.testnet'], 
                ]),
              "usdte.ft.ref-labs.testnet&willa.fakes.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [726, 'usdte.ft.ref-labs.testnet', 'wrap.testnet'], 
                  [459, 'wrap.testnet', 'willa.fakes.testnet'],
                ]),
              "willa.fakes.testnet&usdte.ft.ref-labs.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [459, 'willa.fakes.testnet', 'wrap.testnet'],
                  [726, 'wrap.testnet', 'usdte.ft.ref-labs.testnet'], 
                ]),
              "usdte.ft.ref-labs.testnet&lonk.fakes.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [726, 'usdte.ft.ref-labs.testnet', 'wrap.testnet'], 
                  [716, 'wrap.testnet', 'lonk.fakes.testnet'],
                ]),
              "lonk.fakes.testnet&usdte.ft.ref-labs.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [716, 'lonk.fakes.testnet', 'wrap.testnet'],
                  [726, 'wrap.testnet', 'usdte.ft.ref-labs.testnet'], 
                ]),

              "usdce.ft.ref-labs.testnet&token.dev-burrow.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [725, 'usdce.ft.ref-labs.testnet', 'wrap.testnet'], 
                  [759, 'wrap.testnet', 'token.dev-burrow.testnet'],
                ]),
              "token.dev-burrow.testnet&usdce.ft.ref-labs.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [759, 'token.dev-burrow.testnet', 'wrap.testnet'],
                  [725, 'wrap.testnet', 'usdce.ft.ref-labs.testnet'], 
                ]),
              "usdce.ft.ref-labs.testnet&willa.fakes.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [725, 'usdce.ft.ref-labs.testnet', 'wrap.testnet'], 
                  [459, 'wrap.testnet', 'willa.fakes.testnet'],
                ]),
              "willa.fakes.testnet&usdce.ft.ref-labs.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [459, 'willa.fakes.testnet', 'wrap.testnet'],
                  [725, 'wrap.testnet', 'usdce.ft.ref-labs.testnet'], 
                ]),
              "usdce.ft.ref-labs.testnet&lonk.fakes.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [725, 'usdce.ft.ref-labs.testnet', 'wrap.testnet'], 
                  [716, 'wrap.testnet', 'lonk.fakes.testnet'],
                ]),
              "lonk.fakes.testnet&usdce.ft.ref-labs.testnet": generateMarginRouterV1(
                "exchange.ref-dev.testnet",
                [
                  [716, 'lonk.fakes.testnet', 'wrap.testnet'],
                  [725, 'wrap.testnet', 'usdce.ft.ref-labs.testnet'], 
                ]),
            },
          };
        case "testnet_public":
          return {
            networkId: "testnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.testnet.near.org",
            walletUrl: "https://wallet.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            refFinanceContractId: process.env.REF_EXCHANGE_CONTRACT_ID || "ref-finance-101.testnet",
            priceOracleContractId: process.env.PRICE_ORACLE_CONTRACT_ID || "priceoracle.services.ref-labs.testnet",
            pythOracleContractId: "pyth-oracle.testnet",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "burrow.services.ref-labs.testnet",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.testnet",
          };
        default:
          throw Error(
            `Unconfigured environment '${env}'. Can be configured in src/config.js.`
          );
      }
    })();
    // regular & margin & rebalance
    config.logLevel = process.env.LOG_LEVEL || 'info';
    config.loopInterval = process.env.LOOP_INTERVAL || 5000;
    config.encodePrivateKey = process.env.ENCODE_PRIVATE_KEY;

    // regular & margin
    config.minProfit = Big(process.env.MIN_PROFIT || "1.0");

    // regular
    config.minAdjustGap = Big(process.env.MIN_ADJUSTGAP || "0");
    config.minDiscount = Big(process.env.MIN_DISCOUNT || "0.025");
    config.maxLiquidationAmount = Big(
      process.env.MAX_LIQUIDATION_AMOUNT || "20000"
    );
    config.stopLiquidationHealthFactor = Big(process.env.STOP_LIQUIDATION_HEALTH_FACTOR || "10");
    config.maxWithdrawCount = parseInt(process.env.MAX_WITHDRAW_COUNT || "5");
    config.liquidate = process.env.LIQUIDATE == 'true' || false;
    // if forceClose is true, minAdjustGap must set to zero.
    config.forceClose = process.env.FORCE_CLOSE == 'true' || false;
    config.topN = process.env.TOPN || 50;
    config.dataServiceUrl = process.env.DATA_SERVICE_URL;
    config.regularPagedLimit = parseInt(process.env.REGULAR_PAGED_LIMIT) || 150;

    // margin
    config.marginLiquidate = process.env.MARGIN_LIQUIDATE == 'true' || false;
    config.marginForceClose = process.env.MARGIN_FORCE_CLOSE == 'true' || false;
    config.marginDataServiceUrl = process.env.MARGIN_DATA_SERVICE_URL;
    config.marginTopN = process.env.MARGIN_TOPN || 50;
    config.marginPagedLimit = parseInt(process.env.MARGIN_PAGED_LIMIT) || 150;

    // rebalance
    config.minSwapAmount = Big(process.env.MIN_SWAP_AMOUNT || "1");
    config.minRepayAmount = Big(process.env.MIN_REPAY_AMOUNT || "0.5");
    config.maxSlippage = Big(process.env.MAX_SLIPPAGE || "0.5");
    config.swapFailedLimit = process.env.SWAP_FAILED_LIMIT || 5;

    return config;
  },
};
