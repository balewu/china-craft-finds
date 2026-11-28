-- China Craft Finds
-- 在 Supabase → SQL Editor → New query 里整段粘贴并运行。
-- 可以重复运行：不会删除已有商品、SKU 和订单。
-- 「已采购 / purchased」会自动改成「已到货 / arrived」。
-- 价格仍用整数「分」存储，避免小数误差。
-- 不要把 service_role 密钥放进网站，网站只用 anon / publishable key。

create extension if not exists pgcrypto;

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net 没有启用（%）。订单仍可保存。要收邮件，请到 Database → Extensions 打开 pg_net 后再运行本脚本。', sqlerrm;
end $$;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  parent_category text not null default 'General',
  category text not null,
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.skus (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label_no text not null,
  sku_code text not null,
  variant_name text not null,
  price_cents integer not null check (price_cents >= 0),
  image_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (product_id, sku_code)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  order_number text not null unique,
  created_at timestamptz not null default now(),
  full_name text not null,
  email text not null,
  phone text not null,
  country text not null,
  region text not null default '',
  city text not null default '',
  postal_code text not null,
  address text not null,
  notes text not null default '',
  total_cents integer not null check (total_cents >= 0),
  shipping_cents integer,
  status text not null default 'pending_review'
    check (status in ('pending_review','awaiting_payment','paid','arrived','shipped','cancelled')),
  tracking_number text,
  address_confirmed boolean not null default false,
  address_confirmed_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sku_id uuid references public.skus(id) on delete set null,
  product_name text not null,
  sku_code text not null,
  label_no text not null default '',
  variant_name text not null,
  image_url text,
  unit_price_cents integer not null,
  quantity integer not null check (quantity between 1 and 50),
  line_total_cents integer not null
);

create table if not exists public.shop_settings (
  id integer primary key check (id = 1),
  notify_email text not null default '',
  webhook_url text not null default ''
);

insert into public.shop_settings (id) values (1) on conflict (id) do nothing;

-- 旧库升级：补列，不删数据
alter table public.products add column if not exists parent_category text;
update public.products set parent_category = 'General' where parent_category is null or btrim(parent_category) = '';
alter table public.products alter column parent_category set default 'General';
alter table public.products alter column parent_category set not null;

alter table public.skus add column if not exists label_no text;
alter table public.skus add column if not exists image_url text;
update public.skus set label_no = sku_code where label_no is null or btrim(label_no) = '';
alter table public.skus alter column label_no set not null;

alter table public.orders add column if not exists user_id uuid references auth.users(id);
alter table public.orders add column if not exists city text;
update public.orders set city = '' where city is null;
alter table public.orders alter column city set default '';
alter table public.orders alter column city set not null;
alter table public.orders add column if not exists shipping_cents integer;
alter table public.orders add column if not exists tracking_number text;
alter table public.orders add column if not exists address_confirmed boolean;
update public.orders set address_confirmed = false where address_confirmed is null;
alter table public.orders alter column address_confirmed set default false;
alter table public.orders alter column address_confirmed set not null;
alter table public.orders add column if not exists address_confirmed_at timestamptz;

alter table public.order_items add column if not exists label_no text;
update public.order_items set label_no = sku_code where label_no is null or btrim(label_no) = '';
alter table public.order_items alter column label_no set default '';
alter table public.order_items alter column label_no set not null;
alter table public.order_items add column if not exists image_url text;

do $$
declare r record;
begin
  for r in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'orders' and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.orders drop constraint %I', r.conname);
  end loop;
end $$;

update public.orders set status = 'arrived' where status = 'purchased';

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending_review','awaiting_payment','paid','arrived','shipped','cancelled'));

alter table public.orders drop constraint if exists orders_shipping_cents_check;
alter table public.orders add constraint orders_shipping_cents_check
  check (shipping_cents is null or shipping_cents >= 0);

do $$ begin
  create unique index if not exists skus_product_label_unique on public.skus (product_id, label_no);
exception when unique_violation then
  raise exception '同一个商品下有两个相同的编号。请先把编号改成互不相同，再重新运行本脚本。';
end $$;

create index if not exists orders_user_id_idx on public.orders (user_id);
create index if not exists order_items_order_id_idx on public.order_items (order_id);

alter table public.products enable row level security;
alter table public.skus enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.admin_users enable row level security;
alter table public.shop_settings enable row level security;

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

drop policy if exists "Customers read own orders" on public.orders;
create policy "Customers read own orders" on public.orders
for select to authenticated using (user_id = auth.uid());

drop policy if exists "Admins update orders" on public.orders;
create policy "Admins update orders" on public.orders
for update to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

