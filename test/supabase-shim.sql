-- Test-only stand-in for the parts of Supabase that the migration depends on: the API roles,
-- auth.users, and auth.uid(). Never run this against a real Supabase project.
do $$
begin
  -- Roles are cluster-wide; different test databases initialize concurrently.
  begin
    create role anon nologin;
  exception when duplicate_object or unique_violation then null;
  end;
  begin
    create role authenticated nologin;
  exception when duplicate_object or unique_violation then null;
  end;
end
$$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
