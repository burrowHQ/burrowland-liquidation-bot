const Big = require("big.js");
const fs = require("fs");
const path = require('path');
const CryptoJS = require("crypto-js");
const log4js = require('log4js');
const fetch = require("node-fetch");
const liquidateLogger = log4js.getLogger();

const PYTH_STALENESS_THRESHOLD = 60;

const toCamel = (s) => {
  return s.replace(/([-_][a-z])/gi, ($1) => {
    return $1.toUpperCase().replace("-", "").replace("_", "");
  });
};

const isArray = (a) => Array.isArray(a);

const isObject = (o) =>
  o === Object(o) && !isArray(o) && typeof o !== "function";

const keysToCamel = (o) => {
  if (isObject(o)) {
    const n = {};

    Object.keys(o).forEach((k) => {
      n[toCamel(k)] = keysToCamel(o[k]);
    });

    return n;
  } else if (isArray(o)) {
    return o.map((i) => {
      return keysToCamel(i);
    });
  }

  return o;
};

const parseRate = (s) => Big(s).div(Big(10).pow(27));
const parseRatio = (r) => Big(r).div(10000);
const parseTimestamp = (s) => parseFloat(s) / 1e6;

const bigMin = (a, b) => (a.lt(b) ? a : b);

function loadJson(filename, ignoreError = true) {
  try {
    let rawData = fs.readFileSync(filename);
    return JSON.parse(rawData);
  } catch (e) {
    if (!ignoreError) {
      console.error("Failed to load JSON:", filename, e);
    }
  }
  return null;
}

function saveJson(json, filename) {
  try {
    const data = JSON.stringify(json);
    fs.writeFileSync(filename, data);
  } catch (e) {
    console.error("Failed to save JSON:", filename, e);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decryptAES(ciphertext, key) {
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

function logToFile(filePath, logContent) {
  // Check if the file exists
  if (fs.existsSync(filePath)) {
    // Append to the existing file
    fs.appendFile(filePath, '\n' + logContent + '\n', (err) => {
      if (err) {
        console.error(`Error appending to file: ${err}`);
      }
    });
  } else {
    // Create the file and write the content
    fs.writeFile(filePath, logContent + '\n', (err) => {
      if (err) {
        console.error(`Error writing to file: ${err}`);
      }
    });
  }
}

const printOutcome = (prefix, filePath, outcome) => {
  let failureMessages = []
  let is_success = Object.values(outcome['receipts_outcome']).reduce((is_success, receipt) => {
    if (receipt["outcome"]["status"].hasOwnProperty("Failure")) {
      failureMessages.push(receipt["outcome"]["status"])
      return false;
    }
    return is_success;
  }, true);
  if (is_success) {
    logToFile(filePath, new Date() + " success tx: " + outcome["transaction"]["hash"]);
    liquidateLogger.log(prefix, "success tx: ", outcome["transaction"]["hash"]);
  } else {
    liquidateLogger.error(prefix, "failed: ", JSON.stringify(failureMessages, undefined, 2));
  }
}

const getRefExchangeSwapMsg = async (smartrouterUrl, amountIn, tokenIn, tokenOut, slippage=0.005, pathDeep=3, routerCount=2) => {
  const url = `${smartrouterUrl}/swapPath?amountIn=${amountIn}&tokenIn=${tokenIn}&tokenOut=${tokenOut}&pathDeep=${pathDeep}&slippage=${slippage}&routerCount=${routerCount}`;
  const response = await fetch(url);
  const responseJson = await response.json();
  if (responseJson.result_data && responseJson.result_data.args.amount == amountIn) {
    return responseJson.result_data.args.msg
  } else {
    return ""
  }
}

const getSwapActionsMinAmountOut = (actions, targetTokenId) => {
  let amountOut = Big(0);
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].token_out == targetTokenId) {
      amountOut = amountOut.add(Big(actions[i].min_amount_out));
    }
  }
  return amountOut;
}

const sendHeartBeat = async (url, programName) => {
  if (!url) {
    return;
  }

  await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      program_name: programName,
    }),
  });
}

const normalizeSlackMention = (mention) => {
  if (mention.startsWith("<@") && mention.endsWith(">")) {
    return mention;
  }
  return `<@${mention}>`;
}

const sendSlackAlarm = async (NearConfig, alarmHeader, alarmMessage) => {
  if (!NearConfig.slackHookUrl) {
    return;
  }

  const mentions = (NearConfig.slackHookMentions || [])
    .map(normalizeSlackMention)
    .join("");
  const msg = `${mentions}${alarmMessage}`;

  try {
    const response = await fetch(NearConfig.slackHookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: alarmHeader,
            },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: msg,
            },
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Slack alarm failed with status ${response.status}`);
    }
  } catch (error) {
    liquidateLogger.error("Slack alarm error: ", error);
  }
}

module.exports = {
  bigMin,
  keysToCamel,
  parseRate,
  parseRatio,
  parseTimestamp,
  loadJson,
  saveJson,
  sleep,
  PYTH_STALENESS_THRESHOLD,
  decryptAES,
  printOutcome,
  getRefExchangeSwapMsg,
  getSwapActionsMinAmountOut,
  sendHeartBeat,
  sendSlackAlarm,
};
