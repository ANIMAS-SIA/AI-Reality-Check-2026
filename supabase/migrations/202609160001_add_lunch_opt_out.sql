-- Add lunch opt-out columns to participants table
-- Allows participants to decline lunch attendance from their AI Pass

ALTER TABLE public.participants
ADD COLUMN IF NOT EXISTS lunch_opt_out BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.participants
ADD COLUMN IF NOT EXISTS lunch_opted_out_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.participants.lunch_opt_out
IS 'Whether participant has opted out of lunch (false = will attend; true = will not attend)';

COMMENT ON COLUMN public.participants.lunch_opted_out_at
IS 'Timestamp when participant opted out of lunch';

CREATE INDEX IF NOT EXISTS idx_participants_lunch_opt_out
ON public.participants (lunch_opt_out)
WHERE lunch_opt_out = true;

CREATE OR REPLACE VIEW public.participants_with_company AS
SELECT
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
    c.name AS company_name,
    c.c360_registration_number AS company_reg,
    p.lunch_opt_out,
    p.lunch_opted_out_at
FROM public.participants p
LEFT JOIN public.companies c
    ON p.company_id = c.id;
