-- Feedback changes (November 17, 2026).
--
-- 1. ReactPing no longer reads DMs (Elliot dropped the im:history permission), so feedback comes only from the
--    website form. The Slack sender columns go with it; no row ever used them. Dropping them also drops the
--    table check that required them for Slack rows.
-- 2. `source` now records where the form was opened from: the website itself, or the link in ReactPing's welcome
--    DM or Home tab (UTM-tagged links).
-- 3. Elliot tracks what he did with each piece: a status, when it last changed (kept by a trigger), and a note.
--    Edit status and note in the Supabase Table Editor; status_at updates itself.

alter table reactping_slack.feedback drop column team_id, drop column user_id;

alter table reactping_slack.feedback drop constraint feedback_source_check;
alter table reactping_slack.feedback
  add constraint feedback_source_check check (source in ('website', 'slack_welcome', 'slack_home'));

alter table reactping_slack.feedback
  add column status text not null default 'new' check (status in ('new', 'viewed', 'resolved', 'declined')),
  add column status_at timestamptz,
  add column note text check (char_length(note) <= 5000);

create function reactping_slack.feedback_status_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_at := now();
  end if;
  return new;
end;
$$;

revoke all on function reactping_slack.feedback_status_at() from public, anon, authenticated;

create trigger feedback_status_at
  before update of status on reactping_slack.feedback
  for each row execute function reactping_slack.feedback_status_at();
