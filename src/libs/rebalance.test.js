const test = require("node:test");
const assert = require("node:assert/strict");

const { unstakeXrhea } = require("./rebalance");

const NearConfig = {
  accountId: "bot.near",
  xrheaContractId: "xtoken.rhealab.near",
};

test("claims existing unlocked requests before requesting and claiming the current balance", async () => {
  const calls = [];
  const requests = [
    { id: "12", status: "Pending", lock_days: 0, unlock_at_sec: "0" },
    { id: "13", status: "Pending", lock_days: 7, unlock_at_sec: "9999999999" },
    { id: "14", status: "Claiming", lock_days: 0, unlock_at_sec: "0" },
  ];
  const xrheaContract = {
    get_account_unstake_requests: async (args) => {
      assert.deepEqual(args, { account_id: NearConfig.accountId });
      return [...requests];
    },
    ft_balance_of: async () => "279095955330913536571",
  };
  const txSender = {
    sendFunctionCall: async (call) => {
      calls.push(call);
      if (call.methodName === "claim_unstake") {
        requests.splice(requests.findIndex((request) => request.id === call.args.request_id), 1);
      } else {
        requests.push({ id: "15", status: "Pending", lock_days: 0, unlock_at_sec: "0" });
      }
    },
  };

  await unstakeXrhea({ xrheaContract, txSender, NearConfig });

  assert.deepEqual(calls.map(({ methodName, args }) => [methodName, args]), [
    ["claim_unstake", { request_id: "12" }],
    ["request_unstake", { amount: "279095955330913536571", lock_days: 0 }],
    ["claim_unstake", { request_id: "15" }],
  ]);
  assert.equal(calls[0].attachedDeposit, "1");
  assert.equal(calls[1].attachedDeposit, "10000000000000000000000");
  assert.equal(calls[2].attachedDeposit, "1");
  assert.ok(calls.every(({ contractId }) => contractId === NearConfig.xrheaContractId));
});

test("claims matured requests even when the xRHEA balance is zero", async () => {
  const calls = [];
  const xrheaContract = {
    get_account_unstake_requests: async () => [
      { id: "21", status: "Pending", lock_days: 7, unlock_at_sec: "0" },
    ],
    ft_balance_of: async () => "0",
  };
  const txSender = { sendFunctionCall: async (call) => calls.push(call) };

  await unstakeXrhea({ xrheaContract, txSender, NearConfig });

  assert.deepEqual(calls.map(({ methodName, args }) => [methodName, args]), [
    ["claim_unstake", { request_id: "21" }],
  ]);
});
