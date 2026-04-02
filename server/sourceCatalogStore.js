const SOURCE_CATALOG_NAMESPACE = process.env.MAPR_SOURCE_CATALOG_NAMESPACE || 'mapr';
const memoryStore = new Map();

function getKvConfig() {
  const baseUrl = (
    process.env.KV_REST_API_URL
    || process.env.UPSTASH_REDIS_REST_URL
    || ''
  ).trim().replace(/\/$/, '');
  const token = (
    process.env.KV_REST_API_TOKEN
    || process.env.UPSTASH_REDIS_REST_TOKEN
    || ''
  ).trim();

  if (!baseUrl || !token) {
    return null;
  }

  return {
    baseUrl,
    token,
    namespace: SOURCE_CATALOG_NAMESPACE
  };
}

function parseJson(value, fallback) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function getNamespacedKey(key, config = getKvConfig()) {
  return config ? `${config.namespace}:${key}` : key;
}

async function runKvCommand(command) {
  const config = getKvConfig();
  if (!config) {
    throw new Error('KV store is not configured');
  }

  const response = await fetch(config.baseUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  if (!response.ok) {
    throw new Error(`KV ${command[0]} failed (${response.status})`);
  }

  const payload = await response.json().catch(() => null);
  return payload?.result ?? null;
}

export function getSourceCatalogStorageInfo() {
  const config = getKvConfig();
  if (config) {
    return {
      backend: 'upstash-kv',
      namespace: config.namespace
    };
  }

  return {
    backend: 'sqlite-metadata',
    namespace: SOURCE_CATALOG_NAMESPACE
  };
}

export async function readSourceCatalogValue(key, fallback = null) {
  const config = getKvConfig();

  if (config) {
    const value = await runKvCommand(['GET', getNamespacedKey(key, config)]);
    return parseJson(value, fallback);
  }

  try {
    const { readMetadataJson } = await import('./storage.js');
    return readMetadataJson(key, fallback);
  } catch {
    return parseJson(memoryStore.get(key), fallback);
  }
}

export async function writeSourceCatalogValue(key, payload) {
  const config = getKvConfig();

  if (config) {
    await runKvCommand(['SET', getNamespacedKey(key, config), JSON.stringify(payload)]);
    return getSourceCatalogStorageInfo();
  }

  try {
    const { writeMetadataJson } = await import('./storage.js');
    await writeMetadataJson(key, payload);
  } catch {
    memoryStore.set(key, JSON.stringify(payload));
  }
  return getSourceCatalogStorageInfo();
}
