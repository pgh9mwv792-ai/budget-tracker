-- Budget tracker: profile avatar storage
-- Run this in the Supabase SQL editor (or via `supabase db push`) AFTER 0005.
--
-- Creates a public "avatars" storage bucket and policies so each user can
-- upload/replace/remove ONLY their own avatar. Files are stored under a folder
-- named after the user's id (e.g. "<user-id>/avatar.png"), and the policies key
-- off that first path segment so nobody can overwrite someone else's image.
-- The bucket is public-read so <img src> works without signed URLs; the image
-- URL is saved on the user's auth metadata (avatar_url).

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "Avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "Users can upload their own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
