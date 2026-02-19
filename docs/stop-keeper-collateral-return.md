# Stop Keeper: Collateral Token Return

## Problem Statement

When a stop order is executed, users prefer to receive their **collateral token** (`token_c`) back, not the position token (`token_p`) or the debt token (`token_d`) if they differ from the collateral.

The current implementation does not fulfill this requirement for the **short position** case (when `token_c != token_d`).

---

## Background: Margin Position Token Roles

| Token    | Role | Example (short NEAR) |
|----------|------|---------|
| `token_c` | Collateral deposited by user | USDC |
| `token_d` | Borrowed debt token | NEAR |
| `token_p` | Position token held after leveraged trade | USDC |

Two position types exist:

| Type  | Condition | Example |
|-------|-----------|---------|
| **Long** | `token_c == token_d` | USDC collateral, USDC debt, NEAR long |
| **Short** | `token_c != token_d` | USDC collateral, NEAR debt, USDC position (`token_c == token_p`) |

The contract enforces that when `token_c != token_d`, then `token_c == token_p` (confirmed in `process_decrease_margin_position` — if `token_p_amount > mt.token_p_amount`, it asserts `token_c_id == token_p_id`).

---

## Contract Behavior (Source: `margin_stop_limit` branch)

### `process_decrease_margin_position` — key excerpt

```rust
if token_p_amount > mt.token_p_amount {
    // Only allowed when token_c == token_p
    assert_eq!(mt.token_c_id, mt.token_p_id, "Not enough position asset balance");
    let gap_shares = asset_p.supplied.amount_to_shares(token_p_amount - mt.token_p_amount, true);
    // The gap is taken from token_c_shares (collateral)
    mt.token_c_shares = mt.token_c_shares.0.checked_sub(gap_shares.0)...;
}
```

When `token_p_amount` exceeds the position's `token_p_amount`, the contract takes the **gap from collateral** (`token_c_shares`). The remaining `token_c_shares` (after the gap) is then returned to the user via `settle_closed_position`.

### `settle_closed_position` — collateral always returned to user

```rust
if position.token_c_shares.0 > 0 {
    benefits.collateral_shares = position.token_c_shares.0;  // → user receives token_c
}
```

### `on_decrease_trade_return` — Stop operation benefit routing

```rust
DecreaseOperation::Stop => {
    deposit_benefit_to_account(&mut account, &position.token_c_id, benefits.collateral_shares);
    deposit_benefit_to_account(&mut account, &position.token_d_id, benefits.debt_token_shares);
    deposit_benefit_to_account(&mut account, &position.token_p_id, benefits.position_token_shares);
}
```

The user receives:
1. **`token_c` shares** — remaining collateral (e.g. USDC)
2. **`token_d` shares** — any leftover after debt repayment (e.g. excess NEAR)
3. **`token_p` shares** — any unused position token (normally 0 after full close)

### Contract validation for stop operation

```rust
if op == "stop" {
    if min_token_d_amount < total_debt_amount + hp_fee {
        assert_eq!(
            mt.token_c_id, mt.token_d_id,
            "Can NOT trade under total debt when margin and debt asset are not the same"
        );
    }
}
```

When `token_c != token_d`, the swap output (`min_token_d_amount`) **must** be `>= total_debt + hp_fee`. This is a hard constraint.

---

## Bug in Current Implementation

**File:** `src/libs/stopKeeper.js`, lines 109–111

```javascript
const tokenPAmountBD = a.token_c_info.token_id == a.token_d_info.token_id
  ? a.token_p_amount
  : a.token_p_amount.add(a.token_c_info.balance);  // ← BUG
```

### Case A: `token_c == token_d` (Long position) — **CORRECT** ✓

- Only `token_p_amount` is swapped (e.g. NEAR → USDC)
- Remaining USDC collateral (`token_c_shares`) is automatically returned to user
- User receives: USDC collateral + any USDC leftover from swap

### Case B: `token_c != token_d` (Short position) — **WRONG** ✗

- Current: swaps **all** of `token_p_amount + token_c_balance` (e.g. all USDC → NEAR)
- The entire collateral is consumed in the swap
- `token_c_shares` becomes 0 (or minimal) → user gets 0 USDC back
- User receives: NEAR (token_d) — **not their original USDC (token_c)**

**The user deposited USDC as collateral. They want USDC back.**

### Why the current code adds all collateral

The concern was: when the position has lost value, `token_p_amount` alone might not cover the total debt. By adding all collateral, the swap is guaranteed to produce enough `token_d` to repay the debt.

However, this "over-swaps" and gives the user token_d instead of token_c.

---

## Correct Behavior

The contract already handles the case where `token_p_amount` alone is insufficient:
- The keeper specifies how much `token_p_amount` to pass
- If `token_p_amount > mt.token_p_amount`, the contract takes the gap from collateral shares
- Any **remaining** collateral shares go back to the user in `token_c`
- Any **remaining** position token (when `token_p_amount` passed is less than `mt.token_p_amount`) is also returned to the user as `token_p` shares — which equals `token_c` in the short case

