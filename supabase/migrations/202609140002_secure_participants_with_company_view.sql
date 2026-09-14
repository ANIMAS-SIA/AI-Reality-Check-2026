-- Create a security-definer function to safely expose participants_with_company view
-- This bypasses RLS restrictions on the underlying participants table

create or replace function get_participants_with_company()
returns table (
  id uuid,
  event_id uuid,
  company_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  role text,
  status text,
  access_mode text,
  ai_stage text,
  ai_stage_is_anonymous boolean,
  public_company_allowed boolean,
  networking_allowed boolean,
  newsletter_allowed boolean,
  attendance_reconfirmed_at timestamptz,
  cancelled_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  company_name text,
  company_reg text
)
language sql
security definer
set search_path = public
as $$
  select
    p.id,
    p.event_id,
    p.company_id,
    p.first_name,
    p.last_name,
    p.email,
    p.phone,
    p.role,
    p.status::text,
    p.access_mode::text,
    p.ai_stage,
    p.ai_stage_is_anonymous,
    p.public_company_allowed,
    p.networking_allowed,
    p.newsletter_allowed,
    p.attendance_reconfirmed_at,
    p.cancelled_at,
    p.approved_at,
    p.created_at,
    p.updated_at,
    c.name,
    c.c360_registration_number
  from participants p
  left join companies c on p.company_id = c.id;
$$;

-- Grant execute permission to authenticated users
grant execute on function get_participants_with_company() to authenticated;

-- Create a view that calls this secure function
drop view if exists participants_with_company;

create view participants_with_company as
  select * from get_participants_with_company();
