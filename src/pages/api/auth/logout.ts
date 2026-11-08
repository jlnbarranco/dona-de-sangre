import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ locals, redirect }) => {
  await locals.supabase.auth.signOut();
  return redirect('/auth/login');
};

export const GET: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } });
