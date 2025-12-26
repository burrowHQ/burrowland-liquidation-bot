# Stop Keeper Feature - Code Audit Report

**Date:** 2024-12-26
**Auditor:** Claude Code
**Scope:** Stop keeper feature implementation for Burrow liquidation bot
**Status:** All issues resolved
**Files Reviewed:**
- `src/libs/stopKeeper.js` (new file)
- `src/libs/burrow.js` (modified)
- `src/libs/margin.js` (modified)
- `src/libs/config.js` (modified)
- `src/liquidate.js` (modified)
- `run.example.sh` (modified)

---

## Executive Summary

The stop keeper feature implementation is **production-ready**. The core logic correctly replicates the contract's `is_stop_active` function and follows existing codebase patterns. All identified issues have been resolved.

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | - |
| High | 1 | Fixed |
| Medium | 3 | Fixed |
| Low | 4 | Fixed |
| Informational | 3 | N/A |

---

## Findings

### HIGH-1: Missing Null Check for Asset Prices [FIXED]

**File:** `src/libs/stopKeeper.js:67-73`

**Description:** The code uses optional chaining for `prices?.prices[token_id]` but did not validate that the price actually exists before using its properties.

**Impact:** Bot crash when processing positions with tokens not supported by the price oracle.

**Resolution:** Added explicit null checks that return early with a warning log:

```javascript
if (!a.c_asset || !a.d_asset || !a.p_asset || !a.c_price || !a.d_price || !a.p_price) {
  stopKeeperLogger.warn(`Missing asset or price data for position ${a.accountId}:${a.position}, skipping`);
  a.stopTriggered = false;
  a.actions = null;
  return a;
}
```

---

### MEDIUM-1: Potential Integer Overflow with Large Offset Values [FIXED]

**File:** `src/libs/config.js:134-135`

**Description:** The offset calculation did not validate the `offsetBps` parameter bounds. If `offsetBps > 10000`, this would result in a negative multiplier, inverting the stop-loss logic.

**Impact:** Incorrect stop trigger behavior with misconfigured offset values.

**Resolution:** Added validation in config.js to clamp offset to valid range (0-5000):

```javascript
config.stopKeeperOffsetBps = Math.min(Math.max(parseInt(process.env.STOP_KEEPER_OFFSET_BPS) || 0, 0), 5000);
```

---

### MEDIUM-2: Unused `liquidator` Parameter [FIXED]

**File:** `src/libs/stopKeeper.js:179`, `src/libs/burrow.js:363`

**Description:** The `liquidator` parameter was passed to the main function but never used.

**Impact:** Minor code smell; unnecessary parameter passing.

**Resolution:** Removed the unused `liquidator` parameter from both the function signature and the call site.

---

### MEDIUM-3: Negative HP Fee Not Handled [FIXED]

**File:** `src/libs/stopKeeper.js:88-90`

**Description:** The HP fee calculation may produce negative values if `uahpi_at_open > unitAccHpInterest`, but this edge case was silently ignored.

**Impact:** Minimal in practice, as this scenario indicates a contract bug, but silent failures make debugging difficult.

**Resolution:** Added warning log for this edge case:

```javascript
if (hp_fee.lt(Big(0))) {
  stopKeeperLogger.warn(`Negative HP fee detected for ${a.accountId}:${a.position}, treating as zero`);
}
```

---

### LOW-1: Missing Input Validation for Stop Object [FIXED]

**File:** `src/libs/stopKeeper.js:37, 49`

**Description:** The code checked `if (stop.stop_loss)` and `if (stop.stop_profit)` but didn't validate that these are valid numbers within the expected BPS range.

**Impact:** Malformed data from the contract could cause unexpected behavior.

**Resolution:** Added BPS range validation matching contract rules:

```javascript
// stop_loss: valid range 1-9999 BPS
if (stop.stop_loss && stop.stop_loss > 0 && stop.stop_loss < BPS_BASE) { ... }

// stop_profit: valid range > 10000 BPS
if (stop.stop_profit && stop.stop_profit > BPS_BASE) { ... }
```

---

### LOW-2: Synchronous Logging in Async Context [FIXED]

**File:** `src/libs/stopKeeper.js:133`

**Description:** Error logging used string concatenation instead of template literals.

**Impact:** Minor log readability issue.

**Resolution:** Updated to use template literals:

```javascript
stopKeeperLogger.error(`Missing swap route for stop: ${a.token_p_id} -> ${a.token_d_info.token_id}`);
```

---

### LOW-3: Magic Numbers in Code [FIXED]

**File:** `src/libs/stopKeeper.js:8-9`

**Description:** The value `10000` appeared multiple times representing BPS base.

**Impact:** Code maintainability.

**Resolution:** Defined a constant and replaced all occurrences:

