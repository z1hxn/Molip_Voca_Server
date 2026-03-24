export const createApiCache = (defaultTtlMs) => {
  const apiCache = new Map()

  const getCachedJson = (key) => {
    const cached = apiCache.get(key)
    if (!cached) return null
    if (cached.expiresAt <= Date.now()) {
      apiCache.delete(key)
      return null
    }
    return cached.value
  }

  const setCachedJson = (key, value, ttl = defaultTtlMs) => {
    apiCache.set(key, {
      value,
      expiresAt: Date.now() + Math.max(0, ttl),
    })
  }

  const clearApiCache = () => {
    apiCache.clear()
  }

  return {
    getCachedJson,
    setCachedJson,
    clearApiCache,
  }
}

