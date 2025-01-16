const { parseTimestamp, PYTH_STALENESS_THRESHOLD, keysToCamel } = require("./utils");
const Big = require("big.js");

const parsePrice = (p) => {
  return p
    ? {
        multiplier: Big(p.multiplier),
        decimals: p.decimals,
      }
    : null;
};

const parsePriceData = (r) => {
  return Object.assign(r, {
    timestamp: parseTimestamp(r.timestamp),
    prices: r.prices.reduce((prices, ap) => {
      prices[ap.assetId] = parsePrice(ap.price);
      return prices;
    }, {}),
  });
};

const getPythPrices = async (account, burrowContract, pythOracleContract) => {
  const token_pyth_infos = await burrowContract.get_all_token_pyth_infos();
  let prices = {};
  for (const [assetId, pythInfo] of Object.entries(token_pyth_infos)) {
    if (pythInfo.default_price == null) {
      let pythPrice = await pythOracleContract.get_price_no_older_than({ "price_id": pythInfo.price_identifier, "age": PYTH_STALENESS_THRESHOLD });
      // console.log(JSON.stringify(pythPrice, undefined, 2));
      if (pythInfo.extra_call == null) {
        prices[assetId] = {
          "multiplier": Big(pythPrice.price).mul(Big(10).pow(pythPrice.expo)).mul(Big(10).pow(pythInfo.fraction_digits)).round(0),
          "decimals": pythInfo.fraction_digits + pythInfo.decimals
        };
      } else {
        let price = await account.viewFunction({
          contractId: assetId, 
          methodName: pythInfo.extra_call
        });
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
  return { "prices": prices }
}

const getPriceOralcePrices = async (priceOracleContract, assets) => {
  const rawPriceData = keysToCamel(await priceOracleContract.get_price_data({
    asset_ids: Object.keys(assets),
  }));
  return parsePriceData(rawPriceData)
}

module.exports = {
  parsePriceData,
  getPythPrices,
  getPriceOralcePrices,
};
