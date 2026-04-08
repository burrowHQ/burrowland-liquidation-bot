//! The code below is based on skyward finance https://github.com/skyward-finance/app-ui.

const fetch = require("node-fetch");
const Big = require("big.js");
const { loadJson, saveJson, keysToCamel, sleep } = require("./utils");

const log4js = require('log4js');
const rebalanceLogger = log4js.getLogger();

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

const feeTier = ['100', '400', '2000', '10000'];

let tokenCache = null;
let swapFailedConter = 0;
let nearIntentsTokenCache = null;

const NEAR_INTENTS_TERMINAL_STATUS = new Set(['SUCCESS', 'REFUNDED', 'FAILED']);

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
      rebalanceLogger.error("Failed to fetch metadata for token", tokenId);
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
  const [rawNumPools, ratedTokens, frozenlistTokens] = await Promise.all([
    refFinanceContract.get_number_of_pools(),
    refFinanceContract.list_rated_tokens(),
    refFinanceContract.get_frozenlist_tokens(),
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
      const needSkip = pool.token_account_ids.reduce((acc, tokenAccountId) => {
        return acc || frozenlistTokens.indexOf(tokenAccountId) != -1;
      }, false);
      if (needSkip) {
        continue;
      }
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
              // console.log(
              //   `Missing token rate for token ${tokenId} for pool #${i}`
              // );
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

const findDclBestReturn = async (
  dclContract,
  inTokenAccountId,
  outTokenAccountId,
  amountIn
) => {
  let swapInfo = {
    amountOut: Big(0),
  };
  let poolIdHead = '';
  if (inTokenAccountId < outTokenAccountId) {
    poolIdHead = inTokenAccountId + '|' + outTokenAccountId + '|';
  } else {
    poolIdHead = outTokenAccountId + '|' + inTokenAccountId + '|';
  }

  for (const tier of feeTier) {
    let poolId = poolIdHead + tier;
    try {
      const result = await dclContract.quote({
        'pool_ids': [poolId],
        'input_token': inTokenAccountId,
        'output_token': outTokenAccountId,
        'input_amount': amountIn,
      });
      const amountOut = Big(result.amount);
      if (amountOut.gt(swapInfo.amountIn)) {
        swapInfo = {
          poolId,
          amountOut,
        };
      }
    } catch { }
  }
  return Object.assign(swapInfo, {
    inTokenAccountId,
    outTokenAccountId,
    amountIn,
  });
}

const findBestReturnBySmartRouter = async (
  smartrouterUrl,
  inTokenAccountId,
  outTokenAccountId,
  amountIn,
  slippage = 0.005, pathDeep = 3, routerCount = 2
) => {
  const url = `${smartrouterUrl}/swapPath?amountIn=${amountIn.toFixed(0)}&tokenIn=${inTokenAccountId}&tokenOut=${outTokenAccountId}&pathDeep=${pathDeep}&slippage=${slippage}&routerCount=${routerCount}`;
  const response = await fetch(url);
  const responseJson = await response.json();
  if (responseJson.result_data && responseJson.result_data.args.amount == amountIn.toFixed(0)) {
    return {
      inTokenAccountId,
      amountIn,
      amountOut: Big(responseJson.result_data.amountOut),
      msg: responseJson.result_data.args.msg
    }
  } else {
    return undefined
  }
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

const dclFindBestInverseReturn = async (
  dclContract,
  inTokenAccountId,
  outTokenAccountId,
  availableInToken,
  outAmount
) => {
  let swapInfo = {
    amountIn: availableInToken,
  };
  let poolIdHead = '';
  if (inTokenAccountId < outTokenAccountId) {
    poolIdHead = inTokenAccountId + '|' + outTokenAccountId + '|';
  } else {
    poolIdHead = outTokenAccountId + '|' + inTokenAccountId + '|';
  }

  for (const tier of feeTier) {
    let poolId = poolIdHead + tier;
    try {
      const result = await dclContract.quote_by_output({
        'pool_ids': [poolId],
        'input_token': inTokenAccountId,
        'output_token': outTokenAccountId,
        'output_amount': outAmount,
      });
      const amountIn = Big(result.amount);
      if (amountIn.gt(Big(0)) && amountIn.lt(swapInfo.amountIn)) {
        swapInfo = {
          poolId,
          amountIn,
        };
      }
    } catch { }
  }
  return Object.assign(swapInfo, {
    inTokenAccountId,
    outTokenAccountId,
    amountOut: outAmount,
  });
}

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

async function executeSmartRouterSwap(nearObjects, swapInfo) {
  const { txSender, NearConfig } = nearObjects;
  await txSender.sendFunctionCall({
    "contractId": swapInfo.inTokenAccountId,
    "methodName": "ft_transfer_call",
    "args": {
      "receiver_id": NearConfig.refFinanceContractId,
      "amount": swapInfo.amountIn.toFixed(0),
      "msg": swapInfo.msg,
    },
    "gas": Big(10).pow(12).mul(300).toFixed(0),
    "attachedDeposit": "1",
  })
}

async function executeSwap(nearObjects, swapInfo) {
  const { txSender, NearConfig } = nearObjects;
  let tokenId = swapInfo.inTokenAccountId;
  return Big(
    await txSender.sendFunctionCall({
      contractId: swapInfo.inTokenAccountId,
      methodName: "ft_transfer_call",
      args: {
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
      gas: Big(10).pow(12).mul(300).toFixed(0),
      attachedDeposit: "1"
    })
  );
}

async function executeDclSwap(nearObjects, swapInfo) {
  const { txSender, NearConfig } = nearObjects;
  let tokenId = swapInfo.inTokenAccountId;
  return Big(
    await txSender.sendFunctionCall({
      contractId: swapInfo.inTokenAccountId,
      methodName: "ft_transfer_call",
      args: {
        receiver_id: NearConfig.dclContractId,
        amount: swapInfo.amountIn.toFixed(0),
        msg: JSON.stringify({
          'Swap': {
            'pool_ids': [swapInfo.poolId],
            'output_token': swapInfo.outTokenAccountId,
            'min_output_amount': swapInfo.amountOut.mul(Big(100).sub(NearConfig.maxSlippage).div(100))
              .round(0, 0)
              .toFixed(0),
            'skip_unwrap_near': true,
          },
        }),
      },
      gas: Big(10).pow(12).mul(300).toFixed(0),
      attachedDeposit: "1"
    })
  );
}

function getNearIntentsHeaders(NearConfig) {
  return {
    "Content-Type": "application/json",
    ...(NearConfig.nearIntents?.jwt ? { Authorization: `Bearer ${NearConfig.nearIntents.jwt}` } : {}),
  };
}

async function fetchNearIntentsTokens(NearConfig) {
  if (nearIntentsTokenCache) {
    return nearIntentsTokenCache;
  }

  const response = await fetch(`${NearConfig.nearIntents.apiBaseUrl}/v0/tokens`, {
    headers: getNearIntentsHeaders(NearConfig),
    timeout: NearConfig.nearIntents.quoteTimeoutMs,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch NEAR Intents tokens: ${response.status} ${response.statusText}`);
  }

  nearIntentsTokenCache = await response.json();
  return nearIntentsTokenCache;
}

async function resolveNearIntentsAssetId(NearConfig, tokenId) {
  const tokens = await fetchNearIntentsTokens(NearConfig);
  const normalizedTokenId = tokenId.toLowerCase();

  const matchedToken = tokens.find((token) => {
    const contractAddress = token.contractAddress?.toLowerCase();
    const assetId = token.assetId?.toLowerCase();
    return contractAddress === normalizedTokenId;
  });

  if (!matchedToken?.assetId) {
    throw new Error(`NEAR Intents assetId not found for token ${tokenId}`);
  }

  return matchedToken.assetId;
}

async function quoteNearIntentsSwap(nearObjects, inTokenAccountId, outTokenAccountId, amount, swapType) {
  const { NearConfig } = nearObjects;
  const originAsset = await resolveNearIntentsAssetId(NearConfig, inTokenAccountId);
  const destinationAsset = await resolveNearIntentsAssetId(NearConfig, outTokenAccountId);
  const deadline = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  console.log(JSON.stringify({
      dry: false,
      swapType,
      slippageTolerance: NearConfig.nearIntents.slippageBps,
      originAsset,
      destinationAsset,
      depositType: 'ORIGIN_CHAIN',
      amount: amount.toFixed(0),
      refundTo: NearConfig.accountId,
      refundType: 'ORIGIN_CHAIN',
      recipient: NearConfig.accountId,
      recipientType: 'DESTINATION_CHAIN',
      deadline,
    }));

  const response = await fetch(`${NearConfig.nearIntents.apiBaseUrl}/v0/quote`, {
    method: 'POST',
    headers: getNearIntentsHeaders(NearConfig),
    timeout: NearConfig.nearIntents.quoteTimeoutMs,
    body: JSON.stringify({
      dry: false,
      swapType,
      slippageTolerance: NearConfig.nearIntents.slippageBps,
      originAsset,
      destinationAsset,
      depositType: 'ORIGIN_CHAIN',
      amount: amount.toFixed(0),
      refundTo: NearConfig.accountId,
      refundType: 'ORIGIN_CHAIN',
      recipient: NearConfig.accountId,
      recipientType: 'DESTINATION_CHAIN',
      deadline,
    }),
  });

  const quoteResponse = await response.json();
  if (!response.ok) {
    throw new Error(`NEAR Intents quote failed: ${response.status} ${JSON.stringify(quoteResponse)}`);
  }

  if (!quoteResponse?.quote?.depositAddress || !quoteResponse?.quote?.amountIn || !quoteResponse?.quote?.amountOut) {
    throw new Error(`NEAR Intents quote missing fields: ${JSON.stringify(quoteResponse)}`);
  }

  return {
    venue: 'intents',
    mode: swapType,
    inTokenAccountId,
    outTokenAccountId,
    amountIn: Big(quoteResponse.quote.amountIn),
    amountOut: Big(quoteResponse.quote.amountOut),
    rawQuote: quoteResponse,
  };
}

function extractTransactionHash(txResult) {
  return txResult?.transaction?.hash || txResult?.transaction_outcome?.id || txResult?.transaction_outcome?.outcome?.id;
}

async function submitNearIntentsDeposit(NearConfig, intentsQuote, txHash) {
  const response = await fetch(`${NearConfig.nearIntents.apiBaseUrl}/v0/deposit/submit`, {
    method: 'POST',
    headers: getNearIntentsHeaders(NearConfig),
    timeout: NearConfig.nearIntents.quoteTimeoutMs,
    body: JSON.stringify({
      txHash,
      depositAddress: intentsQuote.rawQuote.quote.depositAddress,
      nearSenderAccount: NearConfig.accountId,
      memo: intentsQuote.rawQuote.quote.depositMemo,
    }),
  });

  const submitResponse = await response.json();
  if (!response.ok) {
    throw new Error(`NEAR Intents deposit submit failed: ${response.status} ${JSON.stringify(submitResponse)}`);
  }

  return submitResponse;
}

async function waitNearIntentsStatus(NearConfig, depositAddress, depositMemo) {
  const startedAt = Date.now();
  const query = new URLSearchParams({ depositAddress });
  if (depositMemo) {
    query.set('depositMemo', depositMemo);
  }

  while (Date.now() - startedAt < NearConfig.nearIntents.statusTimeoutMs) {
    const response = await fetch(`${NearConfig.nearIntents.apiBaseUrl}/v0/status?${query.toString()}`, {
      headers: getNearIntentsHeaders(NearConfig),
      timeout: NearConfig.nearIntents.quoteTimeoutMs,
    });
    const statusResponse = await response.json();

    if (!response.ok) {
      throw new Error(`NEAR Intents status failed: ${response.status} ${JSON.stringify(statusResponse)}`);
    }

    if (NEAR_INTENTS_TERMINAL_STATUS.has(statusResponse.status)) {
      return statusResponse;
    }

    await sleep(NearConfig.nearIntents.statusPollIntervalMs);
  }

  throw new Error(`NEAR Intents status polling timed out for depositAddress ${depositAddress}`);
}

async function executeNearIntentsSwap(nearObjects, intentsQuote, operationName) {
  const { txSender, NearConfig, tokenContract } = nearObjects;
  const { inTokenAccountId, outTokenAccountId, amountIn, amountOut, rawQuote, mode } = intentsQuote;
  const { depositAddress, depositMemo } = rawQuote.quote;

  rebalanceLogger.info(`${operationName} intents quote`, {
    venue: 'intents',
    swapType: mode,
    tokenId: inTokenAccountId,
    outTokenId: outTokenAccountId,
    amountIn: amountIn.toFixed(0),
    amountOut: amountOut.toFixed(0),
    minAmountIn: rawQuote.quote.minAmountIn,
    minAmountOut: rawQuote.quote.minAmountOut,
    correlationId: rawQuote.correlationId || rawQuote.quote.correlationId,
    depositAddress,
    depositMemo,
  });

  const inTokenContract = tokenContract(inTokenAccountId);
  const storageBalance = await inTokenContract.storage_balance_of({
    account_id: depositAddress,
  });
  if (Big(storageBalance?.total || 0).eq(0)) {
    const storageBalanceBounds = await inTokenContract.storage_balance_bounds();
    const storageDeposit = storageBalanceBounds?.min || Big(10).pow(23).toFixed(0);
    rebalanceLogger.info(`${operationName} intents storage_deposit`, {
      venue: 'intents',
      tokenId: inTokenAccountId,
      depositAddress,
      storageDeposit,
    });
    await txSender.sendFunctionCall({
      contractId: inTokenAccountId,
      methodName: 'storage_deposit',
      args: {
        account_id: depositAddress,
        registration_only: true,
      },
      gas: Big(10).pow(12).mul(100).toFixed(0),
      attachedDeposit: storageDeposit,
    });
  }

  const transferResult = await txSender.sendFunctionCall({
    contractId: inTokenAccountId,
    methodName: 'ft_transfer',
    args: {
      receiver_id: depositAddress,
      amount: amountIn.toFixed(0),
      memo: depositMemo,
    },
    gas: Big(10).pow(12).mul(100).toFixed(0),
    attachedDeposit: '1',
  });

  const txHash = extractTransactionHash(transferResult);
  if (!txHash) {
    throw new Error('NEAR Intents transfer completed but transaction hash was not found');
  }

  const submitResponse = await submitNearIntentsDeposit(NearConfig, intentsQuote, txHash);
  rebalanceLogger.info(`${operationName} intents deposit submitted`, {
    venue: 'intents',
    tokenId: inTokenAccountId,
    outTokenId: outTokenAccountId,
    amountIn: amountIn.toFixed(0),
    amountOut: amountOut.toFixed(0),
    depositAddress,
    depositMemo,
    txHash,
    status: submitResponse.status,
    correlationId: submitResponse.correlationId,
  });

  const statusResponse = await waitNearIntentsStatus(NearConfig, depositAddress, depositMemo);
  const actualAmountIn = statusResponse.swapDetails?.amountIn || statusResponse.quoteResponse?.quote?.amountIn || amountIn.toFixed(0);
  const actualAmountOut = statusResponse.swapDetails?.amountOut || statusResponse.quoteResponse?.quote?.amountOut || amountOut.toFixed(0);
  const wrappedAmountOut = statusResponse.swapDetails?.amountOut;
  const refundAmount = statusResponse.swapDetails?.refundAmount || statusResponse.quoteResponse?.quote?.refundFee;
  rebalanceLogger.info(`${operationName} intents terminal status`, {
    venue: 'intents',
    tokenId: inTokenAccountId,
    outTokenId: outTokenAccountId,
    amountIn: actualAmountIn,
    amountOut: actualAmountOut,
    refundAmount,
    depositAddress,
    depositMemo,
    txHash,
    status: statusResponse.status,
    correlationId: statusResponse.correlationId,
  });

  if (statusResponse.status !== 'SUCCESS') {
    throw new Error(`NEAR Intents swap did not succeed: ${statusResponse.status}`);
  }

  if (outTokenAccountId === NearConfig.wrapNearAccountId && wrappedAmountOut && Big(wrappedAmountOut).gt(0)) {
    rebalanceLogger.info(`${operationName} intents wrap near`, {
      venue: 'intents',
      outTokenId: outTokenAccountId,
      amountOut: wrappedAmountOut,
    });
    await txSender.sendFunctionCall({
      contractId: NearConfig.wrapNearAccountId,
      methodName: 'near_deposit',
      args: {},
      gas: Big(10).pow(12).mul(100).toFixed(0),
      attachedDeposit: wrappedAmountOut,
    });
  }

  return statusResponse;
}

async function refSell(nearObjects, tokenId, amountIn) {
  const { NearConfig, dclContract } = nearObjects;

  if (tokenId === NearConfig.wrapNearAccountId) {
    return amountIn;
  }

  const swapInfo = await findBestReturnBySmartRouter(
    NearConfig.smartrouterUrl,
    tokenId,
    NearConfig.wrapNearAccountId,
    amountIn
  );

  const dclSwapInfo = await findDclBestReturn(
    dclContract,
    tokenId,
    NearConfig.wrapNearAccountId,
    amountIn
  );

  let intentsSwapInfo = undefined;
  try {
    intentsSwapInfo = await quoteNearIntentsSwap(
      nearObjects,
      tokenId,
      NearConfig.wrapNearAccountId,
      amountIn,
      'EXACT_INPUT'
    );
  } catch (error) {
    rebalanceLogger.warn('refSell intents quote failed:', error);
  }

  let swapExchange = undefined;
  if (swapInfo?.amountOut && (!dclSwapInfo?.poolId || swapInfo.amountOut.gte(dclSwapInfo.amountOut)) && (!intentsSwapInfo || swapInfo.amountOut.gte(intentsSwapInfo.amountOut))) {
    swapExchange = 'exchange';
  } else if (dclSwapInfo?.poolId && (!intentsSwapInfo || dclSwapInfo.amountOut.gte(intentsSwapInfo.amountOut))) {
    swapExchange = 'dcl';
  } else if (intentsSwapInfo) {
    swapExchange = 'intents';
  }

  switch (swapExchange) {
    case 'intents':
      await executeNearIntentsSwap(nearObjects, intentsSwapInfo, 'refSell')
        .then(() => {
          swapFailedConter = 0;
          rebalanceLogger.debug('refSell executeNearIntentsSwap succeeded');
        })
        .catch(error => {
          if (swapFailedConter < NearConfig.swapFailedLimit) {
            swapFailedConter += 1;
            rebalanceLogger.error(`refSell executeNearIntentsSwap failed(${swapFailedConter} times):`, error)
          } else {
            rebalanceLogger.error(`refSell executeNearIntentsSwap failed(${swapFailedConter} times):`, error)
            process.exit(1)
          }
        });
      break;
    case "exchange":
      await executeSmartRouterSwap(nearObjects, swapInfo)
        .then(() => {
          swapFailedConter = 0;
          rebalanceLogger.debug('refSell executeSwap succeeded');
        })
        .catch(error => {
          if (swapFailedConter < NearConfig.swapFailedLimit) {
            swapFailedConter += 1;
            rebalanceLogger.error(`refSell executeSwap failed(${swapFailedConter} times):`, error)
          } else {
            rebalanceLogger.error(`refSell executeSwap failed(${swapFailedConter} times):`, error)
            process.exit(1)
          }
        });
      break;
    case "dcl":
      await executeDclSwap(nearObjects, dclSwapInfo)
        .then(() => {
          swapFailedConter = 0;
          rebalanceLogger.debug('refSell executeDclSwap succeeded');
        })
        .catch(error => {
          if (swapFailedConter < NearConfig.swapFailedLimit) {
            swapFailedConter += 1;
            rebalanceLogger.error(`refSell executeDclSwap failed(${swapFailedConter} times):`, error)
          } else {
            rebalanceLogger.error(`refSell executeDclSwap failed(${swapFailedConter} times):`, error)
            process.exit(1)
          }
        });
      break;
    default:
      rebalanceLogger.warn("refSell", "in_token:", tokenId, "out_token:", NearConfig.wrapNearAccountId, "no suitable pool");
      await sleep(5000);
  }
}

const unwrapAndStake = async (
  account,
  txSender,
  wrapNearAccountId,
  wrapNearBalance,
  tokenId,
  tokenAmount,
  methodName,
) => {
  const tokenPrice = Big(await account.viewFunction({
    contractId: tokenId,
    methodName,
    args: {}
  }));
  const unwrapAmount = tokenAmount.mul(tokenPrice).div(Big(10).pow(24)).round(0, 0);
  if (wrapNearBalance.lt(unwrapAmount)) {
    rebalanceLogger.warn("Needs", unwrapAmount.toFixed(0), "wrap to unwrap, but the account balance is only", wrapNearBalance.toFixed(0))
    return;
  }
  await txSender.sendFunctionCall({
    "contractId": wrapNearAccountId,
    "methodName": "near_withdraw",
    "args": {
      "amount": unwrapAmount.toFixed(0),
    },
    "gas": Big(10).pow(12).mul(300).toFixed(0),
    "attachedDeposit": "1",
  });
  await txSender.sendFunctionCall({
    "contractId": tokenId,
    "methodName": "deposit_and_stake",
    "args": {},
    "gas": Big(10).pow(12).mul(300).toFixed(0),
    "attachedDeposit": unwrapAmount.toFixed(0),
  });
}

async function refBuy(nearObjects, tokenId, amountOut) {
  const { account, txSender, NearConfig, tokenContract, dclContract } = nearObjects;

  if (tokenId === NearConfig.wrapNearAccountId) {
    return amountOut;
  }

  const wrapNearTokenContract = tokenContract(NearConfig.wrapNearAccountId);
  let wrapNearBalance = Big(await wrapNearTokenContract.ft_balance_of({ account_id: NearConfig.accountId }))

  if (tokenId === NearConfig.rnearContractId) {
    return await unwrapAndStake(
      account,
      txSender,
      NearConfig.wrapNearAccountId,
      wrapNearBalance,
      NearConfig.rnearContractId,
      amountOut,
      'ft_price'
    );
  }

  if (tokenId === NearConfig.linearContractId) {
    return await unwrapAndStake(
      account,
      txSender,
      NearConfig.wrapNearAccountId,
      wrapNearBalance,
      NearConfig.linearContractId,
      amountOut,
      'ft_price'
    );
  }

  if (tokenId === NearConfig.stnearContractId) {
    return await unwrapAndStake(
      account,
      txSender,
      NearConfig.wrapNearAccountId,
      wrapNearBalance,
      NearConfig.stnearContractId,
      amountOut,
      'get_st_near_price'
    );
  }

  const refFinance = await prepareRef(nearObjects);
  const swapInfo = findBestInverseReturn(
    refFinance,
    NearConfig.wrapNearAccountId,
    tokenId,
    Big(10).pow(32),
    amountOut
  );

  const dclSwapInfo = await dclFindBestInverseReturn(
    dclContract,
    NearConfig.wrapNearAccountId,
    tokenId,
    Big(10).pow(32),
    amountOut
  );

  let intentsSwapInfo = undefined;
  try {
    intentsSwapInfo = await quoteNearIntentsSwap(
      nearObjects,
      NearConfig.wrapNearAccountId,
      tokenId,
      amountOut,
      'EXACT_OUTPUT'
    );
  } catch (error) {
    rebalanceLogger.warn('refBuy intents quote failed:', error);
  }

  let swapExchange = undefined;
  let needAmount = undefined;
  if (swapInfo?.pools && (!dclSwapInfo?.poolId || swapInfo.amountIn.lte(dclSwapInfo.amountIn)) && (!intentsSwapInfo || swapInfo.amountIn.lte(intentsSwapInfo.amountIn))) {
    swapExchange = 'exchange';
    needAmount = swapInfo.amountIn;
  } else if (dclSwapInfo?.poolId && (!intentsSwapInfo || dclSwapInfo.amountIn.lte(intentsSwapInfo.amountIn))) {
    swapExchange = 'dcl';
    needAmount = dclSwapInfo.amountIn;
  } else if (intentsSwapInfo) {
    swapExchange = 'intents';
    needAmount = intentsSwapInfo.amountIn;
  }

  if (needAmount && wrapNearBalance.lt(needAmount)) {
    rebalanceLogger.warn("Needs", needAmount.toFixed(0), "wrap to Buying, but the account balance is only", wrapNearBalance.toFixed(0))
    return;
  }

  switch (swapExchange) {
    case 'intents':
      await executeNearIntentsSwap(nearObjects, intentsSwapInfo, 'refBuy')
        .then(() => {
          swapFailedConter = 0;
          rebalanceLogger.debug('refBuy executeNearIntentsSwap succeeded');
        })
        .catch(error => {
          if (swapFailedConter < NearConfig.swapFailedLimit) {
            swapFailedConter += 1;
            rebalanceLogger.error(`refBuy executeNearIntentsSwap failed(${swapFailedConter} times):`, error)
          } else {
            rebalanceLogger.error(`refBuy executeNearIntentsSwap failed(${swapFailedConter} times):`, error)
            process.exit(1)
          }
        });
      break;
    case "exchange":
      await executeSwap(nearObjects, swapInfo)
        .then(() => {
          swapFailedConter = 0;
          rebalanceLogger.debug('refBuy executeSwap succeeded');
        })
        .catch(error => {
          if (swapFailedConter < NearConfig.swapFailedLimit) {
            swapFailedConter += 1;
            rebalanceLogger.error(`refBuy executeSwap failed(${swapFailedConter} times):`, error)
          } else {
            rebalanceLogger.error(`refBuy executeSwap failed(${swapFailedConter} times):`, error)
            process.exit(1)
          }
        });
      break;
    case "dcl":
      await executeDclSwap(nearObjects, dclSwapInfo)
        .then(() => {
          swapFailedConter = 0;
          rebalanceLogger.debug('refBuy executeDclSwap succeeded');
        })
        .catch(error => {
          if (swapFailedConter < NearConfig.swapFailedLimit) {
            swapFailedConter += 1;
            rebalanceLogger.error(`refBuy executeDclSwap failed(${swapFailedConter} times):`, error)
          } else {
            rebalanceLogger.error(`refBuy executeDclSwap failed(${swapFailedConter} times):`, error)
            process.exit(1)
          }
        });
      break;
    default:
      rebalanceLogger.warn("refBuy", "in_token:", NearConfig.wrapNearAccountId, "out_token:", tokenId, "no suitable pool");
      await sleep(5000);
  }
}

module.exports = {
  refSell,
  refBuy,
  quoteNearIntentsSwap,
  executeNearIntentsSwap,
};
