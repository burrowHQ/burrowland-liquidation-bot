const Big = require("big.js");
const { printOutcome, getRefExchangeSwapMsg, getSwapActionsMinAmountOut } = require("./utils");
const { parseAccount } = require("./margin");
const log4js = require('log4js');

const stopKeeperLogger = log4js.getLogger();

// BPS (basis points) base: 10000 = 100%
const BPS_BASE = 10000;

// Batch size for smart router API calls to avoid rate limiting
const SMART_ROUTER_BATCH_SIZE = 10;

/**
 * Check if stop condition is met
 * Replicates contract's is_stop_active logic with configurable offset
 * See: external-project/contracts/contract/src/margin_position.rs:147-176
 *
 * Note: Contract uses slippage=0 when checking (line 614)
 *
 * The offsetBps parameter adds a buffer to account for price movement between
 * off-chain evaluation and on-chain execution:
 * - For stop_profit: adjusted = stop_profit + (stop_profit - 10000) * offset / 10000
 *   Example: 130% with 10% offset → 133%
 * - For stop_loss: adjusted = stop_loss - (10000 - stop_loss) * offset / 10000
 *   Example: 70% with 10% offset → 67%
 */
const isStopActive = (position, offsetBps = 0) => {
  const { token_c_price_balance, token_d_price_balance, token_p_price_balance, hp_fee_price_balance, stop } = position;

  // value_position + value_collateral (no slippage adjustment, contract uses slippage=0)
  const totalCap = token_p_price_balance.add(token_c_price_balance);
  // value_debt + hp_fee
  const totalDebt = token_d_price_balance.add(hp_fee_price_balance);

  // Check stop loss: current_remain < target_remain
  // Formula: (position + collateral) < collateral * stop_loss / BPS_BASE + debt + hp_fee
  // With offset: stop_loss_adjusted = stop_loss - (BPS_BASE - stop_loss) * offset / BPS_BASE
  // Valid range: 1-9999 BPS (contract validation)
  if (stop.stop_loss && stop.stop_loss > 0 && stop.stop_loss < BPS_BASE) {
    const lossMargin = Big(BPS_BASE).sub(Big(stop.stop_loss));
    const adjustedStopLoss = Big(stop.stop_loss).sub(lossMargin.mul(Big(offsetBps)).div(Big(BPS_BASE)));
    const targetRemain = token_c_price_balance.mul(adjustedStopLoss).div(Big(BPS_BASE));
    if (totalCap.lt(targetRemain.add(totalDebt))) {
      return { triggered: true, type: 'stop_loss' };
    }
  }

  // Check take profit: current_remain > target_remain
  // Formula: (position + collateral) > collateral * stop_profit / BPS_BASE + debt + hp_fee
  // With offset: stop_profit_adjusted = stop_profit + (stop_profit - BPS_BASE) * offset / BPS_BASE
  // Valid range: > BPS_BASE (contract validation)
  if (stop.stop_profit && stop.stop_profit > BPS_BASE) {
    const profitMargin = Big(stop.stop_profit).sub(Big(BPS_BASE));
    const adjustedStopProfit = Big(stop.stop_profit).add(profitMargin.mul(Big(offsetBps)).div(Big(BPS_BASE)));
    const targetRemain = token_c_price_balance.mul(adjustedStopProfit).div(Big(BPS_BASE));
    if (totalCap.gt(targetRemain.add(totalDebt))) {
      return { triggered: true, type: 'take_profit' };
    }
  }

  return { triggered: false, type: null };
};

/**
 * Process position and enrich with price data
 */
