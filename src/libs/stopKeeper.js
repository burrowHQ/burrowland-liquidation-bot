const Big = require("big.js");
const { printOutcome, getRefExchangeSwapMsg, getSwapActionsMinAmountOut } = require("./utils");
const { parseAccount } = require("./margin");
const log4js = require('log4js');

const stopKeeperLogger = log4js.getLogger();

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
 * - For stop_loss: adjusted = stop_loss * (10000 - offset) / 10000
 *   Example: 70% with 10% offset → 63%
 */
const isStopActive = (position, offsetBps = 0) => {
  const { token_c_price_balance, token_d_price_balance, token_p_price_balance, hp_fee_price_balance, stop } = position;

  // value_position + value_collateral (no slippage adjustment, contract uses slippage=0)
  const totalCap = token_p_price_balance.add(token_c_price_balance);
  // value_debt + hp_fee
  const totalDebt = token_d_price_balance.add(hp_fee_price_balance);

  // Check stop loss: current_remain < target_remain
  // Formula: (position + collateral) < collateral * stop_loss / 10000 + debt + hp_fee
  // With offset: stop_loss_adjusted = stop_loss * (10000 - offset) / 10000
  if (stop.stop_loss) {
    const adjustedStopLoss = Big(stop.stop_loss).mul(Big(10000 - offsetBps)).div(Big(10000));
    const targetRemain = token_c_price_balance.mul(adjustedStopLoss).div(Big(10000));
    if (totalCap.lt(targetRemain.add(totalDebt))) {
      return { triggered: true, type: 'stop_loss' };
    }
  }

  // Check take profit: current_remain > target_remain
  // Formula: (position + collateral) > collateral * stop_profit / 10000 + debt + hp_fee
  // With offset: stop_profit_adjusted = stop_profit + (stop_profit - 10000) * offset / 10000
  if (stop.stop_profit) {
    const profitMargin = Big(stop.stop_profit).sub(Big(10000));
    const adjustedStopProfit = Big(stop.stop_profit).add(profitMargin.mul(Big(offsetBps)).div(Big(10000)));
    const targetRemain = token_c_price_balance.mul(adjustedStopProfit).div(Big(10000));
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
  a.hp_fee_price_balance = hp_fee.gt(Big(0)) ? hp_fee.mul(a.d_price.multiplier)
    .div(Big(10).pow(a.d_price.decimals + a.d_asset.config.extraDecimals)) : Big(0);

  // Check stop condition with offset to account for price movement
  const stopResult = isStopActive(a, NearConfig.stopKeeperOffsetBps || 0);
  a.stopTriggered = stopResult.triggered;
  a.stopType = stopResult.type;

  // If triggered, get swap route and construct action
  if (a.stopTriggered) {
    const tokenPAmountBD = a.token_c_info.token_id == a.token_d_info.token_id
      ? a.token_p_amount
      : a.token_p_amount.add(a.token_c_info.balance);
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
      stopKeeperLogger.error("Missing swap route for stop: " + a.token_p_id + " -> " + a.token_d_info.token_id);
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
 * liquidator and rawMarginAccounts are passed from burrow.js to avoid duplicate RPC calls
 */
module.exports = {
  main: async (account, burrow_config, NearConfig, burrowContract, assets, prices, liquidator, rawMarginAccounts) => {
    stopKeeperLogger.info('Stop Keeper Begin');

    // Parse and filter positions with stops
    let stopPositions = rawMarginAccounts
      .map(a => parseAccount(a))
      .flat()
      .filter(a => !a.is_locking && a.stop !== null);

    stopKeeperLogger.debug(`Found ${stopPositions.length} positions with active stops`);

    // Process each position (check conditions, get swap routes)
    stopPositions = await Promise.all(
      stopPositions.map(pos => processStopPosition(pos, assets, prices, NearConfig))
    );

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
