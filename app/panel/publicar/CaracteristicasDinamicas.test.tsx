// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CaracteristicasDinamicas, combinarNumeroUnidad, separarNumeroUnidad, type CaracteristicaCategoria } from "./CaracteristicasDinamicas";

afterEach(cleanup);

const edad: CaracteristicaCategoria = {
  id: "MAX_RECOMMENDED_AGE",
  nombre: "Edad máxima",
  obligatorio: true,
  valores: [],
  valueType: "number_unit",
  permiteVariante: false,
  definePic: false,
  unidades: ["años", "meses"],
  unidadPorDefecto: "años",
};

describe("CaracteristicasDinamicas — number_unit", () => {
  it("la unidad por defecto aparece preseleccionada y el valor combinado sube bien", () => {
    const onCambiar = vi.fn();
    render(<CaracteristicasDinamicas principales={[edad]} secundarias={[]} valores={{}} onCambiar={onCambiar} />);
    expect((screen.getByLabelText("Edad máxima (unidad)") as HTMLSelectElement).value).toBe("años");
    fireEvent.change(screen.getByLabelText("Edad máxima (número)"), { target: { value: "18" } });
    expect(onCambiar).toHaveBeenLastCalledWith("MAX_RECOMMENDED_AGE", "18 años");
  });
  it("cambiar la unidad conserva el número", () => {
    const onCambiar = vi.fn();
    render(<CaracteristicasDinamicas principales={[edad]} secundarias={[]} valores={{ MAX_RECOMMENDED_AGE: "18 años" }} onCambiar={onCambiar} />);
    fireEvent.change(screen.getByLabelText("Edad máxima (unidad)"), { target: { value: "meses" } });
    expect(onCambiar).toHaveBeenLastCalledWith("MAX_RECOMMENDED_AGE", "18 meses");
  });
  it("un valor guardado «18 meses» se separa para mostrarlo (Reintentar/Duplicar)", () => {
    render(<CaracteristicasDinamicas principales={[edad]} secundarias={[]} valores={{ MAX_RECOMMENDED_AGE: "18 meses" }} onCambiar={vi.fn()} />);
    expect((screen.getByLabelText("Edad máxima (número)") as HTMLInputElement).value).toBe("18");
    expect((screen.getByLabelText("Edad máxima (unidad)") as HTMLSelectElement).value).toBe("meses");
  });
  it("helpers de separar/combinar", () => {
    expect(separarNumeroUnidad("1,5 kg")).toEqual({ numero: "1,5", unidad: "kg" });
    expect(combinarNumeroUnidad("", "kg")).toBe("");
  });
});