const processStopPosition = async (a, assets, prices, NearConfig) => {
  a.c_asset = assets[a.token_c_info.token_id];
  a.d_asset = assets[a.token_d_info.token_id];
  a.p_asset = assets[a.token_p_id];
  a.c_price = prices?.prices[a.token_c_info.token_id];
  a.d_price = prices?.prices[a.token_d_info.token_id];
  a.p_price = prices?.prices[a.token_p_id];

  // Validate that all required data exists
  if (!a.c_asset || !a.d_asset || !a.p_asset || !a.c_price || !a.d_price || !a.p_price) {
    stopKeeperLogger.warn(`Missing asset or price data for position ${a.accountId}:${a.position}, skipping`);
    a.stopTriggered = false;
    a.actions = null;
    return a;
  }

  // Calculate USD values
  a.token_c_price_balance = a.token_c_info.balance
    .mul(a.c_price.multiplier)
    .div(Big(10).pow(a.c_price.decimals + a.c_asset.config.extraDecimals));
  a.token_d_price_balance = a.token_d_info.balance
    .mul(a.d_price.multiplier)
    .div(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals));
  a.token_p_price_balance = a.token_p_amount
    .mul(a.p_price.multiplier)
    .div(Big(10).pow(a.p_price.decimals + a.p_asset.config.extraDecimals));

  // Calculate HP fee
  const hp_fee = a.debt_cap.mul(a.d_asset.unitAccHpInterest.sub(a.uahpi_at_open)).div(Big(10).pow(18));
  if (hp_fee.lt(Big(0))) {
    stopKeeperLogger.warn(`Negative HP fee detected for ${a.accountId}:${a.position}, treating as zero`);
  }
  a.hp_fee_price_balance = hp_fee.gt(Big(0)) ? hp_fee.mul(a.d_price.multiplier)
    .div(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals)) : Big(0);

  // Check stop condition with offset to account for price movement
  const stopResult = isStopActive(a, NearConfig.stopKeeperOffsetBps || 0);
  a.stopTriggered = stopResult.triggered;
  a.stopType = stopResult.type;

  // If triggered, get swap route and construct action
  if (a.stopTriggered) {
    // Determine how much token_p to include in the swap.
    // Goal: user should receive collateral token (token_c) at the end, not debt token (token_d).
    let tokenPAmountBD;
    if (a.token_c_info.token_id == a.token_d_info.token_id) {
      // Long position: collateral == debt token (e.g. USDC collateral, USDC debt, NEAR position)
      // Only swap position token; collateral stays as token_c automatically.
      tokenPAmountBD = a.token_p_amount;
    } else {
      // Short position: collateral != debt (implies token_c == token_p, e.g. USDC collateral/position, NEAR debt)
      // User wants USDC (token_c) back, not NEAR (token_d).
      // Swap only the minimum amount of token_p needed to cover total debt after slippage.
      // Remaining position tokens are also returned to the user as token_p shares (same token as collateral).
      const totalDebtUsd = a.token_d_price_balance.add(a.hp_fee_price_balance);
      const slippageDivisor = Big(1).sub(NearConfig.maxSlippage.div(100));

      // Minimum input needed so that output after slippage >= total debt
      // interestBufferRate: buffer to cover interest accrued between off-chain calculation and on-chain execution
      const neededInputUsd = totalDebtUsd.div(NearConfig.interestBufferRate).div(slippageDivisor);
      const neededTokenP = neededInputUsd
        .mul(Big(10).pow(a.p_price.decimals + a.p_asset.config.extraDecimals))
        .div(a.p_price.multiplier)
        .round(0, 3); // round up to be conservative

      if (neededTokenP.lte(a.token_p_amount)) {
        // Position alone covers debt; swap only what's needed, return the rest as USDC.
        tokenPAmountBD = neededTokenP;
      } else {
        // Position alone is insufficient; take the shortfall from collateral (clamped to available).
        const additionalFromCollateral = neededTokenP.sub(a.token_p_amount).lte(a.token_c_info.balance)
          ? neededTokenP.sub(a.token_p_amount)
          : a.token_c_info.balance;
        tokenPAmountBD = a.token_p_amount.add(additionalFromCollateral);
      }
    }
    const tokenPAmountSTDD = tokenPAmountBD.div(Big(10).pow(a.p_asset.config.extraDecimals)).round(0, 0);

    const swapMsg = await getRefExchangeSwapMsg(
      NearConfig.smartrouterUrl,
      tokenPAmountSTDD.toFixed(),
      a.token_p_id,
      a.token_d_info.token_id,
      NearConfig.maxSlippage.div(100).toFixed()
    );

    if (swapMsg != "") {
      const tokenDAmountSTDD = getSwapActionsMinAmountOut(JSON.parse(swapMsg).actions, a.token_d_info.token_id);
      const tokenDAmountBD = tokenDAmountSTDD.mul(Big(10).pow(a.d_asset.config.extraDecimals)).round(0, 0);

      a.actions = [{
        StopMTPosition: {
          pos_owner_id: a.accountId,
          pos_id: a.position,
          token_p_amount: tokenPAmountBD.toFixed(0),
          min_token_d_amount: tokenDAmountBD.toFixed(0),
          swap_indication: {
            dex_id: NearConfig.refFinanceContractId,
            swap_action_text: swapMsg,
          }
        }
      }];
    } else {
      stopKeeperLogger.error(`Missing swap route for stop: ${a.token_p_id} -> ${a.token_d_info.token_id}`);
      a.actions = null;
    }
  } else {
    a.actions = null;
  }

  return a;
};

