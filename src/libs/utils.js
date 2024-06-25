const Big = require("big.js");
const fs = require("fs");
const path = require('path');
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
  logToFile
};
