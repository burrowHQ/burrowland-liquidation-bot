const Big = require("big.js");
const { keysToCamel, PYTH_STALENESS_THRESHOLD } = require("./utils");
const { parseAsset } = require("./asset");
const { parsePriceData } = require("./priceData");
const {
  parseAccount,
  processAccount,
} = require("./account");

const fs = require("fs");


Big.DP = 27;

const getPythPrices = async (account, burrowContract, pythOracleContract) => {
  const token_pyth_infos = await burrowContract.get_all_token_pyth_infos();
  let prices = {};
  for (const [assetId, pythInfo] of Object.entries(token_pyth_infos)) {
    if (pythInfo.default_price == null) {
      let pythPrice = await pythOracleContract.get_price_no_older_than({"price_id": pythInfo.price_identifier, "age": PYTH_STALENESS_THRESHOLD});
      // console.log(JSON.stringify(pythPrice, undefined, 2));
      if (pythInfo.extra_call == null) {
        prices[assetId] = {
          "multiplier": Big(pythPrice.price).mul(Big(10).pow(pythPrice.expo)).mul(Big(10).pow(pythInfo.fraction_digits)).round(0),
          "decimals": pythInfo.fraction_digits + pythInfo.decimals
        };
      } else {
        let price = await account.viewFunction(assetId, pythInfo.extra_call, {});
        prices[assetId] = {
          "multiplier": Big(pythPrice.price).mul(Big(10).pow(pythPrice.expo)).mul(Big(price)).div(Big(10).pow(24)).mul(Big(10).pow(pythInfo.fraction_digits)).round(0),
          "decimals": pythInfo.fraction_digits + pythInfo.decimals
        };
      }
    } else {
      prices[assetId] = {
        "multiplier": Big(pythInfo.default_price.multiplier),
        "decimals": pythInfo.default_price.decimals
      }
    }
  }
  return {"prices": prices}
}

const getPriceOralcePrices = async (priceOracleContract, assets) => {
  const rawPriceData = keysToCamel(await priceOracleContract.get_price_data({
    asset_ids: Object.keys(assets),
  }));
  return parsePriceData(rawPriceData)
}

module.exports = {
  main: async (nearObjects) => {
    const { account, burrowContract, refFinanceContract, priceOracleContract, pythOracleContract, NearConfig } = nearObjects;

    const rawAssets = keysToCamel(await burrowContract.get_assets_paged());
    const assets = rawAssets.reduce((assets, [assetId, asset]) => {
      assets[assetId] = parseAsset(asset);
      return assets;
    }, {});

    const burrow_config = await burrowContract.get_config();

    let lp_token_infos = await burrowContract.get_last_lp_token_infos();
    for (var shadow_token_id in lp_token_infos) {
      const pool_id = shadow_token_id.split("-")[1];
      const unit_share_token_amounts = await refFinanceContract.get_unit_share_token_amounts({pool_id: parseInt(pool_id)})
      Object.entries(unit_share_token_amounts).forEach(([index, value]) => {
        lp_token_infos[shadow_token_id].tokens[index]['real_amount'] = value
      });
    }

    const numAccountsStr = await burrowContract.get_num_accounts();
    const numAccounts = parseInt(numAccountsStr);

    const prices = burrow_config.enable_price_oracle ? await getPriceOralcePrices(priceOracleContract, assets) : await getPythPrices(account, burrowContract, pythOracleContract);
    console.log("burrow total accounts num: ", numAccounts);
    const limit = 40;

    const promises = [];
    for (let i = 0; i < numAccounts; i += limit) {
      promises.push(
        burrowContract.get_accounts_paged({ from_index: i, limit })
      );
    }

    const accounts = (await Promise.all(promises))
      .flat()
      .map((a) => parseAccount(a))
      .flat()
      .map((a) => processAccount(a, assets, prices, lp_token_infos))
      .filter((a) => !!a.healthFactor)
      .filter((a) => a.healthFactor.lt(1))

    console.log("healthFactor < 1 accounts num: ", accounts.length);
    
    accounts.sort((a, b) => {
      return a.healthFactor.cmp(b.healthFactor);
    });

    const sort_by_health_factor_list = []
    for (const a of accounts) {
      sort_by_health_factor_list.push(
        `
          ${a.accountId.padEnd(64)} ${a.position.padEnd(20)} 
          -> healthFactor: ${a.healthFactor.mul(100).toFixed(2).padEnd(6)}% 
          -> collateralSum: ${a.collateralSum.toFixed(2).padEnd(20)}
          -> borrowedSum: ${a.borrowedSum.toFixed(2).padEnd(20)}
          -> gapSum: ${(a.collateralSum - a.borrowedSum).toFixed(2).padEnd(20)}
          -> adjustedCollateralSum: ${a.adjustedCollateralSum.toFixed(2).padEnd(20)}
          -> adjustedBorrowedSum: ${a.adjustedBorrowedSum.toFixed(2).padEnd(20)}
          -> adjustedGapSum: ${(a.adjustedCollateralSum - a.adjustedBorrowedSum).toFixed(2).padEnd(20)}
        `
      )
    }
    const sort_by_health_factor_str = JSON.stringify(sort_by_health_factor_list, undefined, 2);
    fs.writeFile("./data/sort_by_health_factor.json", sort_by_health_factor_str, function (err) {
      if (err) {
        console.log('Save sort_by_health_factor.json failed: ', err);
      } else {
        console.log(`File sort_by_health_factor.json saved`);
      }
    });

    accounts.sort((a, b) => {
      return b.adjustedBorrowedSum.cmp(a.adjustedBorrowedSum);
    });

    const sort_by_adjusted_borrowed_sum_list = []
    for (const a of accounts) {
      sort_by_adjusted_borrowed_sum_list.push(
        `
          ${a.accountId.padEnd(64)} ${a.position.padEnd(20)} 
          -> healthFactor: ${a.healthFactor.mul(100).toFixed(2).padEnd(6)}% 
          -> collateralSum: ${a.collateralSum.toFixed(2).padEnd(20)}
          -> borrowedSum: ${a.borrowedSum.toFixed(2).padEnd(20)}
          -> gapSum: ${(a.collateralSum - a.borrowedSum).toFixed(2).padEnd(20)}
          -> adjustedCollateralSum: ${a.adjustedCollateralSum.toFixed(2).padEnd(20)}
          -> adjustedBorrowedSum: ${a.adjustedBorrowedSum.toFixed(2).padEnd(20)}
          -> adjustedGapSum: ${(a.adjustedCollateralSum - a.adjustedBorrowedSum).toFixed(2).padEnd(20)}
        `
      )
    }
    const sort_by_adjusted_borrowed_sum_str = JSON.stringify(sort_by_adjusted_borrowed_sum_list, undefined, 2);
    fs.writeFile("./data/sort_by_adjusted_borrowed_sum.json", sort_by_adjusted_borrowed_sum_str, function (err) {
      if (err) {
        console.log('Save sort_by_adjusted_borrowed_sum.json failed: ', err);
      } else {
        console.log(`File sort_by_adjusted_borrowed_sum.json saved`);
      }
    });
  },
};
