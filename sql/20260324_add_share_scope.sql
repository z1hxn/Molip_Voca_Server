alter table if exists molip_voca.voca_sets
  add column if not exists share_scope text default 'private';

update molip_voca.voca_sets
set share_scope = case
  when is_public then 'public'
  else 'private'
end
where share_scope is null
  or share_scope not in ('private', 'unlisted', 'public');

alter table molip_voca.voca_sets
  alter column share_scope set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'voca_sets_share_scope_check'
  ) then
    alter table molip_voca.voca_sets
      add constraint voca_sets_share_scope_check
      check (share_scope in ('private', 'unlisted', 'public'));
  end if;
end $$;

create index if not exists voca_sets_share_scope_idx
  on molip_voca.voca_sets (share_scope);
