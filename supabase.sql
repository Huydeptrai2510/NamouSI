-- =====================================================================
-- NamouSI – Giai đoạn 1: Database nền tảng
-- Cách chạy: Supabase Dashboard → SQL Editor → dán toàn bộ file → Run.
-- File chạy lại nhiều lần được (idempotent).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. HÀM DÙNG CHUNG
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. BẢNG
-- status: draft (nháp) | published (đã xuất bản) | archived (lưu trữ)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null check (role in ('admin', 'editor')),
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text,
  icon        text,
  sort_order  int not null default 0,
  status      text not null default 'draft' check (status in ('draft','published','archived')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.tags (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_tools (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid references public.categories(id) on delete set null,
  slug          text not null unique,
  name          text not null,
  tagline       text,
  description   text,
  website_url   text,
  logo_url      text,
  pricing_model text check (pricing_model in ('free','freemium','paid','open_source')),
  is_featured   boolean not null default false,
  view_count    bigint not null default 0,
  status        text not null default 'draft' check (status in ('draft','published','archived')),
  published_at  timestamptz,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.ai_models (
  id             uuid primary key default gen_random_uuid(),
  ai_tool_id     uuid not null references public.ai_tools(id) on delete cascade,
  name           text not null,
  version        text not null default '',
  description    text,
  context_window int,
  release_date   date,
  status         text not null default 'draft' check (status in ('draft','published','archived')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ai_tool_id, name, version)
);

create table if not exists public.prompts (
  id           uuid primary key default gen_random_uuid(),
  ai_tool_id   uuid references public.ai_tools(id) on delete set null,
  category_id  uuid references public.categories(id) on delete set null,
  slug         text not null unique,
  title        text not null,
  description  text,
  content      text not null,
  is_featured  boolean not null default false,
  copy_count   bigint not null default 0,
  status       text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.news_articles (
  id           uuid primary key default gen_random_uuid(),
  ai_tool_id   uuid references public.ai_tools(id) on delete set null,
  slug         text not null unique,
  title        text not null,
  summary      text,
  content      text,
  cover_url    text,
  source_url   text,
  is_featured  boolean not null default false,
  status       text not null default 'draft' check (status in ('draft','published','archived')),
  published_at timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Index cho khóa ngoại và truy vấn công khai
create index if not exists user_roles_user_idx   on public.user_roles (user_id);
create index if not exists ai_tools_category_idx on public.ai_tools (category_id);
create index if not exists ai_tools_status_idx   on public.ai_tools (status, is_featured, published_at desc);
create index if not exists ai_models_tool_idx    on public.ai_models (ai_tool_id);
create index if not exists prompts_status_idx    on public.prompts (status, is_featured, published_at desc);
create index if not exists prompts_tool_idx      on public.prompts (ai_tool_id);
create index if not exists news_status_idx       on public.news_articles (status, published_at desc);
create index if not exists categories_status_idx on public.categories (status, sort_order);

-- ---------------------------------------------------------------------
-- 3. TRIGGER updated_at
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','categories','tags','ai_tools','ai_models','prompts','news_articles'] loop
    execute format('drop trigger if exists trg_%1$s_updated on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated before update on public.%1$I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. HỒ SƠ NGƯỜI DÙNG – tự tạo profile khi có tài khoản mới
-- Tài khoản mới KHÔNG có quyền nào trong user_roles.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name)
select id, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 5. KIỂM TRA QUYỀN ADMIN (security definer để tránh đệ quy RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles
    where user_id = auth.uid() and role = 'admin'
  );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. QUYỀN BẢNG (GRANT) – RLS bên dưới siết thêm theo từng dòng
-- ---------------------------------------------------------------------
revoke all on public.profiles, public.user_roles, public.categories, public.tags,
              public.ai_tools, public.ai_models, public.prompts, public.news_articles
  from anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Khách: chỉ đọc
grant select on public.categories, public.tags, public.ai_tools, public.ai_models,
                public.prompts, public.news_articles to anon;

-- Người đăng nhập: RLS quyết định ai được ghi
grant select, insert, update, delete on public.categories, public.tags, public.ai_tools,
      public.ai_models, public.prompts, public.news_articles to authenticated;

-- user_roles: CHỈ ĐỌC từ frontend. Không ai tự sửa role qua API.
grant select on public.user_roles to authenticated;

-- profiles: đọc, và chỉ được sửa 2 cột thông tin hiển thị
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 7. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.user_roles    enable row level security;
alter table public.categories    enable row level security;
alter table public.tags          enable row level security;
alter table public.ai_tools      enable row level security;
alter table public.ai_models     enable row level security;
alter table public.prompts       enable row level security;
alter table public.news_articles enable row level security;

-- profiles: xem/sửa hồ sơ của chính mình; admin xem tất cả
drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- user_roles: chỉ đọc role của mình (admin đọc tất cả). KHÔNG có policy ghi.
-- Cấp quyền admin bằng SQL Editor (xem mục 8).
drop policy if exists "user_roles_select_own_or_admin" on public.user_roles;
create policy "user_roles_select_own_or_admin" on public.user_roles
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- tags: ai cũng đọc; admin quản lý
drop policy if exists "tags_public_read" on public.tags;
create policy "tags_public_read" on public.tags
  for select to anon, authenticated using (true);

drop policy if exists "tags_admin_all" on public.tags;
create policy "tags_admin_all" on public.tags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Các bảng có status: khách chỉ đọc 'published'; admin quản lý toàn bộ
do $$
declare t text;
begin
  foreach t in array array['categories','ai_tools','ai_models','prompts','news_articles'] loop
    execute format('drop policy if exists "%1$s_public_read" on public.%1$I', t);
    execute format('create policy "%1$s_public_read" on public.%1$I for select to anon, authenticated using (status = ''published'')', t);
    execute format('drop policy if exists "%1$s_admin_all" on public.%1$I', t);
    execute format('create policy "%1$s_admin_all" on public.%1$I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 8. CẤP QUYỀN ADMIN ĐẦU TIÊN (chạy THỦ CÔNG sau khi tạo tài khoản)
-- Bước: Authentication → Users → Add user (email + mật khẩu, tick Auto Confirm),
-- rồi sửa email bên dưới, bỏ dấu "--" ở đầu dòng và chạy riêng câu lệnh này.
-- ---------------------------------------------------------------------
-- insert into public.user_roles (user_id, role)
-- select id, 'admin' from auth.users where email = 'EMAIL_ADMIN_CUA_BAN@example.com'
-- on conflict (user_id, role) do nothing;

-- =====================================================================
-- GIAI ĐOẠN 2 – MIGRATION (không xóa dữ liệu; chạy lại nhiều lần được)
-- Chạy SAU phần Giai đoạn 1 ở trên. Bổ sung cột, bảng nối tag và Storage.
-- =====================================================================

-- Danh mục cha/con
alter table public.categories add column if not exists parent_id uuid references public.categories(id) on delete set null;
alter table public.categories drop constraint if exists categories_no_self_parent;
alter table public.categories add constraint categories_no_self_parent check (parent_id is null or parent_id <> id);
create index if not exists categories_parent_idx on public.categories (parent_id);

-- Thông tin mở rộng cho AI
alter table public.ai_tools
  add column if not exists developer        text,
  add column if not exists screenshot_urls  text[] not null default '{}',
  add column if not exists platforms        text[] not null default '{}',
  add column if not exists features         text[] not null default '{}',
  add column if not exists pros             text[] not null default '{}',
  add column if not exists cons             text[] not null default '{}',
  add column if not exists api_info         text,
  add column if not exists pricing_notes    text,
  add column if not exists sources          text,
  add column if not exists verified_at      date;

-- Thông tin mở rộng cho Prompt
alter table public.prompts
  add column if not exists usage_guide text,
  add column if not exists variables   text[] not null default '{}',
  add column if not exists example     text,
  add column if not exists version     text not null default '1.0';

-- Bảng nối nhiều-nhiều: AI–Tag, Prompt–Tag
create table if not exists public.ai_tool_tags (
  ai_tool_id uuid not null references public.ai_tools(id) on delete cascade,
  tag_id     uuid not null references public.tags(id) on delete cascade,
  primary key (ai_tool_id, tag_id)
);
create table if not exists public.prompt_tags (
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  primary key (prompt_id, tag_id)
);
create index if not exists ai_tool_tags_tag_idx on public.ai_tool_tags (tag_id);
create index if not exists prompt_tags_tag_idx  on public.prompt_tags (tag_id);

revoke all on public.ai_tool_tags, public.prompt_tags from anon, authenticated;
grant select on public.ai_tool_tags, public.prompt_tags to anon;
grant select, insert, update, delete on public.ai_tool_tags, public.prompt_tags to authenticated;
alter table public.ai_tool_tags enable row level security;
alter table public.prompt_tags  enable row level security;

drop policy if exists "ai_tool_tags_public_read" on public.ai_tool_tags;
create policy "ai_tool_tags_public_read" on public.ai_tool_tags for select to anon, authenticated
  using (exists (select 1 from public.ai_tools t where t.id = ai_tool_id and t.status = 'published'));
drop policy if exists "ai_tool_tags_admin_all" on public.ai_tool_tags;
create policy "ai_tool_tags_admin_all" on public.ai_tool_tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "prompt_tags_public_read" on public.prompt_tags;
create policy "prompt_tags_public_read" on public.prompt_tags for select to anon, authenticated
  using (exists (select 1 from public.prompts p where p.id = prompt_id and p.status = 'published'));
drop policy if exists "prompt_tags_admin_all" on public.prompt_tags;
create policy "prompt_tags_admin_all" on public.prompt_tags for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Storage: bucket ảnh công khai (đọc qua URL), chỉ admin được upload/sửa/xóa.
-- Không tạo policy SELECT cho storage.objects => khách không liệt kê được toàn bộ file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-media', 'ai-media', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/png','image/jpeg','image/webp'];

drop policy if exists "ai_media_admin_all" on storage.objects;
create policy "ai_media_admin_all" on storage.objects for all to authenticated
  using (bucket_id = 'ai-media' and public.is_admin())
  with check (bucket_id = 'ai-media' and public.is_admin());
