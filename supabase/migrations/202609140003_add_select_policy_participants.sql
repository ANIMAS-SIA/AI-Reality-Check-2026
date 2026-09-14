-- Add RLS select policy to participants table
-- This allows authenticated users to read participant data (themselves or all if admin)

create policy "Allow authenticated users to select participants"
  on participants
  for select
  using (auth.role() = 'authenticated');
