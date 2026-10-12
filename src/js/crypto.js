window.NoteApp = window.NoteApp || {};

(function (App) {
  'use strict';

  var PREFIX = 'enc:v1:';

  var SALT_BYTES = 16;

  var IV_BYTES = 12;

  var TAG_BYTES = 16;

  var DEFAULT_ITERATIONS = 600000;

  var MIN_ITERATIONS = 1000;
  var MAX_ITERATIONS = 10000000;

  var CHECK_TEXT = 'notebook-vault-check-v1';

  var key = null;

  var vaultExists = false;

  var enrolling = false;

  function subtle() {
    return window.crypto && window.crypto.subtle ? window.crypto.subtle : null;
  }

  function isSupported() {
    return !!subtle()
      && typeof window.TextEncoder === 'function'
      && typeof window.TextDecoder === 'function'
      && !!(window.crypto && typeof window.crypto.getRandomValues === 'function');
  }

  function unsupportedMessage() {
    return 'This browser does not expose WebCrypto (crypto.subtle), so notes cannot be '
      + 'encrypted or decrypted here. Nothing has been changed.';
  }

  var encoder = null;
  var decoder = null;

  function encodeUtf8(text) {
    if (!encoder) encoder = new window.TextEncoder();
    return encoder.encode(text);
  }

  function decodeUtf8(bytes) {
    if (!decoder) decoder = new window.TextDecoder();
    return decoder.decode(bytes);
  }

  var BASE64_CHUNK = 0x8000;

  function bytesToBase64(bytes) {
    var binary = '';
    for (var i = 0; i < bytes.length; i += BASE64_CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK));
    }
    return window.btoa(binary);
  }

  function base64ToBytes(text) {
    var binary = window.atob(text);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function randomBytes(count) {
    var bytes = new Uint8Array(count);
    window.crypto.getRandomValues(bytes);
    return bytes;
  }

  function toBytes(value) {
    if (!value) return new Uint8Array(0);
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value.buffer instanceof ArrayBuffer && typeof value.byteLength === 'number') {
      return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
    }
    return new Uint8Array(value);
  }

  function isEnvelope(value) {
    return typeof value === 'string' && value.indexOf(PREFIX) === 0;
  }

  function isPlaintext(value) {
    return !isEnvelope(value);
  }

  function decodeEnvelope(value) {
    var bytes;
    try {
      bytes = base64ToBytes(value.slice(PREFIX.length));
    } catch (err) {
      throw new Error('An encrypted record could not be read: its stored form is not valid base64. It may be damaged.');
    }
    if (bytes.length < IV_BYTES + TAG_BYTES) {
      throw new Error('An encrypted record is truncated (' + bytes.length + ' bytes; at least '
        + (IV_BYTES + TAG_BYTES) + ' are needed). It may have been cut short by a failed write.');
    }
    return { iv: bytes.subarray(0, IV_BYTES), body: bytes.subarray(IV_BYTES) };
  }

  function damageError() {
    return new Error('An encrypted record could not be decrypted: its contents do not match this '
      + 'key. It may be damaged, or it may have been written with a different password.');
  }

  function lockedError() {
    return new Error('This notebook is locked. Unlock it with your password first.');
  }

  function noVaultError() {
    return new Error('A record in this notebook is encrypted, but there is no vault key to read it '
      + 'with. Nothing has been changed.');
  }

  function deriveKey(password, salt, iterations) {
    return subtle().importKey('raw', encodeUtf8(password), 'PBKDF2', false, ['deriveKey'])
      .then(function (base) {
        return subtle().deriveKey(
          { name: 'PBKDF2', salt: salt, iterations: iterations, hash: 'SHA-256' },
          base,
          { name: 'AES-GCM', length: 256 },
          false,
          ['encrypt', 'decrypt']);
      });
  }

  function seal(withKey, bytes) {
    var iv = randomBytes(IV_BYTES);
    return subtle().encrypt({ name: 'AES-GCM', iv: iv }, withKey, bytes).then(function (cipher) {
      var packed = new Uint8Array(iv.length + cipher.byteLength);
      packed.set(iv, 0);
      packed.set(new Uint8Array(cipher), iv.length);
      return PREFIX + bytesToBase64(packed);
    });
  }

  function openBytes(withKey, value) {
    var parts;
    try {
      parts = decodeEnvelope(value);
    } catch (err) {
      return Promise.reject(err);
    }
    return subtle().decrypt({ name: 'AES-GCM', iv: parts.iv }, withKey, parts.body)
      .then(function (plain) { return new Uint8Array(plain); }, function () { throw damageError(); });
  }

  function openText(withKey, value) {
    return openBytes(withKey, value).then(function (bytes) { return decodeUtf8(bytes); });
  }

  function sealing() {
    return !!key && (vaultExists || enrolling);
  }

  function encrypt(text) {
    var plain = text === null || text === undefined ? '' : String(text);
    if (!sealing()) {
      if (vaultExists) return Promise.reject(lockedError());
      return Promise.resolve(text);
    }
    return seal(key, encodeUtf8(plain));
  }

  function decrypt(value) {
    if (!isEnvelope(value)) return Promise.resolve(value);
    if (!sealing()) {
      return Promise.reject(vaultExists ? lockedError() : noVaultError());
    }
    return openText(key, value);
  }

  function encryptBytes(value) {
    var bytes = toBytes(value);
    if (!sealing()) {
      if (vaultExists) return Promise.reject(lockedError());
      return Promise.resolve(value);
    }
    return seal(key, bytes);
  }

  function decryptBytes(value) {
    if (!isEnvelope(value)) return Promise.resolve(value);
    if (!sealing()) {
      return Promise.reject(vaultExists ? lockedError() : noVaultError());
    }
    return openBytes(key, value);
  }

  function normaliseIterations(value) {
    var n = Number(value);
    return n >= MIN_ITERATIONS && n <= MAX_ITERATIONS ? Math.floor(n) : DEFAULT_ITERATIONS;
  }

  function readStoredIterations(value) {
    var n = Number(value);
    if (!isFinite(n) || Math.floor(n) !== n || n < MIN_ITERATIONS || n > MAX_ITERATIONS) {
      throw new Error('The vault metadata in this notebook is damaged: the stored key '
        + 'derivation count is missing or out of range, so the key cannot be derived.');
    }
    return n;
  }

  function beginEnrollment(password, iterations) {
    if (!isSupported()) return Promise.reject(new Error(unsupportedMessage()));
    if (vaultExists || enrolling) return Promise.reject(new Error('This notebook already has a vault.'));

    var iters = normaliseIterations(iterations);
    var salt = randomBytes(SALT_BYTES);
    return deriveKey(String(password), salt, iters).then(function (derived) {
      var iv = randomBytes(IV_BYTES);
      return subtle().encrypt({ name: 'AES-GCM', iv: iv }, derived, encodeUtf8(CHECK_TEXT))
        .then(function (cipher) {
          key = derived;
          enrolling = true;
          return {
            salt: bytesToBase64(salt),
            iterations: iters,
            check_iv: bytesToBase64(iv),
            check_ct: bytesToBase64(new Uint8Array(cipher)),
          };
        });
    });
  }

  function finishEnrollment() {
    if (!enrolling) return;
    enrolling = false;
    vaultExists = true;
  }

  function cancelEnrollment() {
    enrolling = false;
    key = null;
  }

  function unlock(row, password) {
    if (!isSupported()) return Promise.reject(new Error(unsupportedMessage()));
    if (!row) return Promise.reject(new Error('This notebook has no vault.'));

    var salt, iv, ct;
    try {
      salt = base64ToBytes(row.salt);
      iv = base64ToBytes(row.check_iv);
      ct = base64ToBytes(row.check_ct);
    } catch (err) {
      return Promise.reject(new Error('The vault record is damaged: its stored salt or check value is not readable.'));
    }
    if (salt.length !== SALT_BYTES) {
      return Promise.reject(new Error('The vault record is damaged: the stored salt is the wrong length.'));
    }
    if (iv.length !== IV_BYTES || ct.length <= TAG_BYTES) {
      return Promise.reject(new Error('The vault record is damaged: the stored check value is the wrong length.'));
    }

    var iterations;
    try {
      iterations = readStoredIterations(row.iterations);
    } catch (err) {
      return Promise.reject(err);
    }

    return deriveKey(String(password), salt, iterations).then(function (derived) {
      return subtle().decrypt({ name: 'AES-GCM', iv: iv }, derived, ct).then(function () {
        key = derived;
        vaultExists = true;
        enrolling = false;
        return true;
      }, function () {
        return Promise.reject(new Error('That password is not the one this notebook was encrypted with.'));
      });
    });
  }

  function lock() {
    key = null;
  }

  function adoptKey(restored) {
    if (!restored) return false;
    key = restored;
    vaultExists = true;
    enrolling = false;
    return true;
  }

  function currentKey() {
    return key;
  }

  function setVaultExists(exists) {
    vaultExists = !!exists;
    if (!vaultExists) {
      key = null;
      enrolling = false;
    }
  }

  function isActive() {
    return vaultExists || enrolling;
  }

  function isUnlocked() {
    return !!key;
  }

  function status() {
    if (enrolling) return 'unlocked';
    if (!vaultExists) return 'off';
    return key ? 'unlocked' : 'locked';
  }

  App.crypto = {
    ENVELOPE_PREFIX: PREFIX,
    DEFAULT_ITERATIONS: DEFAULT_ITERATIONS,
    CHECK_TEXT: CHECK_TEXT,

    isSupported: isSupported,
    unsupportedMessage: unsupportedMessage,

    isEnvelope: isEnvelope,
    isPlaintext: isPlaintext,

    status: status,
    isActive: isActive,
    isUnlocked: isUnlocked,
    setVaultExists: setVaultExists,

    beginEnrollment: beginEnrollment,
    finishEnrollment: finishEnrollment,
    cancelEnrollment: cancelEnrollment,
    unlock: unlock,
    lock: lock,
    adoptKey: adoptKey,
    currentKey: currentKey,

    encrypt: encrypt,
    decrypt: decrypt,
    encryptBytes: encryptBytes,
    decryptBytes: decryptBytes,
  };
})(window.NoteApp);
