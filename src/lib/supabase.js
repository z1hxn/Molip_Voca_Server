import { createClient } from '@supabase/supabase-js'

export const createSupabaseClientFactory = ({ supabaseUrl, anonKey }) => {
  const createSupabaseClient = ({ key = anonKey, token = null } = {}) => createClient(supabaseUrl, key, {
    db: {
      schema: 'molip_voca',
    },
    global: token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : undefined,
  })

  const publicSupabase = createSupabaseClient()
  const createUserClient = (token) => createSupabaseClient({ token })

  return {
    createSupabaseClient,
    publicSupabase,
    createUserClient,
  }
}

