//! The code below is based on skyward finance https://github.com/skyward-finance/app-ui.

const Big = require("big.js");
const { loadJson, saveJson, keysToCamel } = require("./utils");

const SimplePool = "SIMPLE_POOL";
const StablePool = "STABLE_SWAP";
const RatedPool = "RATED_SWAP";

const TokenCacheFilename = "./data/tokens.json";

const OneNear = Big(10).pow(24);

const tokenDecimals = {
  "6b175474e89094c44da98b954eedeac495271d0f.factory.bridge.near": 18,
  "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near": 6,
  "dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near": 6,
  usn: 18,
  "2260fac5e5542a773aa44fbcfedf7c193bc2c599.factory.bridge.near": 8,
  "0316eb71485b0ab14103307bf65a021042c6d380.factory.bridge.near": 18,
  "meta-pool.near": 24,
  "linear-protocol.near": 24,
  "wrap.near": 24,
};

let tokenCache = null;

async function fetchUsdTokensDecimals(tokenContract, tokenId) {
  if (tokenId in tokenDecimals) {
    return;
  }
  if (!tokenCache) {
    tokenCache = loadJson(TokenCacheFilename) || {};
  }
  if (!(tokenId in tokenCache)) {
    try {
      const token = tokenContract(tokenId);
      tokenCache[tokenId] = keysToCamel(await token.ft_metadata());
    } catch (e) {
      console.log("Failed to fetch metadata for token", tokenId);
      tokenCache[tokenId] = false;
    } finally {
      saveJson(tokenCache, TokenCacheFilename);
    }
  }
  tokenDecimals[tokenId] = tokenCache[tokenId]?.decimals || 18;
}

function stablePoolGetReturn(pool, tokenIn, amountIn, tokenOut) {
  let tokenInIndex = pool.tt.indexOf(tokenIn);
  let tokenOutIndex = pool.tt.indexOf(tokenOut);
  // Sub 1
  const cAmountIn = amountIn
    .sub(1)
    .mul(Big(10).pow(18 - tokenDecimals[tokenIn]))
    .mul(pool.rates[tokenInIndex])
    .div(OneNear);

  let y = stablePoolComputeY(
    pool,
    cAmountIn.add(pool.cAmounts[tokenInIndex]),
    tokenInIndex,
    tokenOutIndex
  );

  let dy = pool.cAmounts[tokenOutIndex].sub(y);
  let tradeFee = dy.mul(pool.fee).div(10000).round(0, 0);
  let amountSwapped = dy.sub(tradeFee);

  return amountSwapped
    .div(Big(10).pow(18 - tokenDecimals[tokenOut]))
    .mul(OneNear)
    .div(pool.rates[tokenOutIndex])
    .round(0, 0);
}

function stablePoolGetInverseReturn(pool, tokenOut, amountOut, tokenIn) {
  let tokenInIndex = pool.tt.indexOf(tokenIn);
  let tokenOutIndex = pool.tt.indexOf(tokenOut);

  const amountOutWithFee = amountOut
    .mul(10000)
    .div(10000 - pool.fee)
    .round(0, 0);
  const cAmountOut = amountOutWithFee
    .mul(Big(10).pow(18 - tokenDecimals[tokenOut]))
    .mul(pool.rates[tokenOutIndex])
    .div(OneNear);

  let y = stablePoolComputeY(
    pool,
    pool.cAmounts[tokenOutIndex].sub(cAmountOut),
    tokenOutIndex,
    tokenInIndex
  );

  let cAmountIn = y.sub(pool.cAmounts[tokenInIndex]);

  // Adding 1 for internal pool rounding
  return cAmountIn
    .div(Big(10).pow(18 - tokenDecimals[tokenIn]))
    .mul(OneNear)
    .div(pool.rates[tokenInIndex])
    .add(1)
    .round(0, 0);
}

function getRefReturn(pool, tokenIn, amountIn, tokenOut) {
  if (!amountIn || amountIn.eq(0)) {
    return Big(0);
  }
  if (
    !(tokenIn in pool.tokens) ||
    !(tokenOut in pool.tokens) ||
    tokenIn === tokenOut
  ) {
    return null;
  }
  if (pool.stable) {
    return stablePoolGetReturn(pool, tokenIn, amountIn, tokenOut);
  }
  const balanceIn = pool.tokens[tokenIn];
  const balanceOut = pool.tokens[tokenOut];
  let amountWithFee = Big(amountIn).mul(Big(10000 - pool.fee));
  return amountWithFee
    .mul(balanceOut)
    .div(Big(10000).mul(balanceIn).add(amountWithFee))
    .round(0, 0);
}

