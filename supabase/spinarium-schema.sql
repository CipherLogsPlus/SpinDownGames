-- Initial Spinarium migration: run ONCE in a NEW, dedicated Supabase project.
-- Keep InvoHub in its existing project. No InvoHub tables, functions or policies
-- may be changed by this migration. Never expose a service_role key to the site.
begin;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  ) then
    raise exception 'Install Spinarium only in a new dedicated project with an empty public schema.';
  end if;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.spinarium_profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default 'Collector' check (length(display_name) between 1 and 80),
  member_since timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.spinarium_veilings (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 20000),
  character_number integer unique check (character_number between 1 and 999999),
  rarity text check (rarity is null or length(btrim(rarity)) between 1 and 80),
  edition text check (edition is null or length(btrim(edition)) between 1 and 120),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  artwork_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint spinarium_artwork_path_bound_to_veiling check (
    artwork_path is null or (
      artwork_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpeg|webp)$'
      and split_part(artwork_path, '/', 1) = id::text
    )
  )
);

-- Only a future trusted backend can grant ownership. Even an authenticated
-- Spinarium administrator has no browser INSERT/UPDATE/DELETE permission here.
create table public.spinarium_ownerships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  veiling_id uuid not null references public.spinarium_veilings(id) on delete restrict,
  acquired_at timestamptz not null default now(),
  acquisition text not null check (acquisition in ('physical_claim', 'transfer', 'server_grant')),
  physical_card_id uuid,
  constraint spinarium_physical_acquisition_has_card check (
    (acquisition = 'server_grant' and physical_card_id is null)
    or (acquisition in ('physical_claim', 'transfer') and physical_card_id is not null)
  )
);
create index spinarium_ownership_user on public.spinarium_ownerships(user_id, veiling_id);
create unique index spinarium_unique_owned_physical_card on public.spinarium_ownerships(physical_card_id) where physical_card_id is not null;

-- Discovery is independent from ownership, and never awarded by the browser.
-- There are no seed discoveries, demo owners, or pretend physical cards.
create table public.spinarium_discoveries (
  veiling_id uuid primary key references public.spinarium_veilings(id) on delete restrict,
  first_discovered_at timestamptz not null,
  first_discoverer_user_id uuid references auth.users(id) on delete restrict,
  public_discoverer_name text check (public_discoverer_name is null or length(public_discoverer_name) <= 80),
  reveal_kind text not null check (reveal_kind in ('launch', 'collector'))
);

create table private.spinarium_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete restrict,
  note text not null default '' check (length(note) <= 500)
);

create table private.spinarium_audit (
  id bigint generated always as identity primary key,
  happened_at timestamptz not null default now(),
  actor_user_id uuid,
  entity_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE')),
  changed_fields text[] not null
);

alter table public.spinarium_profiles enable row level security;
alter table public.spinarium_veilings enable row level security;
alter table public.spinarium_ownerships enable row level security;
alter table public.spinarium_discoveries enable row level security;
alter table private.spinarium_admins enable row level security;
alter table private.spinarium_audit enable row level security;

revoke all on public.spinarium_profiles, public.spinarium_veilings,
  public.spinarium_ownerships, public.spinarium_discoveries from public, anon, authenticated;
revoke all on private.spinarium_admins, private.spinarium_audit from public, anon, authenticated;

create function public.is_spinarium_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(
    auth.uid() is not null and exists (
      select 1 from private.spinarium_admins a where a.user_id = auth.uid()
    ), false
  );
$$;
revoke all on function public.is_spinarium_admin() from public, anon, authenticated;
grant execute on function public.is_spinarium_admin() to authenticated;

create policy spinarium_profile_read_own on public.spinarium_profiles
for select to authenticated using (id = (select auth.uid()));
grant select on public.spinarium_profiles to authenticated;

create policy spinarium_ownership_read_own on public.spinarium_ownerships
for select to authenticated using (user_id = (select auth.uid()));
grant select on public.spinarium_ownerships to authenticated;

