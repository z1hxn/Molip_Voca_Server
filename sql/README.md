# SQL 실행 가이드

## 1) 실행 파일
- `20260324_add_share_scope.sql`
- `20260324_performance_indexes.sql`

## 2) Supabase SQL Editor에서 실행
1. Supabase 프로젝트로 이동
2. `SQL Editor` 열기
3. `backend/sql/20260324_add_share_scope.sql` 내용 전체 붙여넣기
4. `Run` 실행
5. 성능 인덱스가 필요하면 `backend/sql/20260324_performance_indexes.sql`도 실행

## 3) 적용 확인 쿼리
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'molip_voca'
  and table_name = 'voca_sets'
  and column_name = 'share_scope';
```

```sql
select share_scope, count(*)
from molip_voca.voca_sets
group by share_scope
order by share_scope;
```

```sql
select schemaname, tablename, indexname
from pg_indexes
where schemaname = 'molip_voca'
  and indexname in (
    'voca_sets_owner_updated_idx',
    'voca_sets_folder_updated_idx',
    'voca_sets_share_token_idx',
    'voca_sets_public_updated_idx',
    'voca_collaborators_user_voca_idx',
    'voca_collaborators_voca_user_idx',
    'words_voca_created_idx',
    'word_progress_user_word_idx',
    'study_sessions_user_voca_created_idx'
  )
order by indexname;
```
