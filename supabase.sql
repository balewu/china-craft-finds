-- China Craft Finds database setup
-- Run the whole file in Supabase Dashboard > SQL Editor > New query.
-- Prices are stored as integer cents to avoid floating-point currency errors.

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  category text not null,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.skus (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku_code text not null,
  variant_name text not null,
  price_cents integer not null check (price_cents >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(product_id, sku_code)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  created_at timestamptz not null default now(),
  full_name text not null,
  email text not null,
  phone text not null,
  country text not null,
  region text not null default '',
  postal_code text not null,
  address text not null,
  notes text not null default '',
  total_cents integer not null check (total_cents >= 0),
  status text not null default 'pending_review'
    check (status in ('pending_review','awaiting_payment','paid','purchased','shipped','cancelled'))
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sku_id uuid references public.skus(id) on delete set null,
  product_name text not null,
  sku_code text not null,
  variant_name text not null,
  unit_price_cents integer not null,
  quantity integer not null check (quantity between 1 and 50),
  line_total_cents integer not null
);

alter table public.products enable row level security;
alter table public.skus enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_users enable row level security;

-- Admin identity helper. A signed-in user is an admin only if their UUID is
-- explicitly present in admin_users. Customers cannot add themselves here.
create or replace function public.is_store_admin()
returns boolean language sql stable security definer
set search_path = public
as $$
  select exists(select 1 from public.admin_users where user_id = auth.uid());
$$;

drop policy if exists "Public can read active products" on public.products;
create policy "Public can read active products" on public.products
for select to anon, authenticated using (active = true or public.is_store_admin());

drop policy if exists "Admins manage products" on public.products;
create policy "Admins manage products" on public.products
for all to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

drop policy if exists "Public can read active skus" on public.skus;
create policy "Public can read active skus" on public.skus
for select to anon, authenticated using (
  active = true and exists(select 1 from public.products p where p.id = product_id and p.active = true)
  or public.is_store_admin()
);

drop policy if exists "Admins manage skus" on public.skus;
create policy "Admins manage skus" on public.skus
for all to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

drop policy if exists "Admins read orders" on public.orders;
create policy "Admins read orders" on public.orders
for select to authenticated using (public.is_store_admin());

drop policy if exists "Admins update orders" on public.orders;
create policy "Admins update orders" on public.orders
for update to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

drop policy if exists "Admins read order items" on public.order_items;
create policy "Admins read order items" on public.order_items
for select to authenticated using (public.is_store_admin());

drop policy if exists "Admins manage admin list" on public.admin_users;
create policy "Admins manage admin list" on public.admin_users
for select to authenticated using (user_id = auth.uid());

-- Public order submission is available only through this function.
-- It ignores any price sent by the browser and fetches the current price from
-- the database, then stores immutable product/SKU/price snapshots.
create or replace function public.submit_order_request(p_customer jsonb, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_order_number text;
  v_total integer := 0;
  v_item jsonb;
  v_sku record;
  v_qty integer;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'Your bag must contain between 1 and 30 item lines.';
  end if;

  if coalesce(length(trim(p_customer->>'full_name')),0) not between 1 and 120
     or coalesce(length(trim(p_customer->>'email')),0) not between 3 and 254
     or coalesce(length(trim(p_customer->>'phone')),0) not between 3 and 40
     or coalesce(length(trim(p_customer->>'country')),0) not between 1 and 80
     or coalesce(length(trim(p_customer->>'postal_code')),0) not between 1 and 24
     or coalesce(length(trim(p_customer->>'address')),0) not between 1 and 500 then
    raise exception 'Please complete the required delivery details.';
  end if;

  v_order_number := 'CCF-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  insert into public.orders(order_number,full_name,email,phone,country,region,postal_code,address,notes,total_cents)
  values(v_order_number,trim(p_customer->>'full_name'),trim(p_customer->>'email'),
    trim(p_customer->>'phone'),trim(p_customer->>'country'),
    coalesce(trim(p_customer->>'region'),''),trim(p_customer->>'postal_code'),
    trim(p_customer->>'address'),left(coalesce(p_customer->>'notes',''),1000),0)
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 or v_qty > 50 then raise exception 'Invalid item quantity.'; end if;

    select s.id as sku_id, s.sku_code, s.variant_name, s.price_cents,
           p.name as product_name
    into v_sku
    from public.skus s join public.products p on p.id=s.product_id
    where s.id=(v_item->>'sku_id')::uuid and s.active=true and p.active=true;

    if not found then raise exception 'One of the selected items is no longer available.'; end if;

    insert into public.order_items(order_id,sku_id,product_name,sku_code,variant_name,unit_price_cents,quantity,line_total_cents)
    values(v_order_id,v_sku.sku_id,v_sku.product_name,v_sku.sku_code,v_sku.variant_name,
      v_sku.price_cents,v_qty,v_sku.price_cents*v_qty);
    v_total := v_total + v_sku.price_cents*v_qty;
  end loop;

  update public.orders set total_cents=v_total where id=v_order_id;
  return jsonb_build_object('order_number',v_order_number,'total_cents',v_total);
end;
$$;

revoke all on function public.submit_order_request(jsonb,jsonb) from public;
grant execute on function public.submit_order_request(jsonb,jsonb) to anon, authenticated;

-- Explicit table privileges (RLS policies above still decide which rows are visible).
grant select on public.products, public.skus to anon, authenticated;
grant insert, update, delete on public.products, public.skus to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.admin_users to authenticated;
revoke all on public.orders from anon;
revoke all on public.order_items from anon;
revoke insert, delete on public.orders from authenticated;
revoke insert, update, delete on public.order_items from authenticated;
revoke insert, update, delete on public.admin_users from anon, authenticated;

-- Public visitors may not directly read or write customer orders or addresses.
-- The browser only receives the order number returned by the submission function.
