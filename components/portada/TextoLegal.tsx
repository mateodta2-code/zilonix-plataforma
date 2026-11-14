import { Fragment, type ReactNode } from "react";
import styles from "./TextoLegal.module.css";

// Renderiza el Markdown acotado de los textos legales (títulos, listas,
// tablas y **negrita**) sin agregar ninguna librería.

function enLinea(texto: string): ReactNode[] {
  return texto.split(/(\*\*[^*]+\*\*)/g).map((trozo, i) =>
    trozo.startsWith("**") && trozo.endsWith("**") && trozo.length > 4 ? (
      <strong key={i}>{trozo.slice(2, -2)}</strong>
    ) : (
      <Fragment key={i}>{trozo}</Fragment>
    ),
  );
}

const celdas = (linea: string) =>
  linea
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function TextoLegal({ markdown }: { markdown: string }) {
  const lineas = markdown.split("\n");
  const bloques: ReactNode[] = [];
  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i];
    if (!linea.trim()) {
      i++;
    } else if (linea.startsWith("# ")) {
      i++; // el título principal lo pone la página
    } else if (linea.startsWith("## ")) {
      bloques.push(<h2 key={i}>{linea.slice(3)}</h2>);
      i++;
    } else if (linea.startsWith("### ")) {
      bloques.push(<h3 key={i}>{linea.slice(4)}</h3>);
      i++;
    } else if (linea.startsWith("- ")) {
      const items: ReactNode[] = [];
      for (; i < lineas.length && lineas[i].startsWith("- "); i++) items.push(<li key={i}>{enLinea(lineas[i].slice(2))}</li>);
      bloques.push(<ul key={`ul${i}`}>{items}</ul>);
    } else if (linea.startsWith("|")) {
      const filas: string[][] = [];
      const inicio = i;
      for (; i < lineas.length && lineas[i].startsWith("|"); i++) {
        if (!/^\|[\s|:-]+\|$/.test(lineas[i])) filas.push(celdas(lineas[i]));
      }
      const [cabecera, ...cuerpo] = filas;
      bloques.push(
        <div key={`t${inicio}`} className={styles.tabla}>
          <table>
            <thead>
              <tr>{cabecera.map((c, k) => <th key={k}>{enLinea(c)}</th>)}</tr>
            </thead>
            <tbody>
              {cuerpo.map((fila, r) => (
                <tr key={r}>{fila.map((c, k) => <td key={k}>{enLinea(c)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
    } else {
      bloques.push(<p key={i}>{enLinea(linea)}</p>);
      i++;
    }
  }
  return <div className={styles.texto}>{bloques}</div>;
}
