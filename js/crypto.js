/* ==========================================================================
   crypto.js: turns data into a private string and back.
   Steps: JSON -> compress (if the browser can) -> AES-GCM encrypt.
   The AES key is derived from your shared password with PBKDF2, so the
   text is unreadable without the password.
   Layout of the result: 1 byte format, 16 bytes salt, 12 bytes iv, ciphertext.
   ========================================================================== */
(function (DP) {
  "use strict";

  const ITERATIONS = 250000;
  const FORMAT_RAW = 1;      // JSON as-is
  const FORMAT_DEFLATE = 2;  // JSON compressed with deflate-raw

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const supported = () => !!(window.crypto && window.crypto.subtle);
  const canCompress = () =>
    typeof window.CompressionStream === "function" &&
    typeof window.DecompressionStream === "function" &&
    typeof window.Response === "function";

  const toBase64Url = (bytes) => {
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };

  const fromBase64Url = (text) => {
    const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  };

  async function through(bytes, stream) {
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();
    return new Uint8Array(await new window.Response(stream.readable).arrayBuffer());
  }

  async function deriveKey(password, salt) {
    const base = await window.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
    return window.crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encrypt(data, password) {
    let body = encoder.encode(JSON.stringify(data));
    let format = FORMAT_RAW;
    if (canCompress()) {
      body = await through(body, new window.CompressionStream("deflate-raw"));
      format = FORMAT_DEFLATE;
    }
    const salt = window.crypto.getRandomValues(new Uint8Array(16));
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const header = new Uint8Array([format]);
    const key = await deriveKey(password, salt);
    const sealed = new Uint8Array(await window.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header }, key, body));

    const out = new Uint8Array(29 + sealed.length);
    out.set(header, 0);
    out.set(salt, 1);
    out.set(iv, 17);
    out.set(sealed, 29);
    return toBase64Url(out);
  }

  /** Throws if the password is wrong, the text was altered, or the format is unknown. */
  async function decrypt(text, password) {
    const bytes = fromBase64Url(text);
    const format = bytes[0];
    if (format !== FORMAT_RAW && format !== FORMAT_DEFLATE) throw new Error("unknown format");
    const key = await deriveKey(password, bytes.slice(1, 17));
    let body = new Uint8Array(
      await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(17, 29), additionalData: bytes.slice(0, 1) }, key, bytes.slice(29))
    );
    if (format === FORMAT_DEFLATE) {
      if (!canCompress()) throw new Error("this browser cannot decompress");
      body = await through(body, new window.DecompressionStream("deflate-raw"));
    }
    return JSON.parse(decoder.decode(body));
  }

  DP.crypto = { supported, encrypt, decrypt };
})(window.DP = window.DP || {});
