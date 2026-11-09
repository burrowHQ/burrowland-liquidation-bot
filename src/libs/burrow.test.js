const test = require("node:test");
const assert = require("node:assert/strict");
const Big = require("big.js");

const { calcRealPricedProfit, assessLiquidationProfit } = require("./burrow");

const xrheaId = "xtoken.rhealab.near";
const usdcId = "usdc.near";
const lpId = "lp.near";
const assets = {
  [xrheaId]: { config: { extraDecimals: 0 } },
  [usdcId]: { config: { extraDecimals: 0 } },
  [lpId]: { config: { extraDecimals: 0 } },
};
const prices = {
  prices: {
    [xrheaId]: { multiplier: Big(1), decimals: 0 },
    [usdcId]: { multiplier: Big(1), decimals: 0 },
  },
};

const regularLiquidation = (inToken, inAmount, outToken, outAmount) => [{
  Liquidate: {
    position: "REGULAR",
    in_assets: [{ token_id: inToken, amount: String(inAmount) }],
    out_assets: [{ token_id: outToken, amount: String(outAmount) }],
  },
}];

test("immediate xRHEA exit turns an apparent liquidation profit into a loss", () => {
  const result = calcRealPricedProfit(regularLiquidation(usdcId, 100, xrheaId, 105), assets, prices, {}, xrheaId);
  const assessment = assessLiquidationProfit({
    totalPricedProfit: result.grossProfit,
    grossProfit: result.grossProfit,
    xrheaExitValue: result.xrheaExitValue,
    exitFeeBps: 1000,
    minProfit: Big(1),
    exemptFromMinProfit: true,
  });

  assert.equal(result.grossProfit.toString(), "5");
  assert.equal(result.xrheaExitValue.toString(), "105");
  assert.equal(assessment.realPricedProfit.toString(), "-5.5");
  assert.equal(assessment.profitable, false);
});

test("xRHEA collateral first offsets xRHEA debt; xRHEA debt alone has no exit fee", () => {
  const offset = calcRealPricedProfit(regularLiquidation(xrheaId, 100, xrheaId, 105), assets, prices, {}, xrheaId);
  const debtOnly = calcRealPricedProfit(regularLiquidation(xrheaId, 100, usdcId, 105), assets, prices, {}, xrheaId);
  const offsetProfit = assessLiquidationProfit({
    totalPricedProfit: offset.grossProfit,
    grossProfit: offset.grossProfit,
    xrheaExitValue: offset.xrheaExitValue,
    exitFeeBps: 1000,
    minProfit: Big(1),
    exemptFromMinProfit: false,
  });

  assert.equal(offset.xrheaExitValue.toString(), "5");
  assert.equal(offsetProfit.realPricedProfit.toString(), "4.5");
  assert.equal(offsetProfit.profitable, true);
  assert.equal(debtOnly.xrheaExitValue.toString(), "0");
  assert.equal(debtOnly.grossProfit.toString(), "5");
});

test("LP liquidation accounts for xRHEA received from its underlying tokens", () => {
  const actions = [{
    Liquidate: {
      position: lpId,
      in_assets: [{ token_id: usdcId, amount: "140" }],
      out_assets: [{ token_id: lpId, amount: "10" }],
    },
  }];
  const lpTokenInfos = {
    [lpId]: {
      decimals: 0,
      tokens: {
        0: { token_id: xrheaId, real_amount: "10" },
        1: { token_id: usdcId, real_amount: "5" },
      },
    },
  };

  const result = calcRealPricedProfit(actions, assets, prices, lpTokenInfos, xrheaId);
  const assessment = assessLiquidationProfit({
    totalPricedProfit: result.grossProfit,
    grossProfit: result.grossProfit,
    xrheaExitValue: result.xrheaExitValue,
    exitFeeBps: 1000,
    minProfit: Big(1),
    exemptFromMinProfit: false,
  });

  assert.equal(result.grossProfit.toString(), "10");
  assert.equal(result.xrheaExitValue.toString(), "100");
  assert.equal(assessment.realPricedProfit.toString(), "0");
  assert.equal(assessment.profitable, false);
});