So the keeper should compute the **minimum** swap input `neededTokenP` that ensures the swap output covers the total debt, then:
1. Take as much as possible from `token_p_amount` (position tokens)
2. Take any shortfall from `token_c_info.balance` (collateral tokens)

This maximises the USDC the user receives — both unused position USDC and unused collateral USDC come back to them, rather than converting excess USDC to NEAR profit.

---

## Plan of Code Changes

### File: `src/libs/stopKeeper.js` — `processStopPosition` function

**Replace** the `tokenPAmountBD` calculation inside `if (a.stopTriggered)`:

#### Old code (lines 109–112):

```javascript
const tokenPAmountBD = a.token_c_info.token_id == a.token_d_info.token_id
  ? a.token_p_amount
  : a.token_p_amount.add(a.token_c_info.balance);
```

#### New code:

```javascript
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
  const neededInputUsd = totalDebtUsd.div(slippageDivisor);
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
```

### No changes to `margin.js`

The **liquidation** and **force-close** code in `margin.js` (line 71) intentionally uses `token_p_amount + token_c_balance` because:
- The liquidator is repaying all debt on behalf of the protocol
- The protocol/liquidator captures all excess value
- There is no user preference for receiving collateral vs. debt token

This is by design and should **not** be changed.

---

## Logic Walkthrough

### Scenario 1: Position value covers debt — take-profit (common case)

Assumptions: NEAR = $10, slippage = 0.5%, position = 900 USDC, collateral = 1000 USDC, debt = 80 NEAR (= $800).

- `neededInputUsd = $800 / 0.995 = ~$804.02`
- `neededTokenP = ~$804.02 / $1-per-USDC = ~804 USDC` (rounded up)
- `804 USDC <= 900 USDC` → `tokenPAmountBD = 804 USDC` (partial position swap)
- Swap 804 USDC → ~80.4 NEAR; repay 80 NEAR debt
- User gets: **96 USDC** (unused position) + **1000 USDC** (collateral) + ~0.4 NEAR leftover ✓
- Total: **1096 USDC + ~0.4 NEAR**

vs. old doc plan (swap all position):
- Swap 900 USDC → ~90 NEAR; repay 80 NEAR debt
- User gets: 0 USDC (position) + 1000 USDC (collateral) + ~10 NEAR
- Total: 1000 USDC + ~10 NEAR ($100) — user misses 96 USDC of profit in their preferred token ✗

### Scenario 2: Position alone insufficient — stop-loss triggered near threshold

Assumptions: NEAR = $10, slippage = 0.5%, position = 700 USDC, collateral = 1000 USDC, debt = 80 NEAR (= $800).

- `neededInputUsd = $800 / 0.995 = ~$804.02`
- `neededTokenP = ~804 USDC`
- `804 USDC > 700 USDC` → shortfall = `804 - 700 = 104 USDC` from collateral
- `tokenPAmountBD = 700 + 104 = 804 USDC` swapped
- Swap 804 USDC → ~80.4 NEAR; repay 80 NEAR debt
- User gets: **896 USDC** (remaining collateral) + ~0.4 NEAR leftover ✓

vs. current (broken):
- Swap 1700 USDC (all position + all collateral) → ~170 NEAR; repay 80 NEAR debt
- User gets: 0 USDC + ~90 NEAR ✗

---

## Unit Considerations

All three balance fields from the view (`token_c_info.balance`, `token_d_info.balance`, `token_p_amount`) are in **inner decimal** (base decimal) units, confirmed by the contract's `margin_trading_position_into_view`:

```rust
token_c_info: self.get_asset_view(mtp.token_c_id, mtp.token_c_shares, false),
// → asset.supplied.shares_to_amount(shares, false) → inner decimal balance

token_d_info: self.get_margin_debt_asset_view(mtp.token_d_id, mtp.token_d_shares),
// → asset.margin_debt.shares_to_amount(shares, true) → inner decimal balance

token_p_amount: mtp.token_p_amount,
// → stored directly in inner decimal
```

Since `token_c == token_p` in the short case (both USDC), all values use the same token and decimal scale. Arithmetic between them is valid.

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Price-based estimate of `neededTokenP` is slightly off | Low-Medium | `round(0, 3)` rounds up; the `1 / slippageDivisor` factor already adds buffer |
| `min_token_d_amount < total_debt + hp_fee` → tx rejected by contract | Low | If this happens, the stop is not triggered; keeper retries next cycle. No funds at risk. |
| `neededTokenP - token_p_amount > token_c_info.balance` | Edge case | Clamped to `token_c_info.balance`; equivalent to current behavior as fallback |

The worst case failure mode is a **rejected transaction** (gas cost only, no fund loss), not incorrect fund routing.
