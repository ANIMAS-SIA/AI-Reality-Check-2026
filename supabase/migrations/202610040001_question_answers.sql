-- Written answers turn the moderated question stream into a durable Q&A archive.
alter table public.questions
  add column if not exists answer_body text,
  add column if not exists answer_updated_at timestamptz,
  add column if not exists answer_updated_by uuid references auth.users(id) on delete set null;

alter table public.questions
  drop constraint if exists questions_answer_body_length;

alter table public.questions
  add constraint questions_answer_body_length
  check (answer_body is null or char_length(btrim(answer_body)) between 1 and 4000);

create or replace function public.bulk_answer_questions(
  p_event_id uuid,
  p_actor_user_id uuid,
  p_answers jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  requested_count integer;
  updated_count integer;
begin
  if jsonb_typeof(p_answers) is distinct from 'array' then
    raise exception 'Answers must be a JSON array';
  end if;

  select count(*) into requested_count
  from jsonb_array_elements(p_answers);

  with answer_rows as (
    select
      (item ->> 'questionId')::uuid as question_id,
      btrim(item ->> 'answer') as answer
    from jsonb_array_elements(p_answers) item
  )
  update public.questions as question
  set answer_body = answer_rows.answer,
      status = 'answered',
      answered_at = coalesce(question.answered_at, clock_timestamp()),
      answer_updated_at = clock_timestamp(),
      answer_updated_by = p_actor_user_id
  from answer_rows
  where question.event_id = p_event_id
    and question.id = answer_rows.question_id
    and char_length(answer_rows.answer) between 1 and 4000;

  get diagnostics updated_count = row_count;
  if updated_count <> requested_count then
    raise exception 'One or more questions were missing or had an invalid answer';
  end if;

  return updated_count;
end;
$$;

revoke all on function public.bulk_answer_questions(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.bulk_answer_questions(uuid, uuid, jsonb) to service_role;