drop policy if exists "Admins read order items" on public.order_items;
create policy "Admins read order items" on public.order_items
for select to authenticated using (public.is_store_admin());

drop policy if exists "Customers read own order items" on public.order_items;
create policy "Customers read own order items" on public.order_items
for select to authenticated using (
  exists(select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())
);

drop policy if exists "Admins manage admin list" on public.admin_users;
create policy "Admins manage admin list" on public.admin_users
for select to authenticated using (user_id = auth.uid());

drop policy if exists "Admins read settings" on public.shop_settings;
create policy "Admins read settings" on public.shop_settings
for select to authenticated using (public.is_store_admin());

drop policy if exists "Admins update settings" on public.shop_settings;
create policy "Admins update settings" on public.shop_settings
for update to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

create or replace function public.orders_guard_shipped()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.status = 'shipped' and coalesce(length(btrim(new.tracking_number)), 0) < 3 then
    raise exception 'Add the tracking number before marking this order as shipped.';
  end if;
  if new.shipping_cents is not null and new.shipping_cents < 0 then
    raise exception 'Postage cannot be negative.';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_guard_shipped on public.orders;
create trigger orders_guard_shipped
before insert or update on public.orders
for each row execute function public.orders_guard_shipped();

create or replace function public.queue_shop_alert(p_message text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_hook text;
  v_body jsonb;
begin
  select notify_email, webhook_url into v_email, v_hook from public.shop_settings where id = 1;
  v_email := coalesce(btrim(v_email), '');
  v_hook := coalesce(btrim(v_hook), '');

  if v_hook ~ '^https://[^[:space:]]{1,400}$' then
    begin
      v_body := jsonb_build_object('title', 'China Craft Finds', 'message', left(p_message, 1800));
      if v_hook ~* 'ntfy\.sh' and v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        v_body := v_body || jsonb_build_object('email', v_email);
      end if;
      perform net.http_post(
        url := v_hook,
        body := v_body,
        headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb
      );
    exception when others then
      null;
    end;
  elsif v_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    begin
      perform net.http_post(
        url := 'https://formsubmit.co/ajax/' || v_email,
        body := jsonb_build_object(
          'name', 'China Craft Finds',
          'subject', left(split_part(p_message, E'\n', 1), 140),
          'message', left(p_message, 4000),
          '_captcha', 'false'
        ),
        headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb
      );
    exception when others then
      null;
    end;
  end if;
end;
$$;

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
  v_lines text := '';
  v_summary text;
  v_fee integer := 0;
  v_kinds integer := 0;
  v_pieces integer := 0;
  v_stores integer := 0;
  v_checks integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Please sign in before sending a request.';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'Your bag must contain between 1 and 30 item lines.';
  end if;

  if coalesce(length(btrim(p_customer->>'full_name')), 0) not between 1 and 120
     or coalesce(length(btrim(p_customer->>'email')), 0) not between 3 and 254
     or coalesce(length(btrim(p_customer->>'phone')), 0) not between 3 and 40
     or coalesce(length(btrim(p_customer->>'country')), 0) not between 1 and 80
     or coalesce(length(btrim(p_customer->>'city')), 0) not between 1 and 80
     or coalesce(length(btrim(p_customer->>'postal_code')), 0) not between 1 and 24
     or coalesce(length(btrim(p_customer->>'address')), 0) not between 1 and 500 then
    raise exception 'Please complete the required delivery details, including the city.';
  end if;

  v_order_number := 'CCF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.orders (
    user_id, order_number, full_name, email, phone, country, region, city, postal_code, address, notes, total_cents
  ) values (
    auth.uid(), v_order_number,
    btrim(p_customer->>'full_name'), btrim(p_customer->>'email'), btrim(p_customer->>'phone'),
    btrim(p_customer->>'country'), coalesce(btrim(p_customer->>'region'), ''),
    btrim(p_customer->>'city'), btrim(p_customer->>'postal_code'),
    btrim(p_customer->>'address'), left(coalesce(p_customer->>'notes', ''), 1000), 0
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_qty := (v_item->>'quantity')::integer;
    if v_qty < 1 or v_qty > 50 then
      raise exception 'Invalid item quantity.';
    end if;

    select s.id as sku_id, s.sku_code, coalesce(nullif(btrim(s.label_no), ''), s.sku_code) as label_no,
           s.variant_name, s.price_cents, coalesce(s.image_url, p.image_url) as image_url,
           p.name as product_name
    into v_sku
    from public.skus s
    join public.products p on p.id = s.product_id
    where s.id = (v_item->>'sku_id')::uuid and s.active = true and p.active = true;

    if not found then
      raise exception 'One of the selected items is no longer available.';
    end if;

    insert into public.order_items (
      order_id, sku_id, product_name, sku_code, label_no, variant_name, image_url,
      unit_price_cents, quantity, line_total_cents
    ) values (
      v_order_id, v_sku.sku_id, v_sku.product_name, v_sku.sku_code, v_sku.label_no, v_sku.variant_name, v_sku.image_url,
      v_sku.price_cents, v_qty, v_sku.price_cents * v_qty
    );
    v_total := v_total + v_sku.price_cents * v_qty;
    v_lines := v_lines || v_sku.product_name || ' #' || v_sku.label_no || ' × ' || v_qty || E'\n';
  end loop;

  select count(*)::int,
         coalesce(sum(oi.quantity), 0)::int,
         count(distinct coalesce(nullif(lower(btrim(ps.source_shop)), ''), 'product:' || p.id::text))::int,
         count(*) filter (where coalesce(ps.needs_verify, false))::int
    into v_kinds, v_pieces, v_stores, v_checks
  from public.order_items oi
  join public.skus s on s.id = oi.sku_id
  join public.products p on p.id = s.product_id
  left join public.product_sourcing ps on ps.product_id = p.id
  where oi.order_id = v_order_id;

  v_fee := public.service_fee_cents(v_kinds, v_pieces, v_stores, v_checks);
  update public.orders set total_cents = v_total, service_fee_cents = v_fee where id = v_order_id;

  v_summary := '新订单 ' || v_order_number || E'\n'
    || btrim(p_customer->>'full_name') || ' <' || btrim(p_customer->>'email') || '>' || E'\n'
    || v_lines
    || '商品小计 $' || to_char(v_total / 100.0, 'FM999990.00') || E'\n'
    || '服务费 $' || to_char(v_fee / 100.0, 'FM999990.00') || E'\n'
    || '货款合计 $' || to_char((v_total + v_fee) / 100.0, 'FM999990.00');
  begin
    perform public.queue_shop_alert(v_summary);
  exception when others then
    null;
  end;

  return jsonb_build_object('order_number', v_order_number, 'total_cents', v_total, 'service_fee_cents', v_fee);
end;
$$;

create or replace function public.cancel_my_order(p_order_number text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;
  update public.orders
  set status = 'cancelled'
  where order_number = p_order_number
    and user_id = auth.uid()
    and status = 'pending_review'
  returning id into v_id;
  if v_id is null then
    raise exception 'Only a request that is still pending review can be cancelled.';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.confirm_order_address(p_order_number text, p_address jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;
  if coalesce(length(btrim(p_address->>'full_name')), 0) not between 1 and 120
     or coalesce(length(btrim(p_address->>'email')), 0) not between 3 and 254
     or coalesce(length(btrim(p_address->>'phone')), 0) not between 3 and 40
     or coalesce(length(btrim(p_address->>'country')), 0) not between 1 and 80
     or coalesce(length(btrim(p_address->>'city')), 0) not between 1 and 80
     or coalesce(length(btrim(p_address->>'postal_code')), 0) not between 1 and 24
     or coalesce(length(btrim(p_address->>'address')), 0) not between 1 and 500 then
    raise exception 'Please complete the address, including the city.';
  end if;

  update public.orders set
    full_name = btrim(p_address->>'full_name'),
    email = btrim(p_address->>'email'),
    phone = btrim(p_address->>'phone'),
    country = btrim(p_address->>'country'),
    region = coalesce(btrim(p_address->>'region'), ''),
    city = btrim(p_address->>'city'),
    postal_code = btrim(p_address->>'postal_code'),
    address = btrim(p_address->>'address'),
    address_confirmed = true,
    address_confirmed_at = now()
  where order_number = p_order_number
    and user_id = auth.uid()
    and status = 'arrived'
    and address_confirmed = false
  returning id into v_id;

  if v_id is null then
    raise exception 'This address cannot be confirmed. It may already be confirmed, or the order is not waiting on you.';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.send_test_alert()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_hook text;
begin
  if auth.uid() is null or not public.is_store_admin() then
    raise exception 'Only the shopkeeper can send a test.';
  end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise exception '请先在 Supabase → Database → Extensions 里启用 pg_net，否则发不出邮件。';
  end if;
  select notify_email, webhook_url into v_email, v_hook from public.shop_settings where id = 1;
  if coalesce(btrim(v_email), '') = '' and coalesce(btrim(v_hook), '') = '' then
    raise exception '先填写邮箱或 Webhook，保存后再测试。';
  end if;
  perform public.queue_shop_alert(E'测试提醒：有人下单时，你会收到这样一封通知。\nTest alert from China Craft Finds. If you can read this, new-order alerts are connected.');
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.queue_shop_alert(text) from public, anon, authenticated;
revoke all on function public.submit_order_request(jsonb, jsonb) from public, anon;
grant execute on function public.submit_order_request(jsonb, jsonb) to authenticated;
revoke all on function public.cancel_my_order(text) from public, anon;
grant execute on function public.cancel_my_order(text) to authenticated;
revoke all on function public.confirm_order_address(text, jsonb) from public, anon;
grant execute on function public.confirm_order_address(text, jsonb) to authenticated;
revoke all on function public.send_test_alert() from public, anon;
grant execute on function public.send_test_alert() to authenticated;

grant select on public.products, public.skus to anon, authenticated;
grant insert, update, delete on public.products, public.skus to authenticated;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select on public.admin_users to authenticated;
grant select, update on public.shop_settings to authenticated;
revoke all on public.orders from anon;
revoke all on public.order_items from anon;
revoke all on public.shop_settings from anon;
revoke insert, delete on public.orders from authenticated;
revoke insert, update, delete on public.order_items from authenticated;
revoke insert, update, delete on public.admin_users from anon, authenticated;
revoke insert, delete on public.shop_settings from authenticated;

-- 评价：只有已发货订单可以写。默认不公开，管理员点 Share 后才出现在反馈页和商品详情里。
-- 顾客看不到别人的账号。公开内容走 list_public_reviews，不返回用户 id。

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_item_id uuid references public.order_items(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null default '',
  label_no text not null default '',
  variant_name text not null default '',
  image_url text,
  body text not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  constraint reviews_body_len check (char_length(btrim(body)) between 2 and 1000)
);

create unique index if not exists reviews_order_once
  on public.reviews (order_id) where order_item_id is null;
create unique index if not exists reviews_item_once
  on public.reviews (order_item_id) where order_item_id is not null;
create index if not exists reviews_public_idx on public.reviews (is_public, created_at desc);

alter table public.reviews enable row level security;

drop policy if exists "Customers read own reviews" on public.reviews;
create policy "Customers read own reviews" on public.reviews
for select to authenticated using (user_id = auth.uid() or public.is_store_admin());

drop policy if exists "Admins update reviews" on public.reviews;
create policy "Admins update reviews" on public.reviews
for update to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

drop policy if exists "Admins delete reviews" on public.reviews;
create policy "Admins delete reviews" on public.reviews
for delete to authenticated using (public.is_store_admin());

drop policy if exists "Admins delete orders" on public.orders;
create policy "Admins delete orders" on public.orders
for delete to authenticated using (public.is_store_admin());

drop policy if exists "Admins delete order items" on public.order_items;
create policy "Admins delete order items" on public.order_items
for delete to authenticated using (public.is_store_admin());

create or replace function public.submit_review(p_order_number text, p_item_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_item public.order_items%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_id uuid;
  v_product uuid;
  v_image text;
begin
  if auth.uid() is null then
    raise exception 'Please sign in.';
  end if;
  if char_length(v_body) < 2 or char_length(v_body) > 1000 then
    raise exception 'Please write a short note, between 2 and 1000 characters.';
  end if;

  select * into v_order from public.orders
  where order_number = p_order_number and user_id = auth.uid();
  if not found then
    raise exception 'This order is not available.';
  end if;
  if v_order.status <> 'shipped' then
    raise exception 'You can leave a note after the parcel has been posted.';
  end if;

  if p_item_id is null then
    insert into public.reviews (user_id, order_id, body)
    values (auth.uid(), v_order.id, v_body)
    on conflict (order_id) where order_item_id is null
    do update set body = excluded.body, is_public = false, created_at = now()
    returning id into v_id;
  else
    select * into v_item from public.order_items
    where id = p_item_id and order_id = v_order.id;
    if not found then
      raise exception 'That piece is not in this order.';
    end if;
    select s.product_id, coalesce(v_item.image_url, s.image_url, p.image_url)
      into v_product, v_image
    from public.skus s
    left join public.products p on p.id = s.product_id
    where s.id = v_item.sku_id;

    insert into public.reviews (
      user_id, order_id, order_item_id, product_id, product_name, label_no, variant_name, image_url, body
    ) values (
      auth.uid(), v_order.id, v_item.id, v_product, v_item.product_name,
      coalesce(nullif(btrim(v_item.label_no), ''), v_item.sku_code),
      v_item.variant_name, v_image, v_body
    )
    on conflict (order_item_id) where order_item_id is not null
    do update set
      body = excluded.body,
      is_public = false,
      created_at = now(),
      product_id = excluded.product_id,
      product_name = excluded.product_name,
      label_no = excluded.label_no,
      variant_name = excluded.variant_name,
      image_url = excluded.image_url
    returning id into v_id;
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;

create or replace function public.list_public_reviews()
returns table (
  id uuid,
  body text,
  created_at timestamptz,
  product_name text,
  label_no text,
  variant_name text,
  image_url text,
  product_id uuid,
  is_product boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.body, r.created_at, r.product_name, r.label_no, r.variant_name, r.image_url, r.product_id,
         (r.order_item_id is not null) as is_product
  from public.reviews r
  where r.is_public
  order by r.created_at desc
  limit 300;
$$;

revoke all on function public.submit_review(text, uuid, text) from public, anon;
grant execute on function public.submit_review(text, uuid, text) to authenticated;
revoke all on function public.list_public_reviews() from public;
grant execute on function public.list_public_reviews() to anon, authenticated;

revoke all on public.reviews from anon;
grant select, update, delete on public.reviews to authenticated;
revoke insert on public.reviews from anon, authenticated;
grant delete on public.orders to authenticated;
grant delete on public.order_items to authenticated;

-- 来源店铺、是否详细核验：单独一张表，顾客的查询读不到。
-- 服务费在数据库里计算，不信任浏览器传来的数字。
-- 服务费 = ceil_to_0.50( max(20, 12*店铺数 + 2.5*max(0, 种类数-店铺数) + 0.5*min(20, 件数-种类数) + 8*需核验种类数) / 6.5 )
-- 每个 SKU 是一个种类。店铺名忽略大小写；没填店铺的商品各自算一家，避免少算。

create table if not exists public.product_sourcing (
  product_id uuid primary key references public.products(id) on delete cascade,
  source_shop text not null default '',
  needs_verify boolean not null default false
);

alter table public.product_sourcing enable row level security;

drop policy if exists "Admins manage sourcing" on public.product_sourcing;
create policy "Admins manage sourcing" on public.product_sourcing
for all to authenticated using (public.is_store_admin()) with check (public.is_store_admin());

revoke all on public.product_sourcing from anon, authenticated;
grant select, insert, update, delete on public.product_sourcing to authenticated;

alter table public.orders add column if not exists service_fee_cents integer;
update public.orders set service_fee_cents = 0 where service_fee_cents is null;
alter table public.orders alter column service_fee_cents set default 0;
alter table public.orders alter column service_fee_cents set not null;
alter table public.orders drop constraint if exists orders_service_fee_cents_check;
alter table public.orders add constraint orders_service_fee_cents_check check (service_fee_cents >= 0);

create or replace function public.service_fee_cents(p_kinds integer, p_pieces integer, p_stores integer, p_checks integer)
returns integer
language sql
immutable
as $$
  select case
    when coalesce(p_kinds, 0) <= 0 then 0
    else (
      (
        greatest(40,
          24 * greatest(p_stores, 0)
          + 5 * greatest(0, p_kinds - greatest(p_stores, 0))
          + least(20, greatest(0, coalesce(p_pieces, 0) - p_kinds))
          + 16 * greatest(p_checks, 0)
        ) * 2 + 12
      ) / 13
    ) * 50
  end;
$$;

create or replace function public.quote_service_fee(p_items jsonb)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kinds integer := 0;
  v_pieces integer := 0;
  v_stores integer := 0;
  v_checks integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    return 0;
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'Your bag must contain between 1 and 30 item lines.';
  end if;

  with lines as (
    select (value->>'sku_id')::uuid as sku_id,
           sum(least(50, greatest(1, (value->>'quantity')::int)))::int as qty
    from jsonb_array_elements(p_items)
    group by 1
  ),
  joined as (
    select l.qty,
           coalesce(nullif(lower(btrim(ps.source_shop)), ''), 'product:' || p.id::text) as shop_key,
           coalesce(ps.needs_verify, false) as needs_verify
    from lines l
    join public.skus s on s.id = l.sku_id and s.active = true
    join public.products p on p.id = s.product_id and p.active = true
    left join public.product_sourcing ps on ps.product_id = p.id
  )
  select count(*)::int,
         coalesce(sum(qty), 0)::int,
         count(distinct shop_key)::int,
         count(*) filter (where needs_verify)::int
    into v_kinds, v_pieces, v_stores, v_checks
  from joined;

  return public.service_fee_cents(v_kinds, v_pieces, v_stores, v_checks);
end;
$$;

revoke all on function public.service_fee_cents(integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.quote_service_fee(jsonb) from public;
grant execute on function public.quote_service_fee(jsonb) to anon, authenticated;
