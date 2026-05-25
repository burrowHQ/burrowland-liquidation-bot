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
            refFinanceContractId: process.env.REF_EXCHANGE_CONTRACT_ID || "v2.ref-finance.near",
            dclContractId: process.env.DCL_CONTRACT_ID || "dclv2.ref-labs.near",
            priceOracleContractId: process.env.PRICE_ORACLE_CONTRACT_ID || "priceoracle.near",
            pythOracleContractId: process.env.PYTH_ORACLE_CONTRACT_ID || "pyth-oracle.near",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "contract.main.burrow.near",
            rheaContractId: process.env.RHEA_CONTRACT_ID || "token.rhealab.near",
            xrheaContractId: process.env.XRHEA_CONTRACT_ID || "xtoken.rhealab.near",
            rnearContractId: process.env.RNEAR_CONTRACT_ID || "lst.rhealab.near",
            linearContractId: process.env.LINEAR_CONTRACT_ID || "linear-protocol.near",
            stnearContractId: process.env.STNEAR_CONTRACT_ID || "meta-pool.near",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.near",
            smartrouterUrl: process.env.SMARTRROUTER_URL || "https://smartrouter-inner.rhea.finance",
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
            dclContractId: process.env.DCL_CONTRACT_ID || "refv2-dev.ref-dev.testnet",
            priceOracleContractId: process.env.PRICE_ORACLE_CONTRACT_ID || "dev-1700791085144-86637101874849",
            pythOracleContractId: process.env.PYTH_ORACLE_CONTRACT_ID || "pyth-oracle.testnet",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "dev-1707132736890-13749887598327",
            rheaContractId: process.env.RHEA_CONTRACT_ID || "rhea-dev.testnet",
            xrheaContractId: process.env.XRHEA_CONTRACT_ID || "xrhea-dev.testnet",
            rnearContractId: process.env.RNEAR_CONTRACT_ID || "lst.ref-dev.testnet",
            linearContractId: process.env.LINEAR_CONTRACT_ID || "linear-protocol.testnet",
            stnearContractId: process.env.STNEAR_CONTRACT_ID || "meta-v2.pool.testnet",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.testnet",
            smartrouterUrl: process.env.SMARTRROUTER_URL || "https://smartrouterdev.refburrow.top",
          };
        case "testnet_dev":
          return {
            networkId: "testnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.testnet.near.org",
            walletUrl: "https://wallet.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            refFinanceContractId: process.env.REF_EXCHANGE_CONTRACT_ID || "exchange.ref-dev.testnet",
            dclContractId: process.env.DCL_CONTRACT_ID || "refv2-dev.ref-dev.testnet",
            priceOracleContractId: process.env.PRICE_ORACLE_CONTRACT_ID || "mock-priceoracle.testnet",
            pythOracleContractId: process.env.PYTH_ORACLE_CONTRACT_ID || "pyth-oracle.testnet",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "contract.dev-burrow.testnet",
            rheaContractId: process.env.RHEA_CONTRACT_ID || "rhea-dev.testnet",
            xrheaContractId: process.env.XRHEA_CONTRACT_ID || "xrhea-dev.testnet",
            rnearContractId: process.env.RNEAR_CONTRACT_ID || "lst.ref-dev.testnet",
            linearContractId: process.env.LINEAR_CONTRACT_ID || "linear-protocol.testnet",
            stnearContractId: process.env.STNEAR_CONTRACT_ID || "meta-v2.pool.testnet",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.testnet",
            smartrouterUrl: process.env.SMARTRROUTER_URL || "https://smartrouterdev.refburrow.top",
          };
        case "testnet_public":
          return {
            networkId: "testnet",
            nodeUrl: process.env.NODE_URL || "https://rpc.testnet.near.org",
            walletUrl: "https://wallet.testnet.near.org",
            helperUrl: "https://helper.testnet.near.org",
            explorerUrl: "https://explorer.testnet.near.org",
            refFinanceContractId: process.env.REF_EXCHANGE_CONTRACT_ID || "ref-finance-101.testnet",
            dclContractId: process.env.DCL_CONTRACT_ID || "dclv2.ref-dev.testnet",
            priceOracleContractId: process.env.PRICE_ORACLE_CONTRACT_ID || "priceoracle.services.ref-labs.testnet",
            pythOracleContractId: process.env.PYTH_ORACLE_CONTRACT_ID || "pyth-oracle.testnet",
            burrowContractId: process.env.BURROW_CONTRACT_ID || "burrow.services.ref-labs.testnet",
            rheaContractId: process.env.RHEA_CONTRACT_ID || "rhea-dev.testnet",
            xrheaContractId: process.env.XRHEA_CONTRACT_ID || "xrhea-dev.testnet",
            rnearContractId: process.env.RNEAR_CONTRACT_ID || "lst.ref-dev.testnet",
            linearContractId: process.env.LINEAR_CONTRACT_ID || "linear-protocol.testnet",
            stnearContractId: process.env.STNEAR_CONTRACT_ID || "meta-v2.pool.testnet",
            accountId: process.env.NEAR_ACCOUNT_ID,
            wrapNearAccountId: "wrap.testnet",
            smartrouterUrl: process.env.SMARTRROUTER_URL || "https://smartroutertest.refburrow.top",
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
    config.txSigningMode = process.env.NEAR_TX_SIGNING_MODE || 'local';
    config.remoteSignerUrl = process.env.REMOTE_SIGNER_URL;
    config.remoteSignerMethod = process.env.REMOTE_SIGNER_METHOD || 'sign_transaction';
    config.remoteSignerApiKey = process.env.REMOTE_SIGNER_API_KEY;
    config.remoteSignerTimeoutMs = parseInt(process.env.REMOTE_SIGNER_TIMEOUT_MS || '10000');
    config.heartbeatUrl = process.env.HEARTBEAT_URL;
    config.slackHookUrl = process.env.SLACK_HOOK_URL;
    config.slackHookMentions = (process.env.SLACK_HOOK_MENTIONS || "")
      .split(",")
      .map((mention) => mention.trim())
      .filter((mention) => mention.length > 0);

    // regular & margin
    config.minProfit = Big(process.env.MIN_PROFIT || "1.0");

    // regular
    config.minProfitExemptBorrowedValue = Big(process.env.MIN_PROFIT_EXEMPT_BORROWED_VALUE || "10");
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
    config.marginLiquidateDirectMode = process.env.MARGIN_LIQUIDATE_DIRECT_MODE == 'true' || false;
    config.marginForceClose = process.env.MARGIN_FORCE_CLOSE == 'true' || false;
    config.marginForceCloseMinLoss = Big(process.env.MARGIN_FORCE_CLOSE_MIN_LOSS || "1");
    config.marginDataServiceUrl = process.env.MARGIN_DATA_SERVICE_URL;
    config.marginTopN = process.env.MARGIN_TOPN || 50;
    config.marginPagedLimit = parseInt(process.env.MARGIN_PAGED_LIMIT) || 150;

    // stop keeper
    config.stopKeeper = process.env.STOP_KEEPER == 'true' || false;
    // Offset in BPS (0-5000), clamped to valid range to prevent logic inversion
    config.stopKeeperOffsetBps = Math.min(Math.max(parseInt(process.env.STOP_KEEPER_OFFSET_BPS) || 0, 0), 5000);
    // Interest buffer rate for short position debt coverage (e.g. 0.995 = 0.5% buffer)
    config.interestBufferRate = Big(process.env.INTEREST_BUFFER_RATE || "0.995");

    // rebalance
    config.minSwapAmount = Big(process.env.MIN_SWAP_AMOUNT || "1");
    config.minRepayAmount = Big(process.env.MIN_REPAY_AMOUNT || "0.5");
    config.maxSlippage = Big(process.env.MAX_SLIPPAGE || "0.5");
    config.swapFailedLimit = process.env.SWAP_FAILED_LIMIT || 5;

    config.nearIntents = {
      apiBaseUrl: (process.env.NEAR_INTENTS_API_BASE_URL || 'https://1click.chaindefuser.com').replace(/\/$/, ''),
      jwt: process.env.NEAR_INTENTS_JWT,
      slippageBps: parseInt(process.env.NEAR_INTENTS_SLIPPAGE_BPS || '50'),
      quoteTimeoutMs: parseInt(process.env.NEAR_INTENTS_QUOTE_TIMEOUT_MS || '10000'),
      statusTimeoutMs: parseInt(process.env.NEAR_INTENTS_STATUS_TIMEOUT_MS || '120000'),
      statusPollIntervalMs: parseInt(process.env.NEAR_INTENTS_STATUS_POLL_INTERVAL_MS || '2000'),
    };

    return config;
  },
};
