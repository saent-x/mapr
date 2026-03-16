function toUtf8String(value) {
  if (typeof value === 'string') {
    return value;
  }

  if (value == null) {
    return '';
  }

  return String(value);
}

export function encodeBase64(value) {
  const input = toUtf8String(value);

  if (typeof globalThis.btoa === 'function') {
    const bytes = new TextEncoder().encode(input);
    let binary = '';

    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });

    return globalThis.btoa(binary);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(input, 'utf8').toString('base64');
  }

  throw new Error('No base64 encoder available in this runtime');
}