```javascript
const BPS_BASE = 10000;
```

---

### LOW-4: No Rate Limiting for Smart Router Calls [FIXED]

**File:** `src/libs/stopKeeper.js:12, 193-202`

**Description:** When multiple stops are triggered, `processStopPosition` was called in parallel via `Promise.all`, each making a smart router API call. This could overwhelm the API.

**Impact:** API rate limiting or ban if many positions have stops.

**Resolution:** Added batch processing with configurable batch size:

```javascript
const SMART_ROUTER_BATCH_SIZE = 10;

// Process positions in batches to avoid overwhelming smart router API
const processedPositions = [];
for (let i = 0; i < stopPositions.length; i += SMART_ROUTER_BATCH_SIZE) {
  const batch = stopPositions.slice(i, i + SMART_ROUTER_BATCH_SIZE);
  const batchResults = await Promise.all(
    batch.map(pos => processStopPosition(pos, assets, prices, NearConfig))
  );
  processedPositions.push(...batchResults);
}
```

---

### INFO-1: Contract Logic Verification

**Verified:** The `isStopActive` function correctly replicates the contract's logic from `margin_position.rs:147-176`.

| Aspect | Contract | Implementation | Match |
|--------|----------|----------------|-------|
| Stop Loss Formula | `(pos + col) * (10000-slip) < col * stop_loss + debt + hp_fee` | `totalCap < targetRemain + totalDebt` | Yes (slippage=0) |
| Stop Profit Formula | `(pos + col) * (10000-slip) > col * stop_profit + debt + hp_fee` | `totalCap > targetRemain + totalDebt` | Yes (slippage=0) |
| Slippage on Check | 0 (line 614) | 0 | Yes |

---

### INFO-2: Offset Formula Verification

The offset formulas are correctly implemented:

| Stop Type | Formula | Example (offset=1000) |
|-----------|---------|----------------------|
| Stop Loss | `stop_loss * (10000 - offset) / 10000` | 7000 * 0.9 = 6300 |
| Stop Profit | `stop_profit + (stop_profit - 10000) * offset / 10000` | 13000 + 300 = 13300 |

---

### INFO-3: Random Selection Implementation

**File:** `src/libs/stopKeeper.js:186`

```javascript
const randomIndex = Math.floor(Math.random() * triggeredStops.length);
```

`Math.random()` is sufficient for this use case (avoiding keeper competition). For cryptographically secure randomness, `crypto.randomInt()` would be preferred, but it's unnecessary here.

---

## Security Considerations

### Access Control
- The keeper executes transactions using the configured `NEAR_ACCOUNT_ID`
- No additional access control is implemented (relies on NEAR account security)
- Service fees are automatically distributed by the contract

### Economic Risks
- **Front-running:** Other keepers could observe triggered stops and attempt to execute first
  - Mitigated by random selection
  - Further mitigation: Consider adding random delay before execution
- **Failed Transactions:** Gas is consumed even if the stop condition is no longer valid on-chain
  - Mitigated by offset buffer feature

### Data Integrity
- All price data comes from the oracle (trusted source)
- Stop parameters come from the contract (trusted source)
- Swap routes come from Ref smart router (trusted source)

---

## Gas Analysis

| Operation | Estimated Gas |
|-----------|---------------|
| `oracle_call` / `margin_execute_with_pyth` | 300 TGas |
| RPC calls (shared) | N/A (view calls) |

The gas limit of 300 TGas matches the existing margin liquidation pattern.

---

## Recommendations Summary

| Priority | Action | Status |
|----------|--------|--------|
| High | Add null checks for missing price data | Done |
| Medium | Validate offset BPS range in config | Done |
| Medium | Remove unused `liquidator` parameter | Done |
| Medium | Add logging for negative HP fee edge case | Done |
| Low | Add input validation for stop object | Done |
| Low | Use template literals for logging | Done |
| Low | Add constant for BPS_BASE (10000) | Done |
| Low | Add rate limiting for smart router API calls | Done |

---

## Conclusion

The stop keeper implementation is well-structured and follows existing patterns in the codebase. The core logic correctly implements the contract's stop condition checking with the appropriate slippage=0 behavior. The offset feature provides a useful buffer for price movement.

**All identified issues have been resolved.** The implementation is now production-ready.

---

## Appendix: File Changes Summary

| File | Lines Added | Lines Removed | Type |
|------|-------------|---------------|------|
| `src/libs/stopKeeper.js` | 201 | 0 | New |
| `src/libs/burrow.js` | 32 | 8 | Modified |
| `src/libs/margin.js` | 5 | 20 | Modified |
| `src/libs/config.js` | 3 | 0 | Modified |
| `src/liquidate.js` | 1 | 0 | Modified |
| `run.example.sh` | 4 | 0 | Modified |
