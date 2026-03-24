export const createResolveVocaAccess = ({ normalizeShareScope, deriveIsPublic }) => {
  return async (supabase, vocaId, userId = null) => {
    const { data: voca, error: vocaError } = await supabase
      .from('voca_sets')
      .select('id, owner_id, share_scope, is_public')
      .eq('id', vocaId)
      .maybeSingle()

    if (vocaError) {
      return { error: vocaError, voca: null, canRead: false, role: null }
    }
    if (!voca) {
      return { error: null, voca: null, canRead: false, role: null }
    }

    const shareScope = normalizeShareScope(voca.share_scope, Boolean(voca.is_public))
    const isOwner = Boolean(userId && voca.owner_id === userId)
    let collaboratorRole = null

    if (userId && !isOwner) {
      const { data: collaborator, error: collaboratorError } = await supabase
        .from('voca_collaborators')
        .select('role')
        .eq('voca_id', vocaId)
        .eq('user_id', userId)
        .maybeSingle()

      if (collaboratorError) {
        return { error: collaboratorError, voca: null, canRead: false, role: null }
      }
      collaboratorRole = collaborator?.role || null
    }

    const role = isOwner ? 'owner' : collaboratorRole
    const canRead = isOwner || Boolean(collaboratorRole) || shareScope === 'public' || shareScope === 'unlisted'

    return {
      error: null,
      voca: {
        ...voca,
        share_scope: shareScope,
        is_public: deriveIsPublic(shareScope),
      },
      canRead,
      role: role || null,
    }
  }
}

