-- Merge duplicate Trengo contacts for the same WhatsApp number.
--
-- Trengo can hold several contact records for one phone (a churned-and-recreated
-- number, a duplicate the weekly-update automation made, etc.). Keyed by contact
-- id, the Hub split that one person's history across threads (Roy 2026-07-22).
-- Ingest now writes a canonical `trengo:phone:<E164>` thread_key when the number
-- is known; this function re-keys the HISTORICAL contact-based rows to the same
-- canonical base so old + new merge into one thread.
--
-- The phone normalisation MUST match src/lib/inbox/trengo-contacts.ts
-- normalizePhone(): keep a leading '+' when the source starts with '+' or '00',
-- drop every other non-digit, strip a leading '00'. Idempotent — only rows still
-- on a `trengo:contact:<id>` base are touched — so the backfill cron can call it
-- every run to catch numbers learned since last time.
create or replace function rekey_trengo_threads_by_phone()
returns table(messages_rekeyed bigint, mentions_rekeyed bigint)
language plpgsql
as $$
declare
  m bigint;
  n bigint;
begin
  -- 1. Message rows: trengo:contact:<id>  →  trengo:phone:<E164>
  with upd as (
    update inbox_events e
    set thread_key =
      'trengo:phone:'
      || (case when c.phone ~ '^(\+|00)' then '+' else '' end)
      || regexp_replace(regexp_replace(c.phone, '\D', '', 'g'), '^00', '')
    from trengo_contacts c
    where e.source = 'trengo'
      and e.thread_key = 'trengo:contact:' || c.id
      and c.phone is not null
      and length(regexp_replace(c.phone, '\D', '', 'g')) >= 7
    returning e.id
  )
  select count(*) into m from upd;

  -- 2. Mention fan-out rows: rewrite the base of the stored
  --    trengo_mention_in_thread_key (`trengo:contact:<id>|ch:<n>`), keeping the
  --    channel suffix, so opening a mention still lands on the merged thread.
  with upd2 as (
    update inbox_events e
    set source_ref = jsonb_set(
      e.source_ref,
      '{trengo_mention_in_thread_key}',
      to_jsonb(
        'trengo:phone:'
        || (case when c.phone ~ '^(\+|00)' then '+' else '' end)
        || regexp_replace(regexp_replace(c.phone, '\D', '', 'g'), '^00', '')
        || '|ch:'
        || split_part(e.source_ref->>'trengo_mention_in_thread_key', '|ch:', 2)
      )
    )
    from trengo_contacts c
    where e.source = 'trengo'
      and e.kind = 'update'
      and e.source_ref->>'trengo_mention_in_thread_key' like 'trengo:contact:' || c.id || '|ch:%'
      and c.phone is not null
      and length(regexp_replace(c.phone, '\D', '', 'g')) >= 7
    returning e.id
  )
  select count(*) into n from upd2;

  return query select m, n;
end
$$;