-- No public catalog enumeration: collectors only see definitions they own.
-- Administrators manage actual definitions, not mock collection instances.
create policy spinarium_definition_read on public.spinarium_veilings
for select to authenticated using (
  (select public.is_spinarium_admin()) or exists (
    select 1 from public.spinarium_ownerships o
    where o.veiling_id = spinarium_veilings.id and o.user_id = (select auth.uid())
  )
);
create policy spinarium_definition_insert_admin on public.spinarium_veilings
for insert to authenticated with check ((select public.is_spinarium_admin()));
create policy spinarium_definition_update_admin on public.spinarium_veilings
for update to authenticated
using ((select public.is_spinarium_admin()))
with check ((select public.is_spinarium_admin()));
grant select on public.spinarium_veilings to authenticated;
grant insert (name, description, character_number, rarity, edition, status, artwork_path)
  on public.spinarium_veilings to authenticated;
grant update (name, description, character_number, rarity, edition, status, artwork_path)
  on public.spinarium_veilings to authenticated;

create function private.spinarium_touch_veiling()
returns trigger language plpgsql set search_path = ''
as $$
begin
  new.updated_at := transaction_timestamp();
  return new;
end;
$$;
create trigger spinarium_touch_veiling before update on public.spinarium_veilings
for each row execute function private.spinarium_touch_veiling();

create function private.spinarium_record_definition_audit()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  changed text[];
begin
  if tg_op = 'INSERT' then
    changed := array['name', 'description', 'character_number', 'rarity', 'edition', 'status', 'artwork_path'];
  else
    select coalesce(array_agg(k.key order by k.key), array[]::text[]) into changed
    from jsonb_each(to_jsonb(new)) k
    where k.key not in ('created_at', 'updated_at')
      and k.value is distinct from to_jsonb(old) -> k.key;
  end if;
  insert into private.spinarium_audit (actor_user_id, entity_id, action, changed_fields)
    values (auth.uid(), new.id, tg_op, changed);
  return new;
end;
$$;
create trigger spinarium_audit_definition after insert or update on public.spinarium_veilings
for each row execute function private.spinarium_record_definition_audit();

create function private.spinarium_audit_immutable()
returns trigger language plpgsql set search_path = ''
as $$
begin
  raise exception using errcode = '42501', message = 'Spinarium audit records are immutable.';
end;
$$;
create trigger spinarium_audit_immutable before update or delete on private.spinarium_audit
for each row execute function private.spinarium_audit_immutable();

create function private.spinarium_bootstrap_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  chosen_name text;
begin
  -- Display metadata is untrusted editorial text, never an authorization role.
  chosen_name := nullif(btrim(left(new.raw_user_meta_data ->> 'display_name', 80)), '');
  insert into public.spinarium_profiles (id, display_name, member_since)
  values (new.id, coalesce(chosen_name, 'Collector'), new.created_at);
  return new;
end;
$$;
create trigger spinarium_new_member after insert on auth.users
for each row execute function private.spinarium_bootstrap_profile();

-- Only necessary if Auth already has a test user in this otherwise new project.
insert into public.spinarium_profiles (id, display_name, member_since)
select u.id, coalesce(nullif(btrim(left(u.raw_user_meta_data ->> 'display_name', 80)), ''), 'Collector'), u.created_at
from auth.users u;

create function public.spinarium_dashboard()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  requesting_user_id uuid := auth.uid();
  member public.spinarium_profiles%rowtype;
  result jsonb;
