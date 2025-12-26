# Margin Liquidation

This document explains how margin position liquidation works in the Burrow liquidation bot.

## Margin Position Structure

Each margin position contains:

| Field | Description |
|-------|-------------|
| `token_c_info` | Collateral token (token_id + balance) |
| `token_d_info` | Debt token (token_id + balance) |
| `token_p_id` / `token_p_amount` | Position token and amount (the leveraged position) |
| `debt_cap` | Debt ceiling for the position |
| `uahpi_at_open` | Unit accumulated holding position interest at position open time |
| `is_locking` | Whether the position is locked (locked positions cannot be liquidated) |

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

## Liquidation Conditions

### Standard Liquidation

A position is liquidatable when it violates the safety buffer but still has positive equity:

```
total_cap >= total_debt AND
total_cap - (total_cap * min_safety_buffer) < total_debt
```

Where `min_safety_buffer` is fetched from `marginBaseTokenLimitPaged[baseTokenId]` or the default margin base token limit.

### Force Close (Bad Debt)

A position requires force close when collateral is worth less than debt:

```
total_cap < total_debt
```

## Liquidation Modes

### 1. Standard Mode (`LiquidateMTPosition`)

Used when `MARGIN_LIQUIDATE_DIRECT_MODE=false` (default).

**Action:**
```javascript
[{
  LiquidateMTPosition: {
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

**Profit calculation:**
```javascript
profit = (total_cap - total_debt) * liq_benefit_liquidator_rate / 10000
```

The Burrow contract handles swapping the position token to debt token via Ref Finance.

### 2. Direct Mode (`LiquidateMTPositionDirect`)

Used when `MARGIN_LIQUIDATE_DIRECT_MODE=true`.

**Actions:**
```javascript
[
  {
    Borrow: {
      token_id: debt_token_id,
      amount: debt_balance * 1.0000001  // Small buffer for rounding
    }
  },
  {
    LiquidateMTPositionDirect: {
      pos_owner_id: accountId,
      pos_id: position
    }
  }
]
```

**Profit calculation:**
```javascript
profit = total_cap - total_debt  // Full profit to liquidator
```

The liquidator first borrows the debt token, then directly liquidates the position.

### Force Close Mode (`ForceCloseMTPosition`)

Used for bad debt positions where `total_cap < total_debt`.

**Action:**
```javascript
[{
  ForceCloseMTPosition: {
    pos_owner_id: accountId,
    pos_id: position,
    token_p_amount: tokenPAmountBD,
    min_token_d_amount: tokenDAmountBD,
    swap_indication: {
      dex_id: refFinanceContractId,
      swap_action_text: swapMsg
    }
  }
}]
```

**Loss calculation:**
```javascript
loss = total_debt - total_cap
```

Force close accounts are sorted by loss (highest first) and executed if loss >= `MARGIN_FORCE_CLOSE_MIN_LOSS`.

## Execution Flow

```
1. Fetch margin accounts
   └── get_margin_accounts_paged() with pagination

2. Parse and filter accounts
   ├── Parse each account's margin_positions
   └── Filter out locked positions (is_locking = true)

3. Process each account
   ├── Calculate USD values for all tokens
   ├── Calculate hp_fee (holding position interest)
   ├── Check liquidation/forceclose conditions
   └── Get swap route from smart router for token_p → token_d

4. Categorize accounts
   ├── liquidationAccounts (is_liquidation = true)
   └── forcecloseAccounts (is_forceclose = true)

5. Sort accounts
   ├── Liquidation: by profit DESC (most profitable first)
   └── Force close: by loss DESC (highest loss first)

6. Execute (one at a time)
   ├── Check profit >= MIN_PROFIT or loss >= MARGIN_FORCE_CLOSE_MIN_LOSS
   └── Call oracle-based execution method

7. Withdraw profits
   └── Withdraw any supplied tokens from margin account
```

## Oracle Execution Methods

### With Priceoracle

```javascript
// Standard mode
oracle_call(receiver_id: burrowContractId, msg: { MarginExecute: { actions } })

// Direct mode
oracle_call(receiver_id: burrowContractId, msg: { Execute: { actions } })
```

### With Pyth Oracle

```javascript
// Standard mode
burrowContract.margin_execute_with_pyth({ actions })

// Direct mode
burrowContract.execute_with_pyth({ actions })
```

## Swap Route Generation

The bot uses Ref Finance's smart router to find optimal swap paths:

```javascript
const swapMsg = await getRefExchangeSwapMsg(
  smartrouterUrl,
  tokenPAmountSTDD,      // Amount of position token to swap
  token_p_id,            // Position token (input)
  token_d_info.token_id, // Debt token (output)
  maxSlippage / 100      // Slippage tolerance
);
```

If no swap route is found, the position is skipped with an error log.

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `MARGIN_LIQUIDATE` | Enable margin liquidation | `false` |
| `MARGIN_LIQUIDATE_DIRECT_MODE` | Use direct liquidation mode | `false` |
| `MARGIN_FORCE_CLOSE` | Enable margin force close | `false` |
| `MARGIN_FORCE_CLOSE_MIN_LOSS` | Minimum loss to trigger force close | `1` |
| `MIN_PROFIT` | Minimum profit threshold (USD) | `1.0` |
| `MARGIN_PAGED_LIMIT` | Page size for fetching margin accounts | `150` |
| `MAX_SLIPPAGE` | Maximum slippage for swaps (%) | `0.5` |
