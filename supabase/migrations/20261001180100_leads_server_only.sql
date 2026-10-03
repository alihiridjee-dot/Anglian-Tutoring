-- S-38, step 2 of 2 · Only the server writes leads.
--
-- APPLY ONLY ONCE THE APP CHANGE IS LIVE (contactLead and whatsappLead writing
-- through saveLead.server.ts with the service role). Before that, the contact
-- form and the demo sales chat still insert with the public key, and this
-- would break them.
--
-- anon and authenticated held INSERT on public.leads with the "leads public
-- insert" policy, so anyone with the public key could write leads straight to
-- the table and skip the server functions' honeypot and per-IP limit. Tutors
-- keep reading and updating leads through their own policies; nothing else
-- needs a grant. TRUNCATE goes too: row-level security doesn't govern it.
drop policy if exists "leads public insert" on public.leads;

revoke all on public.leads from anon;
revoke insert, delete, truncate on public.leads from authenticated;