function getRefInverseReturn(pool, tokenOut, amountOut, tokenIn) {
  if (!amountOut || amountOut.eq(0)) {
    return Big(0);
  }
  if (
    !(tokenIn in pool.tokens) ||
    !(tokenOut in pool.tokens) ||
    tokenIn === tokenOut
  ) {
    return null;
  }
  if (pool.stable) {
    return stablePoolGetInverseReturn(pool, tokenOut, amountOut, tokenIn);
  }
  const balanceIn = pool.tokens[tokenIn];
  const balanceOut = pool.tokens[tokenOut];
  if (amountOut.gte(balanceOut)) {
    return null;
  }
  return Big(10000)
    .mul(balanceIn)
    .mul(amountOut)
    .div(Big(10000 - pool.fee).mul(balanceOut.sub(amountOut)))
    .round(0, 3);
}

function stablePoolComputeD(pool) {
  let sumX = pool.cAmounts.reduce((sum, v) => sum.add(v), Big(0));
  if (sumX.eq(0)) {
    return Big(0);
  } else {
    let d = sumX;
    let dPrev;

    for (let i = 0; i < 256; ++i) {
      let dProd = d;
      for (let j = 0; j < pool.nCoins; ++j) {
        dProd = dProd.mul(d).div(pool.cAmounts[j].mul(pool.nCoins)).round(0, 0);
      }
      dPrev = d;

      let leverage = sumX.mul(pool.ann);
      let numerator = dPrev.mul(dProd.mul(pool.nCoins).add(leverage));
      let denominator = dPrev
        .mul(pool.ann.sub(1))
        .add(dProd.mul(pool.nCoins + 1));
      d = numerator.div(denominator).round(0, 0);

      // Equality with the precision of 1
      if (d.gt(dPrev)) {
        if (d.sub(dPrev).lte(1)) {
          break;
        }
      } else if (dPrev.sub(d).lte(1)) {
        break;
      }
    }
    return d;
  }
}

function stablePoolComputeY(pool, xCAmount, indexX, indexY) {
  // invariant
  let d = pool.d;
  let s = xCAmount;
  let c = d.mul(d).div(xCAmount).round(0, 0);
  pool.cAmounts.forEach((c_amount, idx) => {
    if (idx !== indexX && idx !== indexY) {
      s = s.add(c_amount);
      c = c.mul(d).div(c_amount).round(0, 0);
    }
  });
  c = c.mul(d).div(pool.ann.mul(pool.nn)).round(0, 0);
  let b = d.div(pool.ann).round(0, 0).add(s); // d will be subtracted later

  // Solve for y by approximating: y**2 + b*y = c
  let yPrev;
  let y = d;
  for (let i = 0; i < 256; ++i) {
    yPrev = y;
    // $ y_{k+1} = \frac{y_k^2 + c}{2y_k + b - D} $
    let yNumerator = y.pow(2).add(c);
    let yDenominator = y.mul(2).add(b).sub(d);
    y = yNumerator.div(yDenominator).round(0, 0);
    if (y.gt(yPrev)) {
      if (y.sub(yPrev).lte(1)) {
        break;
      }
    } else if (yPrev.sub(y).lte(1)) {
      break;
    }
  }
  return y;
}

