const nearAPI = require("near-api-js");
const os = require("os");

const { getConfig } = require("./config");
const path = require("path");
const { decryptAES } = require("./utils");

const NearConfig = getConfig(process.env.NEAR_ENV || "development");

module.exports = {
  initNear: async (loadAccount, password) => {
    const keyStore = new nearAPI.keyStores.InMemoryKeyStore();

    let near;
    let account;

    if (loadAccount) {
      if (NearConfig.encodePrivateKey) {
        const privateKey = decryptAES(NearConfig.encodePrivateKey, password);
        if (privateKey == '') {
          console.error("Invalid password");
          process.exit(1);
        }
        const keyPair = nearAPI.KeyPair.fromString(privateKey);
        const keyStore = new nearAPI.keyStores.InMemoryKeyStore();
        keyStore.setKey(NearConfig.networkId, NearConfig.accountId, keyPair);
        const connection = nearAPI.Connection.fromConfig({
          networkId: NearConfig.networkId,
          provider: { type: "JsonRpcProvider", args: { url: NearConfig.nodeUrl } },
          signer: { type: "InMemorySigner", keyStore },
          jsvmAccountId: `jsvm.${NearConfig.networkId}`,
        });
        account = new nearAPI.Account(connection, NearConfig.accountId);
      } else {
        console.error("Missing encodePrivateKey");
        process.exit(1);
      }
    } else {
      const nearRpc = new nearAPI.providers.JsonRpcProvider(NearConfig.nodeUrl);
      account = new nearAPI.Account(
        {
          provider: nearRpc,
          networkId: NearConfig.networkId,
          signer: NearConfig.accountId,
        },
        NearConfig.accountId
      );
    }

    const tokenContract = (tokenAccountId) =>
      new nearAPI.Contract(account, tokenAccountId, {
        viewMethods: [
          "storage_balance_of",
          "ft_balance_of",
          "storage_balance_bounds",
          "ft_metadata",
        ],
        changeMethods: ["ft_transfer_call", "ft_transfer", "storage_deposit"],
      });

    const refFinanceContract = new nearAPI.Contract(
      account,
      NearConfig.refFinanceContractId,
      {
        viewMethods: [
          "get_deposits",
          "get_pools",
          "get_pool",
          "get_return",
          "get_number_of_pools",
          "get_deposit",
          "list_rated_tokens",
          "get_unit_share_token_amounts",
          "get_frozenlist_tokens"
        ],
        changeMethods: ["storage_deposit", "swap", "withdraw"],
      }
    );

    const burrowContract = new nearAPI.Contract(
      account,
      NearConfig.burrowContractId,
      {
        viewMethods: [
          "get_account",
          "get_num_accounts",
          "get_accounts_paged",
          "get_asset",
          "get_assets",
          "get_assets_paged",
          "get_assets_paged_detailed",
          "get_config",
          "get_asset_farm",
          "get_asset_farms",
          "get_asset_farms_paged",
          "get_last_lp_token_infos",
          "get_margin_account",
          "get_margin_accounts_paged",
          "get_num_margin_accounts",
          "get_all_token_pyth_infos",
          "get_margin_config"
        ],
        changeMethods: ["storage_deposit", "execute", "margin_execute"],
      }
    );

    const priceOracleContract = new nearAPI.Contract(
      account,
      NearConfig.priceOracleContractId,
      {
        viewMethods: ["get_price_data"],
        changeMethods: ["oracle_call"],
      }
    );

    const pythOracleContract = new nearAPI.Contract(
      account,
      NearConfig.pythOracleContractId,
      {
        viewMethods: ["get_price", "get_price_no_older_than"],
      }
    );

    return {
      near,
      account,
      tokenContract,
      refFinanceContract,
      burrowContract,
      priceOracleContract,
      pythOracleContract,
      NearConfig,
    };
  },
};
