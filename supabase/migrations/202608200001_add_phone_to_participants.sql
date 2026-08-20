-- Add phone column to participants table for registration form
alter table participants
  add column if not exists phone text;

-- Add phone to the public view/export
create or replace view participants_with_company as
select
  p.id,
  p.event_id,
  p.company_id,
  p.first_name,
  p.last_name,
  p.email,
  p.phone,
  p.role,
  p.status,
  p.access_mode,
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
  c.name as company_name,
  c.c360_registration_number as company_reg
from participants p
left join companies c on p.company_id = c.id;
