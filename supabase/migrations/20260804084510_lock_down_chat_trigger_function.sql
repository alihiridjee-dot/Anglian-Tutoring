-- A trigger function has no business being an API endpoint.
--
-- PostgREST exposes everything in `public` with EXECUTE granted to anon /
-- authenticated, so public.on_chat_message_insert() was callable at
-- /rest/v1/rpc/on_chat_message_insert. It would error out without a trigger
-- context rather than doing damage, but it is SECURITY DEFINER and writes
-- notifications — that is not a door to leave ajar on the strength of "the
-- call happens to fail".
revoke all on function public.on_chat_message_insert() from public, anon, authenticated;
