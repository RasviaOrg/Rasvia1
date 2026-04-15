alter table public.restaurants
  add column if not exists use_regular_image_as_first_slide boolean not null default true;

comment on column public.restaurants.use_regular_image_as_first_slide is
  'When true, the regular restaurant image (or no-image fallback) is rendered as slide 1 ahead of custom carousel slides.';
