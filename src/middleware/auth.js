export const createAuthMiddleware = ({
  publicSupabase,
  createUserClient,
  authCookieName,
  authCookieDomain,
  authCookieMaxAgeMs,
  authCookieSecure,
}) => {
  const getBearerToken = (req) => {
    const auth = req.headers.authorization
    if (!auth || !auth.startsWith('Bearer ')) return null
    return auth.slice(7)
  }

  const isCookieSecure = authCookieSecure
    ? authCookieSecure === 'true'
    : process.env.NODE_ENV === 'production'

  const resolveCookieBaseOptions = () => {
    const base = {
      httpOnly: true,
      secure: isCookieSecure,
      sameSite: isCookieSecure ? 'none' : 'lax',
      path: '/',
    }

    if (authCookieDomain) {
      return { ...base, domain: authCookieDomain }
    }

    return base
  }

  const setAuthCookie = (res, token) => {
    res.cookie(authCookieName, token, {
      ...resolveCookieBaseOptions(),
      maxAge: Number(authCookieMaxAgeMs || 0),
    })
  }

  const clearAuthCookie = (res) => {
    res.clearCookie(authCookieName, resolveCookieBaseOptions())
  }

  const getRequestToken = (req) => {
    const bearerToken = getBearerToken(req)
    if (bearerToken) return { token: bearerToken, source: 'header' }

    const cookieToken = req.cookies?.[authCookieName]
    if (cookieToken) return { token: cookieToken, source: 'cookie' }

    return { token: null, source: 'none' }
  }

  const authRequired = async (req, res, next) => {
    const { token, source } = getRequestToken(req)
    if (!token) {
      res.status(401).json({ message: 'Unauthorized' })
      return
    }

    const { data, error } = await publicSupabase.auth.getUser(token)
    if (error || !data.user) {
      res.status(401).json({ message: 'Invalid token' })
      return
    }

    req.user = data.user
    req.supabase = createUserClient(token)
    req.authToken = token
    if (source === 'header') {
      setAuthCookie(res, token)
    }
    next()
  }

  const authOptional = async (req, _res, next) => {
    const { token } = getRequestToken(req)
    if (!token) {
      req.user = null
      req.supabase = publicSupabase
      next()
      return
    }

    const { data, error } = await publicSupabase.auth.getUser(token)
    if (error || !data.user) {
      req.user = null
      req.supabase = publicSupabase
      next()
      return
    }

    req.user = data.user
    req.supabase = createUserClient(token)
    next()
  }

  return {
    authRequired,
    authOptional,
    setAuthCookie,
    clearAuthCookie,
  }
}

