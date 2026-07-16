-- Profile photos. Each Hub user can upload one avatar (Settings → Me tab).
-- `avatar_url` holds the PUBLIC storage URL from the `user-avatars` bucket
-- (see src/lib/integrations/user-avatar-storage.ts). Public + non-expiring so
-- it can be cached in the NextAuth session and rendered everywhere a person
-- shows up (sidebar, inbox update/task cards, comment replies, message
-- threads) without re-signing. Null = no photo yet → UI falls back to initials.

alter table users add column if not exists avatar_url text;
