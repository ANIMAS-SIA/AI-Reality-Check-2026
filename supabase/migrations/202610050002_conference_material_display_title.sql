alter table public.conference_materials
  add column display_title text not null default 'AI Reality Check 2026 prezentācijas';

alter table public.conference_materials
  add constraint conference_materials_display_title_length
  check (char_length(btrim(display_title)) between 1 and 120);

comment on column public.conference_materials.display_title is
  'Editable public title shown on the Live and AI Pass material card; independent from the download filename.';
