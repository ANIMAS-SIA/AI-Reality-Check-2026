-- Add RLS policy to participants_with_company view
-- This view was showing as "Restricted" because the underlying participants table has RLS enabled
-- but the view itself had no policies

alter table participants_with_company enable row level security;

create policy "Allow authenticated read" on participants_with_company
  for select
  using (auth.role() = 'authenticated');