/**
 * Execute stop action via oracle
 */
const executeStop = async (account, NearConfig, actions, burrow_config) => {
  const msg = JSON.stringify({ MarginExecute: { actions } });

  if (burrow_config.enable_price_oracle) {
    return await account.functionCall({
      contractId: NearConfig.priceOracleContractId,
      methodName: "oracle_call",
      args: {
        receiver_id: NearConfig.burrowContractId,
        msg: msg,
      },
      gas: Big(10).pow(12).mul(300).toFixed(0),
      attachedDeposit: "1",
    });
  } else {
    return await account.functionCall({
      contractId: NearConfig.burrowContractId,
      methodName: "margin_execute_with_pyth",
      args: { actions },
      gas: Big(10).pow(12).mul(300).toFixed(0),
      attachedDeposit: "1",
    });
  }
};

/**
 * Main stop keeper function
 * rawMarginAccounts is passed from burrow.js to avoid duplicate RPC calls
 */
module.exports = {
  main: async (account, burrow_config, NearConfig, burrowContract, assets, prices, rawMarginAccounts) => {
    stopKeeperLogger.info('Stop Keeper Begin');

    // Parse and filter positions with stops
    let stopPositions = rawMarginAccounts
      .map(a => parseAccount(a))
      .flat()
      .filter(a => !a.is_locking && a.stop !== null);

    stopKeeperLogger.debug(`Found ${stopPositions.length} positions with active stops`);

    // Process positions in batches to avoid overwhelming smart router API
    const processedPositions = [];
    for (let i = 0; i < stopPositions.length; i += SMART_ROUTER_BATCH_SIZE) {
      const batch = stopPositions.slice(i, i + SMART_ROUTER_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(pos => processStopPosition(pos, assets, prices, NearConfig))
      );
      processedPositions.push(...batchResults);
    }
    stopPositions = processedPositions;

    // Filter to triggered stops with valid actions
    const triggeredStops = stopPositions.filter(a => a.stopTriggered && a.actions !== null);

    stopKeeperLogger.debug(`${triggeredStops.length} stops triggered`);

    // Execute a random triggered stop (randomize to avoid competition between keepers)
    if (triggeredStops.length > 0) {
      const randomIndex = Math.floor(Math.random() * triggeredStops.length);
      const pos = triggeredStops[randomIndex];
      try {
        stopKeeperLogger.info(`Executing ${pos.stopType} for ${pos.accountId} position ${pos.position}`);
        stopKeeperLogger.debug("actions:", JSON.stringify(pos.actions, undefined, 2));

        const outcome = await executeStop(account, NearConfig, pos.actions, burrow_config);
        printOutcome("stop_keeper", "./logs/stop_keeper_success.log", outcome);
      } catch (error) {
        stopKeeperLogger.error("Stop execution failed:", error);
      }
    }

    stopKeeperLogger.info('Stop Keeper End');
  }
};
