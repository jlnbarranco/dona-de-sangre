import { createClient } from '@supabase/supabase-js';

const PASSWORD_FAKE = 'Demo12345!';

/**
 * Usuarios ficticios del laboratorio. El dominio `example.com` está reservado
 * por la RFC 2606 para documentación, así que ningún correo llega a una inbox real.
 */
const USUARIOS_FICTICIOS = [
  { nombre: 'María Fernández Ruiz', email: 'maria.fernandez@example.com', rol: 'admin', estatus: 'activo', confirmado: true },
  { nombre: 'Javier Morales Soto', email: 'javier.morales@example.com', rol: 'admin', estatus: 'activo', confirmado: true },
  { nombre: 'Ana López García', email: 'ana.lopez@example.com', rol: 'supervisor', estatus: 'activo', confirmado: true },
  { nombre: 'Carlos Mendoza Pérez', email: 'carlos.mendoza@example.com', rol: 'supervisor', estatus: 'activo', confirmado: true },
  { nombre: 'Lucía Ortega Navarro', email: 'lucia.ortega@example.com', rol: 'supervisor', estatus: 'activo', confirmado: true },
  { nombre: 'David Romero Vega', email: 'david.romero@example.com', rol: 'supervisor', estatus: 'inactivo', confirmado: true },
  { nombre: 'Elena Castillo Bravo', email: 'elena.castillo@example.com', rol: 'supervisor', estatus: 'activo', confirmado: true },
  { nombre: 'Sergio Ramos Gil', email: 'sergio.ramos@example.com', rol: 'capturador', estatus: 'activo', confirmado: true },
  { nombre: 'Patricia Molina Cruz', email: 'patricia.molina@example.com', rol: 'capturador', estatus: 'activo', confirmado: true },
  { nombre: 'Álvaro Herrera Díaz', email: 'alvaro.herrera@example.com', rol: 'capturador', estatus: 'activo', confirmado: true },
  { nombre: 'Isabel Martín Peña', email: 'isabel.martin@example.com', rol: 'capturador', estatus: 'inactivo', confirmado: true },
  { nombre: 'Roberto Domínguez Ruiz', email: 'roberto.dominguez@example.com', rol: 'capturador', estatus: 'activo', confirmado: true },
  { nombre: 'Marta Lozano Ortega', email: 'marta.lozano@example.com', rol: 'capturador', estatus: 'activo', confirmado: true },
  { nombre: 'Andrés Fuentes Blanco', email: 'andres.fuentes@example.com', rol: 'capturador', estatus: 'activo', confirmado: false, invitadoHaceDias: 3 },
  { nombre: 'Nuria Cabrera Prieto', email: 'nuria.cabrera@example.com', rol: 'capturador', estatus: 'activo', confirmado: false, invitadoHaceDias: 7 },
  { nombre: 'Tomás Iglesias Rey', email: 'tomas.iglesias@example.com', rol: 'capturador', estatus: 'activo', confirmado: true },
  { nombre: 'Silvia Brenner Polo', email: 'silvia.brenner@example.com', rol: 'capturador', estatus: 'inactivo', confirmado: false, invitadoHaceDias: 1 }
];

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_API_KEY;

if (!url || !secretKey) {
  console.error('Faltan SUPABASE_URL o SUPABASE_SECRET_API_KEY en el entorno.');
  process.exit(1);
}

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

/** Días transcurridos desde una fecha ISO, para simular invitaciones antiguas. */
function diasAtras(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() - dias);
  return fecha.toISOString();
}

async function existeUsuario(email) {
  const { data, error } = await admin.from('usuarios').select('id').eq('email', email).maybeSingle();
  if (error) throw error;
  return data !== null;
}

async function crearUsuario(usuario) {
  const { data, error } = await admin.auth.admin.createUser({
    email: usuario.email,
    password: PASSWORD_FAKE,
    email_confirm: usuario.confirmado,
    user_metadata: { nombre: usuario.nombre }
  });

  if (error) {
    throw new Error(`${usuario.email}: ${error.message}`);
  }

  // El trigger de auth solo crea el perfil; el rol, el estatus y el estado de
  // la invitación los decide el servidor, así que se escriben aquí.
  const { error: perfilError } = await admin
    .from('usuarios')
    .update({
      nombre: usuario.nombre,
      rol: usuario.rol,
      estatus: usuario.estatus,
      email_confirmado: usuario.confirmado,
      invitado_at: usuario.confirmado ? null : diasAtras(usuario.invitadoHaceDias ?? 1)
    })
    .eq('id', data.user.id);

  if (perfilError) {
    await admin.auth.admin.deleteUser(data.user.id);
    throw new Error(`${usuario.email}: ${perfilError.message}`);
  }

  return data.user.id;
}

const creados = [];
const omitidos = [];

for (const usuario of USUARIOS_FICTICIOS) {
  if (await existeUsuario(usuario.email)) {
    omitidos.push(usuario.email);
    console.log(`· ${usuario.email} ya existe, se omite.`);
    continue;
  }

  await crearUsuario(usuario);
  creados.push(usuario);
  console.log(`· ${usuario.email} creado (${usuario.rol} / ${usuario.estatus}).`);
}

console.log(`\n${creados.length} usuarios creados, ${omitidos.length} omitidos.`);
if (creados.length > 0) {
  console.log(`Contraseña de los usuarios ficticios: ${PASSWORD_FAKE}`);
}
