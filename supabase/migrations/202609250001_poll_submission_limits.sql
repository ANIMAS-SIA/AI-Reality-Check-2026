-- Track one-time poll submissions independently from selected options.
-- This preserves multiple-choice votes while preventing the same participant
-- or anonymous browser session from submitting a second response.
create table public.poll_submission_guards (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  poll_id uuid not null references public.polls(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  anonymous_session_id text,
  created_at timestamptz not null default now(),
  check ((participant_id is not null) <> (anonymous_session_id is not null))
);

alter table public.poll_submission_guards enable row level security;

create unique index poll_submission_guards_participant_key
  on public.poll_submission_guards (poll_id, participant_id)
  where participant_id is not null;

create unique index poll_submission_guards_anonymous_key
  on public.poll_submission_guards (poll_id, anonymous_session_id)
  where anonymous_session_id is not null;

create index poll_submission_guards_event_scope
  on public.poll_submission_guards (event_id);

create trigger inherit_parent_event before insert or update
  on public.poll_submission_guards for each row
  execute function public.inherit_parent_event('poll_id', 'polls');

-- Existing non-text votes behaved as one-response polls in the UI. Claim
-- their identities so the new enforcement does not grant an extra response.
insert into public.poll_submission_guards (
  event_id,
  poll_id,
  participant_id,
  anonymous_session_id,
  created_at
)
select
  p.event_id,
  v.poll_id,
  v.participant_id,
  v.anonymous_session_id,
  min(v.created_at)
from public.poll_votes v
join public.polls p on p.id = v.poll_id
where coalesce(
  case
    when p.settings ? 'allowMultipleSubmissions'
      then (p.settings ->> 'allowMultipleSubmissions')::boolean
    else p.poll_type in ('open_text', 'word_cloud')
  end,
  false
) = false
group by p.event_id, v.poll_id, v.participant_id, v.anonymous_session_id
on conflict do nothing;
