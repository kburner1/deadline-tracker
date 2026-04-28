-- Project Deadline Tracker starter schema
-- Run this in Supabase SQL Editor after creating a project.

create extension if not exists "pgcrypto";

create type project_status as enum ('Design', 'CA', 'Complete', 'On Hold');
create type app_role as enum ('admin', 'project_lead', 'team_member');
create type task_status as enum ('Not Started', 'In Progress', 'Waiting', 'Done');
create type change_request_status as enum ('pending', 'approved', 'rejected');
create type calendar_event_type as enum ('design_milestone', 'task', 'ca_deadline');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role app_role not null default 'team_member',
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  project_number text not null,
  client text,
  architect text,
  status project_status not null default 'Design',
  lead_user_id uuid references profiles(id),
  general_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_number)
);

create table project_members (
  project_id uuid references projects(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  role_on_project app_role not null default 'team_member',
  primary key (project_id, user_id)
);

create table buildings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  label text not null,
  due_date date not null,
  notes text,
  is_ca_deadline boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table milestone_buildings (
  milestone_id uuid references milestones(id) on delete cascade,
  building_id uuid references buildings(id) on delete cascade,
  primary key (milestone_id, building_id)
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  building_id uuid references buildings(id) on delete set null,
  milestone_id uuid references milestones(id) on delete set null,
  title text not null,
  assigned_to uuid references profiles(id),
  due_date date,
  status task_status not null default 'Not Started',
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table milestone_change_requests (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references milestones(id) on delete cascade,
  proposed_due_date date,
  proposed_label text,
  reason text not null,
  requested_by uuid not null references profiles(id),
  status change_request_status not null default 'pending',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  message text not null,
  related_project_id uuid references projects(id) on delete cascade,
  related_task_id uuid references tasks(id) on delete cascade,
  related_milestone_id uuid references milestones(id) on delete cascade,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

-- Calendar source view: one query can feed dashboard + calendar.
create or replace view calendar_items as
select
  m.id,
  case
    when m.is_ca_deadline = true or p.status = 'CA' then 'ca_deadline'::calendar_event_type
    else 'design_milestone'::calendar_event_type
  end as event_type,
  p.id as project_id,
  p.title as project_title,
  m.label,
  m.due_date,
  coalesce(array_agg(b.name order by b.name) filter (where b.id is not null), array[]::text[]) as buildings
from milestones m
join projects p on p.id = m.project_id
left join milestone_buildings mb on mb.milestone_id = m.id
left join buildings b on b.id = mb.building_id
group by m.id, p.id, p.title, p.status, m.label, m.due_date, m.is_ca_deadline

union all

select
  t.id,
  'task'::calendar_event_type as event_type,
  p.id as project_id,
  p.title as project_title,
  t.title as label,
  t.due_date,
  case when b.name is null then array[]::text[] else array[b.name] end as buildings
from tasks t
join projects p on p.id = t.project_id
left join buildings b on b.id = t.building_id
where t.due_date is not null;
