// @vitest-environment jsdom
//
// Rama fix-investigacion-busquedas-1h (Refs #227) — causa raíz real
// del reporte de Mateo: FormularioAnalizar usa <form method="get">
// SIN preventDefault, así que cada "Analizar" es una navegación
// COMPLETA del navegador (nunca una transición cliente). Si esa
// navegación ocurre mientras el escaneo anterior sigue en curso (el
// mensaje "listado-importado" de la extensión todavía no llegó), esa
// página entera se destruye con su `window` — el resultado de la
// búsqueda anterior nunca llega a existir, ni en memoria ni en
// localStorage, sin ninguna carrera de por medio: el contexto de JS
// que lo iba a guardar ya no está.
//
// Este test prueba la causa, no el síntoma: mientras el submit siga
// siendo un GET nativo sin cancelar, CUALQUIER escaneo en curso es
// descartable con solo tocar "Analizar" de nuevo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FormularioAnalizar } from "./FormularioAnalizar";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("FormularioAnalizar — Analizar no debe ser una navegación completa (Refs #227)", () => {
  it("al enviar el formulario, el submit se cancela (nunca una navegación GET nativa que mate un escaneo en curso)", () => {
    render(<FormularioAnalizar termino="zapatos" tab="demanda" />);
    const boton = screen.getByRole("button", { name: "Analizar" });
    const form = boton.closest("form") as HTMLFormElement;

    // fireEvent.submit devuelve false cuando algún handler llamó
    // preventDefault() — true significa "el navegador seguiría con la
    // navegación nativa", que es exactamente lo que no debe pasar.
    const siguioElEventoSinCancelar = fireEvent.submit(form);
    expect(siguioElEventoSinCancelar).toBe(false);
    // En vez de la navegación nativa, debe navegar con el router de
    // Next.js — misma pestaña/`window` viva, nunca se destruye el
    // contexto que tenía en curso el escaneo de la búsqueda anterior.
    expect(push).toHaveBeenCalledWith("/panel/investigacion?termino=zapatos&tab=demanda");
  });
});
