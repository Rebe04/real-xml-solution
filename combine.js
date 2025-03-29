import fs from "fs";
import path from "path";
import { XMLParser, XMLBuilder } from "fast-xml-parser";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const INPUT_DIR = path.resolve("input");
const OUTPUT_FILE = path.resolve("output/residentials.xml");
const LOG_FILE = path.resolve("logs/combine.log");
const PROCESSED_DIR = path.resolve("processed");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});
const builder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  indentBy: "  ",
  suppressEmptyNode: true,
});

async function openDB() {
  return open({
    filename: path.resolve("database/properties.db"),
    driver: sqlite3.Database,
  });
}

function extractExtraField(fields, key) {
  const field = Array.isArray(fields)
    ? fields.find((f) => f["@_name"] === key)
    : fields?.["@_name"] === key
    ? fields
    : null;
  return field?.["@_value"] || null;
}

function extractPhone(tels, type) {
  const arr = Array.isArray(tels) ? tels : [tels];
  const tel = arr.find((t) => t?.["@_type"] === type);
  return tel?.["#text"] || null;
}

function extractAgent(agents) {
  const list = Array.isArray(agents) ? agents : [agents];
  const first = list.find((a) => a.name || a.email || a.telephone) || {};
  return {
    name: first.name || null,
    email: first.email || null,
    phone:
      extractPhone(first.telephone, "mobile") ||
      extractPhone(first.telephone, "BH") ||
      null,
    photo: first.photo || null,
  };
}

function extractFloorplan(objects) {
  if (!objects) return null;

  const entries = Object.entries(objects);
  for (const [key, value] of entries) {
    if (key === "floorplan") {
      if (Array.isArray(value)) {
        const match = value.find((v) => v?.["@_url"]);
        if (match) return match["@_url"];
      } else if (value?.["@_url"]) {
        return value["@_url"];
      }
    }
  }
  return null;
}

export default async function combineResidentials() {
  const db = await openDB();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS properties (
      uniqueID TEXT PRIMARY KEY,
      type TEXT,
      headline TEXT,
      description TEXT,
      price TEXT,
      priceView TEXT,
      status TEXT,
      street TEXT,
      suburb TEXT,
      state TEXT,
      postcode TEXT,
      country TEXT,
      bedrooms INTEGER,
      bathrooms INTEGER,
      carSpaces INTEGER,
      floorplan TEXT,
      gallery TEXT,
      facilities TEXT,
      nearby TEXT,
      site_direction TEXT,
      agent_name TEXT,
      agent_email TEXT,
      agent_phone TEXT,
      agent_photo TEXT,
      raw_json TEXT
    )
  `);

  if (!fs.existsSync(PROCESSED_DIR)) {
    fs.mkdirSync(PROCESSED_DIR);
  }

  const files = fs.readdirSync(INPUT_DIR).filter((f) => f.endsWith(".xml"));
  const residentialMap = new Map();
  const logLines = [];

  for (const file of files) {
    const fullPath = path.join(INPUT_DIR, file);
    const xml = fs.readFileSync(fullPath, "utf-8");
    const parsed = parser.parse(xml);

    const residential =
      parsed?.propertyList?.residential || parsed?.residential;

    if (!residential) {
      const msg = `⚠️ Archivo ignorado (sin <residential>): ${file}`;
      console.warn(msg);
      logLines.push(msg);
      continue;
    }

    const resArray = Array.isArray(residential) ? residential : [residential];

    for (const res of resArray) {
      const id = res?.uniqueID;
      if (!id) {
        const msg = `⚠️ Propiedad sin uniqueID en ${file}`;
        console.warn(msg);
        logLines.push(msg);
        continue;
      }

      if (residentialMap.has(id)) {
        logLines.push(`🔁 Actualizada propiedad ${id} desde ${file}`);
      } else {
        logLines.push(`🆕 Añadida propiedad ${id} desde ${file}`);
      }

      residentialMap.set(id, res);

      const address = res.address || {};
      const imagesRaw = res.objects?.img || [];
      const gallery = Array.isArray(imagesRaw)
        ? imagesRaw.map((img) => img?.["@_url"]).filter(Boolean)
        : imagesRaw?.["@_url"]
        ? [imagesRaw["@_url"]]
        : [];

      const features = res.features || {};
      const nearby = res.nearby || {};
      const extraFields = res.extraFields || [];
      const agents = res.listingAgent || [];

      const agent = extractAgent(agents);
      const priceValue =
        typeof res.price === "object" ? res.price["#text"] : res.price;
      const suburbValue =
        typeof address.suburb === "object"
          ? address.suburb["#text"]
          : address.suburb;
      const typeValue = res.category?.["@_name"] || null;
      const floorplanValue = extractFloorplan(res.objects);
      const siteDirectionValue = extractExtraField(
        extraFields,
        "streetAddress"
      );

      const stmt = await db.prepare(`
        INSERT INTO properties (
          uniqueID, type, headline, description, price, priceView, status,
          street, suburb, state, postcode, country,
          bedrooms, bathrooms, carSpaces,
          floorplan, gallery, facilities, nearby, site_direction,
          agent_name, agent_email, agent_phone, agent_photo, raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(uniqueID) DO UPDATE SET
          type=excluded.type,
          headline=excluded.headline,
          description=excluded.description,
          price=excluded.price,
          priceView=excluded.priceView,
          status=excluded.status,
          street=excluded.street,
          suburb=excluded.suburb,
          state=excluded.state,
          postcode=excluded.postcode,
          country=excluded.country,
          bedrooms=excluded.bedrooms,
          bathrooms=excluded.bathrooms,
          carSpaces=excluded.carSpaces,
          floorplan=excluded.floorplan,
          gallery=excluded.gallery,
          facilities=excluded.facilities,
          nearby=excluded.nearby,
          site_direction=excluded.site_direction,
          agent_name=excluded.agent_name,
          agent_email=excluded.agent_email,
          agent_phone=excluded.agent_phone,
          agent_photo=excluded.agent_photo,
          raw_json=excluded.raw_json
      `);

      await stmt.run(
        id,
        typeValue,
        res.headline || null,
        res.description || null,
        priceValue,
        res.priceView || null,
        res["@_status"] || null,
        address.street || null,
        suburbValue,
        address.state || null,
        address.postcode || null,
        address.country || null,
        parseInt(features.bedrooms) || null,
        parseInt(features.bathrooms) || null,
        parseInt(features.garages) || null,
        floorplanValue,
        JSON.stringify(gallery),
        JSON.stringify(features),
        JSON.stringify(nearby),
        siteDirectionValue,
        agent.name,
        agent.email,
        agent.phone,
        agent.photo,
        JSON.stringify(res)
      );

      await stmt.finalize();
    }

    // const targetPath = path.join(PROCESSED_DIR, file);
    // fs.renameSync(fullPath, targetPath);
    // logLines.push(`📦 Archivo procesado movido a /processed: ${file}`);
  }

  const finalXml = builder.build({
    residentials: { residential: Array.from(residentialMap.values()) },
  });

  fs.writeFileSync(OUTPUT_FILE, finalXml);

  const summary = `✅ Combinación finalizada: ${residentialMap.size} propiedades únicas.`;
  logLines.push(summary);
  console.log(summary);

  const logContent =
    `[${new Date().toISOString()}]\n` + logLines.join("\n") + "\n\n";
  fs.appendFileSync(LOG_FILE, logContent);

  await db.close();
}