async function prepareRef(nearObjects) {
  const { near, refFinanceContract, NearConfig, tokenContract } = nearObjects;

  const limit = 250;
  // Limit pools for now until we need other prices.
  const [rawNumPools, ratedTokens] = await Promise.all([
    refFinanceContract.get_number_of_pools(),
    refFinanceContract.list_rated_tokens(),
  ]);

  const numPools = Math.min(10000, rawNumPools);
  Object.values(ratedTokens).forEach((r) => {
    r.rate_price = Big(r.rate_price);
  });
  ratedTokens[NearConfig.wrapNearAccountId] = {
    rate_price: OneNear,
  };
  const promises = [];
  for (let i = 0; i < numPools; i += limit) {
    promises.push(refFinanceContract.get_pools({ from_index: i, limit }));
  }
  const rawPools = (await Promise.all(promises)).flat();

  const poolsByToken = {};
  const poolsByPair = {};

  const addPools = (token, pool) => {
    let ps = poolsByToken[token] || [];
    ps.push(pool);
    poolsByToken[token] = ps;

    pool.ots[token].forEach((ot) => {
      const pair = `${token}:${ot}`;
      ps = poolsByPair[pair] || [];
      ps.push(pool);
      poolsByPair[pair] = ps;
    });
  };

  const pools = {};
  for (let i = 0; i < rawPools.length; ++i) {
    const pool = rawPools[i];
    if (
      pool.pool_kind === SimplePool ||
      pool.pool_kind === StablePool ||
      pool.pool_kind === RatedPool
    ) {
      const tt = pool.token_account_ids;
      const p = {
        stable: pool.pool_kind === StablePool || pool.pool_kind === RatedPool,
        index: i,
        tt,
        tokens: tt.reduce((acc, token, tokenIndex) => {
          acc[token] = Big(pool.amounts[tokenIndex]);
          return acc;
        }, {}),
        ots: tt.reduce((acc, token) => {
          acc[token] = tt.filter((t) => t !== token);
          return acc;
        }, {}),
        fee: pool.total_fee,
        shares: Big(pool.shares_total_supply),
        amp: pool.amp || 0,
      };
      if (p.stable) {
        for (let j = 0; j < tt.length; ++j) {
          await fetchUsdTokensDecimals(tokenContract, tt[j]);
        }
        p.cAmounts = [...pool.amounts].map((amount, idx) => {
          let factor = Big(10).pow(18 - tokenDecimals[tt[idx]]);
          return Big(amount).mul(factor);
        });
        p.nCoins = p.cAmounts.length;

        let shouldSkip = false;
        if (pool.pool_kind === RatedPool) {
          p.rates = tt.map((tokenId) => {
            if (!(tokenId in ratedTokens)) {
              console.log(
                `Missing token rate for token ${tokenId} for pool #${i}`
              );
              shouldSkip = true;
            }
            return ratedTokens[tokenId]?.rate_price;
          });
          if (shouldSkip) {
            continue;
          }
        } else {
          p.rates = new Array(p.nCoins).fill(OneNear);
        }
        p.cAmounts = p.cAmounts.map((cAmount, idx) =>
          cAmount.mul(p.rates[idx]).div(OneNear)
        );

        p.nn = Big(Math.pow(p.nCoins, p.nCoins));
        p.ann = Big(p.amp).mul(p.nn);
        p.d = stablePoolComputeD(p);
      }

      if (p.shares.gt(0)) {
        pools[p.index] = p;
        p.tt.forEach((t) => addPools(t, p));
      }
    }
  }

  return {
    pools,
    poolsByToken,
    poolsByPair,
  };
}

const findBestReturn = (
  refFinance,
  inTokenAccountId,
  outTokenAccountId,
  amountIn
) => {
  let swapInfo = {
    amountIn,
    amountOut: Big(0),
  };
  // Computing path
  Object.values(refFinance.poolsByToken[inTokenAccountId] || {}).forEach(
    (pool) => {
      // 1 token
      if (outTokenAccountId in pool.tokens) {
        const poolReturn =
          getRefReturn(pool, inTokenAccountId, amountIn, outTokenAccountId) ||
          Big(0);

        if (poolReturn.gt(swapInfo.amountOut)) {
          swapInfo = {
            amountIn,
            amountOut: poolReturn,
            pools: [pool],
            swapPath: [inTokenAccountId, outTokenAccountId],
          };
        }
      } else {
        // 2 tokens
        pool.ots[inTokenAccountId].forEach((middleTokenAccountId) => {
          const pair = `${middleTokenAccountId}:${outTokenAccountId}`;
          let poolReturn = false;
          Object.values(refFinance.poolsByPair[pair] || {}).forEach((pool2) => {
            poolReturn =
              poolReturn === false
                ? getRefReturn(
                    pool,
                    inTokenAccountId,
                    amountIn,
                    middleTokenAccountId
                  )
                : poolReturn;
            if (!poolReturn) {
              return;
            }
            const pool2Return =
              getRefReturn(
                pool2,
                middleTokenAccountId,
                poolReturn,
                outTokenAccountId
              ) || Big(0);
            if (pool2Return.gt(swapInfo.amountOut)) {
              swapInfo = {
                amountIn,
                amountOut: pool2Return,
                pools: [pool, pool2],
                swapPath: [
                  inTokenAccountId,
                  middleTokenAccountId,
                  outTokenAccountId,
                ],
              };
            }
          });
        });
      }
    }
  );
  return Object.assign(swapInfo, {
    inTokenAccountId,
    outTokenAccountId,
    expectedAmountOut: Big(0),
  });
};

