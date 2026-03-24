const SHARE_SCOPES = new Set(['private', 'unlisted', 'public'])

export const normalizeShareScope = (scope, isPublicFallback = false) => {
  if (typeof scope === 'string' && SHARE_SCOPES.has(scope)) {
    return scope
  }
  return isPublicFallback ? 'public' : 'private'
}

export const deriveIsPublic = (shareScope) => shareScope !== 'private'

export const withShareScope = (row) => {
  if (!row) return row
  const shareScope = normalizeShareScope(row.share_scope, Boolean(row.is_public))
  return {
    ...row,
    share_scope: shareScope,
    is_public: deriveIsPublic(shareScope),
  }
}

export const isShareScopeColumnMissing = (error) => {
  if (!error) return false
  const message = String(error.message || '').toLowerCase()
  return error.code === '42703' || message.includes('share_scope')
}

export const normalizeMeaningValue = (value) => String(value || '')
  .split(',')
  .map((part) => part.trim())
  .filter(Boolean)
  .join(', ')

