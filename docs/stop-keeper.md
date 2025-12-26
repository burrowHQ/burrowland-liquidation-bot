# Stop Keeper

This document explains how the stop keeper feature works in the Burrow liquidation bot. The stop keeper monitors margin positions with active stop orders (stop-loss/take-profit) and triggers them when conditions are met.

## Overview

Stop orders allow margin traders to automatically close their positions when the market moves in a certain direction:

- **Stop Loss**: Automatically closes a position when losses reach a specified threshold, limiting downside risk
- **Take Profit**: Automatically closes a position when gains reach a specified threshold, locking in profits

The stop keeper acts as a service that monitors these orders and executes them on behalf of users, earning a service fee for each successful execution.

## Stop Order Structure

Each margin position can have an associated stop order with the following fields:

| Field | Description |
|-------|-------------|
| `stop_loss` | Target remaining value in BPS (1-9999). E.g., 8000 = 80% of collateral remaining |
| `stop_profit` | Target remaining value in BPS (>10000). E.g., 12000 = 120% of collateral (20% profit) |
| `service_token_id` | Token ID for the service fee payment |
| `service_token_amount` | Amount of service fee to pay the keeper |

## Value Calculations

```javascript
// Collateral value in USD
token_c_price_balance = token_c_balance * c_price / 10^(decimals + extraDecimals)

// Debt value in USD
token_d_price_balance = token_d_balance * d_price / 10^(decimals + extraDecimals)

// Position token value in USD
token_p_price_balance = token_p_amount * p_price / 10^(decimals + extraDecimals)

// Holding position fee (interest accrued)
hp_fee = debt_cap * (current_unit_acc_hp_interest - uahpi_at_open) / 10^18

// Total capital = collateral + position token value
total_cap = token_c_price_balance + token_p_price_balance

// Total debt = debt + accrued interest
total_debt = token_d_price_balance + hp_fee_price_balance
```

## Stop Trigger Conditions

The contract uses `slippage = 0` when checking if a stop is active.

### Stop Loss

Triggered when the remaining value drops below the target threshold:

```
(position + collateral) < collateral * stop_loss / 10000 + debt + hp_fee
```

Or equivalently:
```
total_cap < (token_c_price_balance * stop_loss / 10000) + total_debt
```

**Example**: If `stop_loss = 8000` (80%), the stop triggers when the position value drops such that only 80% of the original collateral value would remain after closing.

### Take Profit

Triggered when the remaining value exceeds the target threshold:

```
(position + collateral) > collateral * stop_profit / 10000 + debt + hp_fee
```

Or equivalently:
```
total_cap > (token_c_price_balance * stop_profit / 10000) + total_debt
```

**Example**: If `stop_profit = 12000` (120%), the stop triggers when the position value rises such that 120% of the original collateral value would remain after closing (20% profit).

## Stop Action

When a stop is triggered, the keeper executes the `StopMTPosition` action:

```javascript
[{
  StopMTPosition: {
    pos_owner_id: accountId,
    pos_id: position,
    token_p_amount: tokenPAmountBD,
    min_token_d_amount: tokenDAmountBD,
    swap_indication: {
      dex_id: refFinanceContractId,
      swap_action_text: swapMsg  // From smart router
    }
  }
}]
```

## Service Fee

When a stop is successfully executed by the keeper:

1. The contract automatically pays the **service fee to the keeper** (the account that triggered the stop)
2. The fee amount is `MarginStop.service_token_amount` of `MarginStop.service_token_id`
3. The fee is deposited to the keeper's margin account as supplied shares

**The keeper receives the service fee automatically - no additional action needed!**

## Execution Flow

```
1. Check liquidator registration
   └── Verify keeper account is registered with Burrow

2. Fetch margin accounts
   └── get_margin_accounts_paged() with pagination

3. Parse and filter positions with stops
   ├── Parse each account's margin_positions (including stops)
   ├── Filter out locked positions (is_locking = true)
   └── Filter to positions with stop != null

4. Process each position
   ├── Calculate USD values for all tokens
   ├── Calculate hp_fee (holding position interest)
   ├── Check stop conditions (stop_loss and stop_profit)
   └── Get swap route from smart router for token_p → token_d

5. Filter triggered stops
   └── Keep only positions where stopTriggered = true and actions != null

6. Execute (one at a time, randomly selected)
   ├── Randomly select one from triggered stops (avoids keeper competition)
   └── Call oracle-based execution method
```

## Oracle Execution Methods

### With Priceoracle

```javascript
oracle_call(receiver_id: burrowContractId, msg: { MarginExecute: { actions } })
```

### With Pyth Oracle

```javascript
burrowContract.margin_execute_with_pyth({ actions })
```

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `STOP_KEEPER` | Enable stop keeper | `false` |
| `STOP_KEEPER_OFFSET_BPS` | Offset in BPS to trigger stops earlier (see below) | `0` |
| `MARGIN_PAGED_LIMIT` | Page size for fetching margin accounts | `150` |
| `MAX_SLIPPAGE` | Maximum slippage for swaps (%) | `0.5` |

### Offset for Price Movement

There is a short time interval between off-chain evaluation and on-chain execution. During this time, price may move, causing the stop to no longer meet conditions on-chain, wasting gas.

The `STOP_KEEPER_OFFSET_BPS` adds a buffer to trigger stops earlier:

| Stop Type | Formula | Example (offset=1000, i.e. 10%) |
|-----------|---------|--------------------------------|
| Take Profit | `adjusted = stop_profit + (stop_profit - 10000) * offset / 10000` | 130% → 133% |
| Stop Loss | `adjusted = stop_loss * (10000 - offset) / 10000` | 70% → 63% |

**Recommended value**: 500-1000 BPS (5-10%) depending on market volatility.

### Example Configuration

Add to your `run.sh`:

```bash
######## STOP KEEPER SECTION ########
# Enable stop keeper for margin positions
export STOP_KEEPER=true
# Add 10% buffer for price movement
export STOP_KEEPER_OFFSET_BPS=1000
```

## Design Decisions

- **One at a time execution**: Only one triggered stop is executed per loop cycle for safety
- **Random selection**: When multiple stops are triggered, one is randomly selected to avoid competition between multiple keepers (all keepers picking the same stop would waste gas)
- **Configurable offset**: The `STOP_KEEPER_OFFSET_BPS` allows triggering stops earlier to account for price movement between off-chain check and on-chain execution, reducing failed transactions
- **No profit threshold**: Stops are triggered whenever conditions are met, regardless of service fee value (the fee is set by the position owner)
- **Slippage = 0 for checks**: The contract checks stop conditions without slippage, but actual swaps use `MAX_SLIPPAGE`

## Relationship to Margin Liquidation

The stop keeper runs independently from margin liquidation:

| Feature | Purpose | Trigger Condition |
|---------|---------|-------------------|
| Margin Liquidation | Protect protocol from bad debt | Safety buffer violated |
| Margin Force Close | Clean up underwater positions | Collateral < Debt |
| Stop Keeper | Execute user stop orders | User-defined price targets |

All three can be enabled simultaneously and will process positions in order within each loop cycle.
