import type { APIRoute } from 'astro';

const INVALID_CREDENTIALS_URL = '/auth/login?error=invalid_credentials';

export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const formData = await request.formData();
  const email = formData.get('email');
  const password = formData.get('password');

  if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
    return redirect(INVALID_CREDENTIALS_URL);
  }

  const { error } = await locals.supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  });

  if (error) {
    return redirect(INVALID_CREDENTIALS_URL);
  }

  return redirect('/dashboard');
};

export const GET: APIRoute = () =>
  new Response(null, { status: 405, headers: { Allow: 'POST' } });
