create index if not exists voca_sets_owner_updated_idx
  on molip_voca.voca_sets (owner_id, updated_at desc);

create index if not exists voca_sets_folder_updated_idx
  on molip_voca.voca_sets (folder_id, updated_at desc);

create index if not exists voca_sets_share_token_idx
  on molip_voca.voca_sets (share_token);

create index if not exists voca_sets_public_updated_idx
  on molip_voca.voca_sets (share_scope, updated_at desc);

create index if not exists voca_collaborators_user_voca_idx
  on molip_voca.voca_collaborators (user_id, voca_id);

create index if not exists voca_collaborators_voca_user_idx
  on molip_voca.voca_collaborators (voca_id, user_id);

create index if not exists words_voca_created_idx
  on molip_voca.words (voca_id, created_at);

create index if not exists word_progress_user_word_idx
  on molip_voca.word_progress (user_id, word_id);

create index if not exists study_sessions_user_voca_created_idx
  on molip_voca.study_sessions (user_id, voca_id, created_at desc);
