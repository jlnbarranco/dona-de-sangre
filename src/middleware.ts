import type { APIContext } from 'astro';
import { defineMiddleware } from 'astro:middleware';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentUser } from './lib/current-user';
import type { Database } from './lib/database.types';
import { createSupabaseServerClient } from './lib/supabase';

const DASHBOARD_PATH = '/dashboard';
const LOGIN_PATH = '/auth/login';
const DISABLED_ACCOUNT_PATH = '/cuenta-desactivada';
const DISABLED_ACCOUNT_MESSAGE = 'Tu cuenta está desactivada. Contacta con el administrador.';

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createSupabaseServerClient(context.request, context.cookies);
  context.locals.supabase = supabase;
  context.locals.claims = null;
  context.locals.currentUser = null;

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims ?? null;
  context.locals.claims = claims;

  const { pathname, search } = context.url;

  if (!claims && isProtectedPath(pathname)) {
    const nextUrl = encodeURIComponent(`${pathname}${search}`);
    return context.redirect(`${LOGIN_PATH}?next=${nextUrl}`);
  }

  // La ruta de cuenta desactivada queda exenta: si el cierre de sesión fallara,
  // la cookie sobreviviría y la página se redirigiría a sí misma en bucle.
  if (claims && pathname !== DISABLED_ACCOUNT_PATH) {
    const { data: currentUser, error } = await getCurrentUser(supabase, claims);

    if (error) {
      console.error('[middleware] no se pudo leer el perfil del solicitante:', error.message);
      return serviceUnavailable(pathname);
    }

    context.locals.currentUser = currentUser;

    if (currentUser?.estatus === 'inactivo') {
      await signOut(supabase);
      return disabledAccountResponse(context, pathname);
    }
  }

  if (claims && pathname === LOGIN_PATH) {
    return context.redirect(DASHBOARD_PATH);
  }

  return next();
});

function isProtectedPath(pathname: string): boolean {
  return pathname === DASHBOARD_PATH || pathname.startsWith(`${DASHBOARD_PATH}/`);
}

function isApiPath(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

async function signOut(supabase: SupabaseClient<Database>): Promise<void> {
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error('[middleware] no se pudo cerrar la sesión:', error.message);
  }
}

function disabledAccountResponse(context: APIContext, pathname: string): Response {
  if (isApiPath(pathname)) {
    return jsonResponse(403, { error: DISABLED_ACCOUNT_MESSAGE });
  }

  return context.redirect(DISABLED_ACCOUNT_PATH);
}

function serviceUnavailable(pathname: string): Response {
  if (isApiPath(pathname)) {
    return jsonResponse(503, { error: 'No se pudo verificar el estado de la cuenta.' });
  }

  return new Response('Servicio no disponible', { status: 503 });
}

function jsonResponse(status: number, body: { error: string }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
