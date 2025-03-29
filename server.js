import express from "express";
import cors from "cors";
import path from "path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import { fileURLToPath } from "url";
import combineResidentials from "./combine.js";
import fs from "fs/promises"; // Usar la versión basada en promesas de fs

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, "database", "properties.db");

const app = express();
const PORT = 3000;
app.use(cors());

// Conectar a la base de datos SQLite
async function openDB() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });
  return db;
}

// Endpoint para obtener todas las propiedades con filtro
app.get("/api/properties", async (req, res) => {
  const db = await openDB();
  let query = "SELECT * FROM properties WHERE 1=1";
  const params = [];

  // Filtrar por status, suburb, etc.
  if (req.query.status) {
    query += " AND status = ?";
    params.push(req.query.status);
  }
  if (req.query.bedrooms) {
    query += " AND bedrooms = ?";
    params.push(req.query.bedrooms);
  }
  if (req.query.suburb) {
    query += " AND suburb = ?";
    params.push(req.query.suburb);
  }

  const properties = await db.all(query, params);
  res.json(properties);
});

// Endpoint para obtener una propiedad por ID
app.get("/api/properties/:id", async (req, res) => {
  const db = await openDB();
  const property = await db.get(
    "SELECT * FROM properties WHERE uniqueID = ?",
    req.params.id
  );

  if (property) {
    res.json(property);
  } else {
    res.status(404).json({ error: "Not found" });
  }
});

// Endpoint para servir el XML generado
app.get("/feed", async (req, res) => {
  const feedPath = path.join(__dirname, "output", "residentials.xml");

  try {
    // Verificar si el archivo existe de forma asincrónica
    await fs.access(feedPath);

    // Si el archivo existe, lo servimos
    res.setHeader("Content-Type", "application/xml");
    res.sendFile(feedPath);
  } catch (err) {
    // Si el archivo no existe, devolvemos un error 404
    res.status(404).send("El feed aún no ha sido generado.");
  }
});

// Ejecutar combinación al iniciar el servidor
await combineResidentials();

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
