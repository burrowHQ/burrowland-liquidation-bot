const Big = require("big.js");
const fs = require("fs");
const CryptoJS = require("crypto-js");

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

const printOutcome = (outcome) => {
  let failureMessages = []
  let is_success = Object.values(outcome['receipts_outcome']).reduce((is_success, receipt) => {
    if (receipt["outcome"]["status"].hasOwnProperty("Failure")) {
      failureMessages.push(receipt["outcome"]["status"])
      return false;
    }
    return is_success;
  }, true);
  if (is_success) {
    console.log("");
    console.log("success tx: ", outcome["transaction"]["hash"]);
    console.log("");
  } else {
    console.log("");
    console.log("failed: ");
    console.log(JSON.stringify(failureMessages, undefined, 2));
    console.log("");
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
  printOutcome
};
