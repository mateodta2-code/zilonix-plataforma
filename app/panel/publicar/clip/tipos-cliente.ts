// Rama feat-publicar-clip — tipos espejo de las respuestas JSON de
// app/api/ml/clip/* (FilaBusquedaClip de lib/ml/clip.ts, TrabajoClip
// de lib/trabajos/subirClipMultiCuenta.ts, ClipMl de lib/ml/cliente.ts)
// para usar del lado del cliente SIN importar esos módulos del
// servidor (misma razón de siempre: arrastran lib/ml/cuentas.ts ->
// db/empresa-context.ts). Si la forma real cambia de un lado, se
// actualiza a mano del otro — no hay una sola fuente de verdad posible
// entre servidor y cliente sin compartir el import.
export type FilaBusquedaClipCliente = {
  cuentaId: string;
  nickname: string;
  encontrado: boolean;
  itemId: string | null;
  titulo: string | null;
  thumbnail: string | null;
  activo: boolean;
  motivoNoDisponible: string | null;
};

export type EstadoCuentaClipCliente = "en_cola" | "subiendo" | "en_moderacion" | "publicado" | "rechazado" | "error";

export type ProgresoCuentaClipCliente = {
  cuentaId: string;
  nickname: string;
  itemId: string;
  estado: EstadoCuentaClipCliente;
  error: string | null;
  clipUuid: string | null;
};

export type TrabajoClipCliente = {
  id: string;
  empresaId: string;
  creadoTs: number;
  terminadoTs: number | null;
  cuentas: ProgresoCuentaClipCliente[];
};

export type ClipMlCliente = { clipUuid: string | null; moderationStatus: string | null; motivoRechazo: string | null };

// Rama mateo/clip-estado-automatico — espejo de FilaEstadoClip
// (app/api/ml/clip/estado/route.ts). `limiteMl`/`retryAfterMs` nuevos:
// distinguen un 429 real de Mercado Libre de "todavía no hay clips"
// (clips:null también pasa en ese caso, antes de esta rama) — el
// polling automático de SeccionClip.tsx los necesita para esperar en
// vez de insistir a ciegas.
export type FilaEstadoClipCliente = { cuentaId: string; itemId: string; clips: ClipMlCliente[] | null; limiteMl?: boolean; retryAfterMs?: number | null };
