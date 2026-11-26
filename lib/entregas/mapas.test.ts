import { describe, expect, it } from "vitest";
import { linkGoogleMaps, linkWaze, textoDireccion } from "./mapas";

describe("mapas del domiciliario", () => {
  it("arma la dirección con barrio y ciudad, sin espacios de más", () => {
    expect(textoDireccion({ direccion: " Calle 1  # 2-3 ", barrio: "Centro", ciudad: "Medellín" })).toBe("Calle 1 # 2-3, Centro, Medellín");
    expect(textoDireccion({ direccion: "Cra 5 # 10-20", barrio: null, ciudad: "Bogotá" })).toBe("Cra 5 # 10-20, Bogotá");
  });

  it("sin dirección no hay link (entrega cerrada: la base no la devuelve)", () => {
    expect(textoDireccion({ direccion: null, barrio: null, ciudad: null })).toBeNull();
    expect(textoDireccion({ direccion: "  ", barrio: "Centro", ciudad: "Cali" })).toBeNull();
  });

  it("links documentados, con la dirección codificada (el # no corta la URL)", () => {
    const d = "Calle 1 # 2-3, Centro, Medellín";
    expect(linkGoogleMaps(d)).toBe("https://www.google.com/maps/dir/?api=1&destination=Calle%201%20%23%202-3%2C%20Centro%2C%20Medell%C3%ADn");
    expect(linkWaze(d)).toBe("https://waze.com/ul?q=Calle%201%20%23%202-3%2C%20Centro%2C%20Medell%C3%ADn");
    expect(new URL(linkGoogleMaps(d)).searchParams.get("destination")).toBe(d);
    expect(new URL(linkWaze(d)).searchParams.get("q")).toBe(d);
  });
});