begin
  if requesting_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required.';
  end if;
  select * into member from public.spinarium_profiles where id = requesting_user_id;
  if not found then
    raise exception using errcode = '42501', message = 'The member profile is unavailable.';
  end if;

  with owned as (
    select o.* from public.spinarium_ownerships o where o.user_id = requesting_user_id
  ), catalog as (
    select v.* from public.spinarium_veilings v
    where exists (select 1 from owned o where o.veiling_id = v.id)
  ), rarity_labels as (
    select distinct rarity from catalog where rarity is not null
  ), rarity_projection as (
    select rarity, dense_rank() over (order by rarity desc) as display_rank from rarity_labels
  )
  select jsonb_build_object(
    'schemaVersion', '1', 'mode', 'live',
    'profile', jsonb_build_object('id', member.id, 'displayName', member.display_name, 'memberSince', member.member_since, 'avatarSrc', null),
    'veilings', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'number', v.character_number, 'name', v.name, 'type', null, 'origin', null,
      'editionIds', jsonb_build_array(v.id::text || '-edition'), 'releaseDate', null,
      'contentStatus', case when v.status = 'draft' then 'draft' else 'published' end,
      'artwork', case when v.artwork_path is null then '[]'::jsonb else jsonb_build_array(
        jsonb_build_object('id', v.id::text || '-color', 'role', 'color_art', 'storagePath', v.artwork_path, 'alt', v.name || ' artwork', 'variantId', null, 'status', 'approved'),
        jsonb_build_object('id', v.id::text || '-thumbnail', 'role', 'thumbnail', 'storagePath', v.artwork_path, 'alt', v.name || ' artwork', 'variantId', null, 'status', 'approved')
      ) end,
      'lore', case when v.description = '' then '[]'::jsonb else jsonb_build_array(jsonb_build_object(
        'id', v.id::text || '-description-en', 'locale', 'en', 'title', 'Lore', 'preview', left(v.description, 180),
        'text', v.description, 'status', case when v.status = 'draft' then 'draft' else 'published' end, 'version', 1
      )) end
    ) order by v.character_number nulls last, v.created_at) from catalog v), '[]'::jsonb),
    'series', '[]'::jsonb,
    'editions', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id::text || '-edition', 'veilingId', v.id, 'seriesId', null, 'name', coalesce(v.edition, 'Unspecified'),
      'kind', 'registered', 'status', case when v.status = 'draft' then 'planned' else v.status end,
      'registrationSupported', false, 'productionLimit', null, 'finalProduced', null, 'retiredAt', null
    )) from catalog v), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id::text || '-standard', 'editionId', v.id::text || '-edition', 'name', 'Standard',
      'rarityId', case when v.rarity is not null then v.rarity else null end
    )) from catalog v), '[]'::jsonb),
    'rarities', coalesce((select jsonb_agg(jsonb_build_object(
      'id', r.rarity, 'label', r.rarity, 'sortOrder', r.display_rank, 'accent', 'silver'
    )) from rarity_projection r), '[]'::jsonb),
    'physicalCards', '[]'::jsonb,
    'ownerships', coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'userId', o.user_id, 'veilingId', o.veiling_id, 'acquisition', o.acquisition,
      'physicalCardId', o.physical_card_id, 'editionId', o.veiling_id::text || '-edition',
      'variantId', o.veiling_id::text || '-standard', 'acquiredAt', o.acquired_at
    )) from owned o), '[]'::jsonb),
    'discoveries', coalesce((select jsonb_agg(jsonb_build_object(
      'veilingId', d.veiling_id, 'status', 'revealed', 'firstDiscoveredAt', d.first_discovered_at,
      'firstDiscovererId', case when d.first_discoverer_user_id = requesting_user_id then requesting_user_id else null end,
      'publicDiscovererName', d.public_discoverer_name, 'revealKind', d.reveal_kind
    )) from public.spinarium_discoveries d where exists (select 1 from owned o where o.veiling_id = d.veiling_id)), '[]'::jsonb),
    'achievements', '[]'::jsonb, 'userAchievements', '[]'::jsonb, 'collections', '[]'::jsonb,
    'news', '[]'::jsonb, 'events', '[]'::jsonb
  ) into result;
  return result;
end;
$$;
revoke all on function public.spinarium_dashboard() from public, anon, authenticated;
grant execute on function public.spinarium_dashboard() to authenticated;

-- The bucket is PRIVATE. Public getPublicUrl links are never used by Spinarium.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spinarium-artwork', 'spinarium-artwork', false, 8388608, array['image/png', 'image/jpeg', 'image/webp']);

create policy spinarium_artwork_read on storage.objects
for select to authenticated using (
  bucket_id = 'spinarium-artwork' and (
    (select public.is_spinarium_admin()) or exists (
      select 1 from public.spinarium_ownerships o
      join public.spinarium_veilings v on v.id = o.veiling_id
      where o.user_id = (select auth.uid()) and v.artwork_path = storage.objects.name
    )
  )
);
create policy spinarium_artwork_insert_admin on storage.objects
for insert to authenticated with check (
  bucket_id = 'spinarium-artwork' and (select public.is_spinarium_admin())
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpeg|webp)$'
  and exists (select 1 from public.spinarium_veilings v where v.id::text = split_part(storage.objects.name, '/', 1))
);
-- There are deliberately no artwork UPDATE/DELETE policies: replacing artwork
-- uploads a new immutable object; prior source files remain intact.

revoke all on all functions in schema private from public, anon, authenticated;

-- Trusted future services use protected server credentials, never the browser.
grant select, insert, update on public.spinarium_profiles, public.spinarium_veilings,
  public.spinarium_ownerships, public.spinarium_discoveries to service_role;
grant execute on function public.is_spinarium_admin(), public.spinarium_dashboard() to service_role;

commit;
