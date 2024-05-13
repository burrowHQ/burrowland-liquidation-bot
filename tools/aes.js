const CryptoJS = require("crypto-js");

function encryptAES(text, key) {
  return CryptoJS.AES.encrypt(text, key).toString();
}

function decryptAES(ciphertext, key) {
  const bytes = CryptoJS.AES.decrypt(ciphertext, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

const key = "YOUR_PASSWORD";
const plaintext = "YOUR_PRIVATE_KEY(ed25519:xxxxx)";
const ciphertext = encryptAES(plaintext, key);
const decryptedText = decryptAES(ciphertext, key);

console.log("Plaintext:", plaintext);
console.log("Ciphertext:", ciphertext);
console.log("Decrypted text:", decryptedText);