const findBestInverseReturn = (
  refFinance,
  inTokenAccountId,
  outTokenAccountId,
  availableInToken,
  outAmount
) => {
  let swapInfo = {
    amountIn: availableInToken,
    amountOut: Big(0),
  };
  // Computing path
  Object.values(refFinance.poolsByToken[outTokenAccountId] || {}).forEach(
    (pool) => {
      // 1 token
      if (inTokenAccountId in pool.tokens) {
        const amountIn = getRefInverseReturn(
          pool,
          outTokenAccountId,
          outAmount,
          inTokenAccountId
        );
        if (!amountIn) {
          return;
        }

        if (amountIn.lt(swapInfo.amountIn)) {
          swapInfo = {
            amountIn,
            amountOut: outAmount,
            pools: [pool],
            swapPath: [inTokenAccountId, outTokenAccountId],
          };
        }
      } else {
        // 2 tokens
        pool.ots[outTokenAccountId].forEach((middleTokenAccountId) => {
          const pair = `${middleTokenAccountId}:${inTokenAccountId}`;
          let middleAmountIn = false;
          Object.values(refFinance.poolsByPair[pair] || {}).forEach((pool2) => {
            middleAmountIn =
              middleAmountIn === false
                ? getRefInverseReturn(
                    pool,
                    outTokenAccountId,
                    outAmount,
                    middleTokenAccountId
                  )
                : middleAmountIn;
            if (!middleAmountIn) {
              return;
            }
            const amountIn = getRefInverseReturn(
              pool2,
              middleTokenAccountId,
              middleAmountIn,
              inTokenAccountId
            );
            if (!amountIn) {
              return;
            }
            if (amountIn.lt(swapInfo.amountIn)) {
              swapInfo = {
                amountIn,
                amountOut: outAmount,
                pools: [pool2, pool],
                swapPath: [
                  inTokenAccountId,
                  middleTokenAccountId,
                  outTokenAccountId,
                ],
              };
            }
          });
        });
      }
    }
  );

  return Object.assign(swapInfo, {
    inTokenAccountId,
    outTokenAccountId,
    expectedAmountOut: outAmount,
  });
};

async function executeSwap(nearObjects, swapInfo) {
  const { tokenContract, NearConfig } = nearObjects;
  let tokenId = swapInfo.inTokenAccountId;
  let token = tokenContract(tokenId);
  return Big(
    await token.ft_transfer_call(
      {
        receiver_id: NearConfig.refFinanceContractId,
        amount: swapInfo.amountIn.toFixed(0),
        msg: JSON.stringify({
          actions: swapInfo.pools.map((pool, idx) => {
            const tokenIn = tokenId;
            tokenId = swapInfo.swapPath[idx + 1];
            return {
              pool_id: pool.index,
              token_in: tokenIn,
              token_out: tokenId,
              min_amount_out:
                tokenId === swapInfo.outTokenAccountId
                  ? swapInfo.amountOut
                      .mul(Big(100).sub(NearConfig.maxSlippage).div(100))
                      .round(0, 0)
                      .toFixed(0)
                  : "0",
            };
          }),
        }),
      },
      Big(10).pow(12).mul(300).toFixed(0),
      "1"
    )
  );
}

async function refSell(nearObjects, tokenId, amountIn) {
  const { NearConfig } = nearObjects;

  if (tokenId === NearConfig.wrapNearAccountId) {
    return amountIn;
  }

  const refFinance = await prepareRef(nearObjects);
  const swapInfo = findBestReturn(
    refFinance,
    tokenId,
    NearConfig.wrapNearAccountId,
    amountIn
  );

  return executeSwap(nearObjects, swapInfo);
}

async function refBuy(nearObjects, tokenId, amountOut) {
  const { NearConfig } = nearObjects;

  if (tokenId === NearConfig.wrapNearAccountId) {
    return amountOut;
  }

  const refFinance = await prepareRef(nearObjects);
  const swapInfo = findBestInverseReturn(
    refFinance,
    NearConfig.wrapNearAccountId,
    tokenId,
    Big(10).pow(32),
    amountOut
  );

  return executeSwap(nearObjects, swapInfo);
}

module.exports = {
  refSell,
  refBuy,
};
