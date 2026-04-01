const fetch = require("node-fetch");

const RETRYABLE_ERROR_PATTERNS = [
  /nonce/i,
  /expired/i,
  /block hash/i,
  /transaction is outdated/i,
  /invalid transaction/i,
];

const normalizeGas = (gas) => gas?.toString() || "0";
const normalizeDeposit = (attachedDeposit) => attachedDeposit?.toString() || "0";

const isRetryableBroadcastError = (error) => {
  const message = error?.message || JSON.stringify(error);
  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message));
};

const getRecentBlock = async (provider) => {
  const block = await provider.block({ finality: "final" });
  return {
    recentBlockHash: block.header.hash,
    blockHeight: Number(block.header.height),
  };
};

const remoteSignTransaction = async ({
  NearConfig,
  signerAccountId,
  receiverId,
  nonce,
  recentBlockHash,
  methodName,
  args,
  gas,
  attachedDeposit,
}) => {
  if (!NearConfig.remoteSignerUrl) {
    throw new Error("Missing REMOTE_SIGNER_URL for remote signing mode");
  }

  const response = await fetch(NearConfig.remoteSignerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(NearConfig.remoteSignerApiKey ? { "X-API-Key": NearConfig.remoteSignerApiKey } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `sign-${Date.now()}`,
      method: NearConfig.remoteSignerMethod,
      params: {
        signer_account_id: signerAccountId,
        receiver_id: receiverId,
        nonce: nonce.toString(),
        recent_block_hash: recentBlockHash,
        actions: [
          {
            type: "FunctionCall",
            method: methodName,
            args_base64: Buffer.from(JSON.stringify(args || {})).toString("base64"),
            gas: normalizeGas(gas),
            deposit: normalizeDeposit(attachedDeposit),
          },
        ],
      },
    }),
    timeout: NearConfig.remoteSignerTimeoutMs,
  });

  const responseJson = await response.json();
  if (responseJson.error) {
    throw new Error(`Remote signer error: ${JSON.stringify(responseJson.error)}`);
  }

  const result = responseJson.result;
  if (!result?.signed_transaction) {
    throw new Error("Remote signer response missing signed_transaction");
  }

  return result.signed_transaction;
};

const broadcastSignedTransaction = async (provider, signedTransaction) => {
  return await provider.sendJsonRpc("broadcast_tx_commit", [signedTransaction]);
};

const sendRemoteFunctionCall = async ({ provider, NearConfig, signerAccountId, request, retryCount = 0 }) => {
  const { recentBlockHash, blockHeight } = await getRecentBlock(provider);
  const nonce = blockHeight * 10 ** 6;
  const signedTransaction = await remoteSignTransaction({
    NearConfig,
    signerAccountId,
    receiverId: request.contractId,
    nonce,
    recentBlockHash,
    methodName: request.methodName,
    args: request.args,
    gas: request.gas,
    attachedDeposit: request.attachedDeposit,
  });

  try {
    return await broadcastSignedTransaction(provider, signedTransaction);
  } catch (error) {
    if (retryCount >= 1 || !isRetryableBroadcastError(error)) {
      throw error;
    }
    return await sendRemoteFunctionCall({ provider, NearConfig, signerAccountId, request, retryCount: retryCount + 1 });
  }
};

const createTxSender = ({ account, provider, NearConfig, signerAccountId }) => {
  if (NearConfig.txSigningMode === "remote") {
    return {
      sendFunctionCall: async ({ contractId, methodName, args = {}, gas, attachedDeposit = "0" }) => {
        return await sendRemoteFunctionCall({
          provider,
          NearConfig,
          signerAccountId,
          request: { contractId, methodName, args, gas, attachedDeposit },
        });
      },
    };
  }

  return {
    sendFunctionCall: async ({ contractId, methodName, args = {}, gas, attachedDeposit = "0" }) => {
      return await account.functionCall({
        contractId,
        methodName,
        args,
        gas,
        attachedDeposit,
      });
    },
  };
};

module.exports = {
  createTxSender,
};
