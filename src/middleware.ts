import { defineMiddleware } from 'astro:middleware';
import { createSupabaseServerClient } from './lib/supabase';

const DASHBOARD_PATH = '/dashboard';
const LOGIN_PATH = '/auth/login';

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createSupabaseServerClient(context.request, context.cookies);
  context.locals.supabase = supabase;
  context.locals.claims = null;

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;
  context.locals.claims = claims;

  const { pathname, search } = context.url;

  if (!claims && isProtectedPath(pathname)) {
    const nextUrl = encodeURIComponent(`${pathname}${search}`);
    return context.redirect(`${LOGIN_PATH}?next=${nextUrl}`);
  }

  if (claims && pathname === LOGIN_PATH) {
    return context.redirect(DASHBOARD_PATH);
  }

  return next();
});

function isProtectedPath(pathname: string): boolean {
  return pathname === DASHBOARD_PATH || pathname.startsWith(`${DASHBOARD_PATH}/`);
}
