var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// server/index.ts
import express2 from "express";

// server/routes.ts
import { createServer } from "http";

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  activityRecords: () => activityRecords,
  appSettings: () => appSettings,
  createActivityRecordSchema: () => createActivityRecordSchema,
  insertWorkerSchema: () => insertWorkerSchema,
  loginSchema: () => loginSchema,
  recordTypeEnum: () => recordTypeEnum,
  updateLocationSchema: () => updateLocationSchema,
  updateSettingsSchema: () => updateSettingsSchema,
  workers: () => workers
});
import { pgTable, text, serial, integer, boolean, doublePrecision, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var recordTypeEnum = pgEnum("record_type", ["CHECK_IN", "CHECK_OUT", "LOCATION_UPDATE"]);
var workers = pgTable("workers", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").default("worker"),
  isActive: boolean("is_active").default(true).notNull(),
  isOnline: boolean("is_online").default(false).notNull(),
  lastSeen: timestamp("last_seen").defaultNow().notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  locationLastUpdated: timestamp("location_last_updated"),
  deviceId: text("device_id"),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var activityRecords = pgTable("activity_records", {
  id: serial("id").primaryKey(),
  workerId: integer("worker_id").notNull().references(() => workers.id),
  type: text("type").notNull(),
  // CHECK_IN, CHECK_OUT, LOCATION_UPDATE
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  latitude: doublePrecision("latitude").notNull(),
  longitude: doublePrecision("longitude").notNull(),
  metadata: jsonb("metadata"),
  // Info adicional: exactitud GPS, batería, etc.
  sentToServer: boolean("sent_to_server").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var appSettings = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  locationUpdateInterval: integer("location_update_interval").default(5).notNull(),
  // En minutos
  keepAliveInterval: integer("keep_alive_interval").default(15).notNull(),
  // En minutos
  apiEndpoint: text("api_endpoint"),
  lastSyncTimestamp: timestamp("last_sync_timestamp"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Configuraciones para ahorro de batería
  batterySavingMode: boolean("battery_saving_mode").default(false).notNull(),
  highAccuracyMode: boolean("high_accuracy_mode").default(true).notNull(),
  batteryLowThreshold: integer("battery_low_threshold").default(20).notNull(),
  // Porcentaje de batería considerado bajo
  batteryLowUpdateInterval: integer("battery_low_update_interval").default(15).notNull(),
  // En minutos
  inactiveTimeThreshold: integer("inactive_time_threshold").default(30).notNull(),
  // En minutos
  motionDetectionEnabled: boolean("motion_detection_enabled").default(true).notNull(),
  minimumMovementDistance: integer("minimum_movement_distance").default(10).notNull()
  // En metros
});
var insertWorkerSchema = createInsertSchema(workers).pick({
  username: true,
  password: true,
  name: true,
  role: true,
  deviceId: true
});
var updateLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number()
});
var loginSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  deviceId: z.string().optional()
});
var createActivityRecordSchema = z.object({
  type: z.enum(["CHECK_IN", "CHECK_OUT", "LOCATION_UPDATE"]),
  latitude: z.number(),
  longitude: z.number(),
  metadata: z.record(z.string(), z.any()).optional()
});
var updateSettingsSchema = z.object({
  locationUpdateInterval: z.number().optional(),
  keepAliveInterval: z.number().optional(),
  apiEndpoint: z.string().optional(),
  // Configuraciones para ahorro de batería
  batterySavingMode: z.boolean().optional(),
  highAccuracyMode: z.boolean().optional(),
  batteryLowThreshold: z.number().optional(),
  batteryLowUpdateInterval: z.number().optional(),
  inactiveTimeThreshold: z.number().optional(),
  motionDetectionEnabled: z.boolean().optional(),
  minimumMovementDistance: z.number().optional()
});

// server/storage.ts
import { eq, desc } from "drizzle-orm";

// server/db.ts
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
neonConfig.webSocketConstructor = ws;
if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?"
  );
}
var pool = new Pool({ connectionString: process.env.DATABASE_URL });
var db = drizzle({ client: pool, schema: schema_exports });

// server/storage.ts
var DatabaseStorage = class {
  // Gestión de trabajadores
  async getWorker(id) {
    const result = await db.select().from(workers).where(eq(workers.id, id));
    return result[0];
  }
  async getWorkerByUsername(username) {
    const result = await db.select().from(workers).where(eq(workers.username, username));
    return result[0];
  }
  async createWorker(insertWorker) {
    const result = await db.insert(workers).values(insertWorker).returning();
    return result[0];
  }
  async getAllWorkers() {
    return await db.select().from(workers);
  }
  async updateWorkerOnlineStatus(id, isOnline) {
    const now = /* @__PURE__ */ new Date();
    const result = await db.update(workers).set({
      isOnline,
      lastSeen: now
    }).where(eq(workers.id, id)).returning();
    return result[0];
  }
  async updateWorkerLocation(id, location) {
    const now = /* @__PURE__ */ new Date();
    const result = await db.update(workers).set({
      latitude: location.latitude,
      longitude: location.longitude,
      locationLastUpdated: now
    }).where(eq(workers.id, id)).returning();
    return result[0];
  }
  async getOnlineWorkers() {
    return await db.select().from(workers).where(eq(workers.isOnline, true));
  }
  async validateWorker(username, password, deviceId) {
    const worker = await this.getWorkerByUsername(username);
    if (!worker || worker.password !== password) return void 0;
    if (deviceId && worker.deviceId !== deviceId) {
      await db.update(workers).set({ deviceId }).where(eq(workers.id, worker.id));
      worker.deviceId = deviceId;
    }
    return worker;
  }
  // Gestión de registros de actividad
  async createActivityRecord(workerId, record) {
    const result = await db.insert(activityRecords).values({
      workerId,
      type: record.type,
      latitude: record.latitude,
      longitude: record.longitude,
      metadata: record.metadata
    }).returning();
    return result[0];
  }
  async getWorkerActivityRecords(workerId) {
    return await db.select().from(activityRecords).where(eq(activityRecords.workerId, workerId)).orderBy(desc(activityRecords.timestamp));
  }
  async getUnsentActivityRecords() {
    return await db.select().from(activityRecords).where(eq(activityRecords.sentToServer, false)).orderBy(desc(activityRecords.timestamp));
  }
  async markActivityRecordAsSent(id) {
    const result = await db.update(activityRecords).set({ sentToServer: true }).where(eq(activityRecords.id, id)).returning();
    return result[0];
  }
  // Gestión de configuración
  async getAppSettings() {
    const result = await db.select().from(appSettings).limit(1);
    return result[0];
  }
  async updateAppSettings(settings) {
    const existing = await this.getAppSettings();
    if (existing) {
      const result = await db.update(appSettings).set({
        ...settings,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq(appSettings.id, existing.id)).returning();
      return result[0];
    } else {
      const result = await db.insert(appSettings).values({
        locationUpdateInterval: settings.locationUpdateInterval || 5,
        keepAliveInterval: settings.keepAliveInterval || 15,
        apiEndpoint: settings.apiEndpoint
      }).returning();
      return result[0];
    }
  }
};
var storage = new DatabaseStorage();

// server/routes.ts
import { WebSocketServer, WebSocket } from "ws";
import { z as z2 } from "zod";
import session from "express-session";
import MemoryStore from "memorystore";
var clients = /* @__PURE__ */ new Map();
function broadcastLocations() {
  storage.getOnlineWorkers().then((workers2) => {
    const locationData = workers2.map((worker) => ({
      id: worker.id,
      name: worker.name,
      username: worker.username,
      isOnline: worker.isOnline,
      lastSeen: worker.lastSeen,
      latitude: worker.latitude,
      longitude: worker.longitude,
      locationLastUpdated: worker.locationLastUpdated
    }));
    clients.forEach((client, workerId) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "locations",
          data: locationData
        }));
      }
    });
  });
}
async function registerRoutes(app2) {
  const SessionStore = MemoryStore(session);
  app2.use(session({
    secret: "location-tracker-secret",
    resave: false,
    saveUninitialized: false,
    store: new SessionStore({
      checkPeriod: 864e5
      // 24 hours
    }),
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 864e5
      // 24 hours
    }
  }));
  app2.post("/api/auth/register", async (req, res) => {
    try {
      const workerData = insertWorkerSchema.parse(req.body);
      const existingWorker = await storage.getWorkerByUsername(workerData.username);
      if (existingWorker) {
        return res.status(400).json({ message: "El nombre de usuario ya existe" });
      }
      const newWorker = await storage.createWorker(workerData);
      const { password, ...workerWithoutPassword } = newWorker;
      req.session.workerId = newWorker.id;
      res.status(201).json(workerWithoutPassword);
    } catch (error) {
      if (error instanceof z2.ZodError) {
        return res.status(400).json({ message: error.errors });
      }
      res.status(500).json({ message: "Error del servidor" });
    }
  });
  app2.post("/api/auth/login", async (req, res) => {
    try {
      const loginData = loginSchema.parse(req.body);
      const worker = await storage.validateWorker(
        loginData.username,
        loginData.password,
        loginData.deviceId
      );
      if (!worker) {
        return res.status(401).json({ message: "Credenciales inv\xE1lidas" });
      }
      await storage.updateWorkerOnlineStatus(worker.id, true);
      req.session.workerId = worker.id;
      if (loginData.deviceId) {
        await storage.createActivityRecord(worker.id, {
          type: "CHECK_IN",
          latitude: worker.latitude || 0,
          longitude: worker.longitude || 0,
          metadata: {
            deviceId: loginData.deviceId,
            event: "LOGIN"
          }
        });
      }
      const { password, ...workerWithoutPassword } = worker;
      res.json({
        ...workerWithoutPassword,
        message: "Inicio de sesi\xF3n exitoso"
      });
    } catch (error) {
      if (error instanceof z2.ZodError) {
        return res.status(400).json({ message: error.errors });
      }
      res.status(500).json({ message: "Error del servidor" });
    }
  });
  app2.post("/api/auth/logout", (req, res) => {
    const workerId = req.session.workerId;
    if (workerId) {
      storage.updateWorkerOnlineStatus(workerId, false);
      const client = clients.get(workerId);
      if (client && client.readyState === WebSocket.OPEN) {
        client.close();
      }
      clients.delete(workerId);
    }
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ message: "Error al cerrar sesi\xF3n" });
      }
      res.json({ message: "Sesi\xF3n cerrada exitosamente" });
    });
  });
  app2.get("/api/auth/me", async (req, res) => {
    const workerId = req.session.workerId;
    if (!workerId) {
      return res.status(401).json({ message: "No autenticado" });
    }
    const worker = await storage.getWorker(workerId);
    if (!worker) {
      return res.status(404).json({ message: "Trabajador no encontrado" });
    }
    const { password, ...workerWithoutPassword } = worker;
    res.json(workerWithoutPassword);
  });
  app2.get("/api/workers", async (req, res) => {
    try {
      const workers2 = await storage.getAllWorkers();
      const sanitizedWorkers = workers2.map((worker) => {
        const { password, ...workerWithoutPassword } = worker;
        return workerWithoutPassword;
      });
      res.json(sanitizedWorkers);
    } catch (error) {
      res.status(500).json({ message: "Error del servidor" });
    }
  });
  app2.post("/api/activity", async (req, res) => {
    const workerId = req.session.workerId;
    if (!workerId) {
      return res.status(401).json({ message: "No autenticado" });
    }
    try {
      const activityData = createActivityRecordSchema.parse(req.body);
      await storage.updateWorkerLocation(workerId, {
        latitude: activityData.latitude,
        longitude: activityData.longitude
      });
      const record = await storage.createActivityRecord(workerId, activityData);
      broadcastLocations();
      res.status(201).json(record);
    } catch (error) {
      if (error instanceof z2.ZodError) {
        return res.status(400).json({ message: error.errors });
      }
      res.status(500).json({ message: "Error del servidor" });
    }
  });
  app2.get("/api/activity", async (req, res) => {
    const workerId = req.session.workerId;
    if (!workerId) {
      return res.status(401).json({ message: "No autenticado" });
    }
    try {
      const records = await storage.getWorkerActivityRecords(workerId);
      res.json(records);
    } catch (error) {
      res.status(500).json({ message: "Error del servidor" });
    }
  });
  app2.post("/api/location", async (req, res) => {
    const workerId = req.session.workerId;
    if (!workerId) {
      return res.status(401).json({ message: "No autenticado" });
    }
    try {
      const locationData = updateLocationSchema.parse(req.body);
      const updatedWorker = await storage.updateWorkerLocation(workerId, locationData);
      if (!updatedWorker) {
        return res.status(404).json({ message: "Trabajador no encontrado" });
      }
      broadcastLocations();
      const { password, ...workerWithoutPassword } = updatedWorker;
      res.json(workerWithoutPassword);
    } catch (error) {
      if (error instanceof z2.ZodError) {
        return res.status(400).json({ message: error.errors });
      }
      res.status(500).json({ message: "Error del servidor" });
    }
  });
  app2.get("/api/settings", async (req, res) => {
    try {
      const settings = await storage.getAppSettings();
      res.json(settings || {});
    } catch (error) {
      res.status(500).json({ message: "Error del servidor" });
    }
  });
  app2.put("/api/settings", async (req, res) => {
    try {
      const settingsData = updateSettingsSchema.parse(req.body);
      const updated = await storage.updateAppSettings(settingsData);
      res.json(updated);
      console.log("Configuraci\xF3n actualizada:", settingsData);
    } catch (error) {
      if (error instanceof z2.ZodError) {
        return res.status(400).json({ message: error.errors });
      }
      res.status(500).json({ message: "Error del servidor" });
    }
  });
  if (process.env.NODE_ENV === "development") {
    console.log("Creando trabajadores de ejemplo para desarrollo...");
    const sampleWorkers = [
      { username: "carlos", password: "password123", name: "Carlos Rodr\xEDguez", role: "worker" },
      { username: "miguel", password: "password123", name: "Miguel Hern\xE1ndez", role: "supervisor" },
      { username: "laura", password: "password123", name: "Laura Fern\xE1ndez", role: "admin" }
    ];
    try {
      for (const worker of sampleWorkers) {
        const existingWorker = await storage.getWorkerByUsername(worker.username);
        if (!existingWorker) {
          const newWorker = await storage.createWorker(worker);
          console.log(`Trabajador creado: ${worker.name}`);
          const madrid = { lat: 40.416775, lng: -3.70379 };
          const randomOffset = () => (Math.random() - 0.5) * 0.05;
          await storage.updateWorkerLocation(newWorker.id, {
            latitude: madrid.lat + randomOffset(),
            longitude: madrid.lng + randomOffset()
          });
          if (worker.username === "laura") {
            await storage.updateWorkerOnlineStatus(newWorker.id, false);
          }
          if (worker.username === "carlos") {
            await storage.createActivityRecord(newWorker.id, {
              type: "CHECK_IN",
              latitude: madrid.lat + randomOffset(),
              longitude: madrid.lng + randomOffset(),
              metadata: { deviceId: "test-device-001", event: "TEST_CHECKIN" }
            });
            await storage.createActivityRecord(newWorker.id, {
              type: "LOCATION_UPDATE",
              latitude: madrid.lat + randomOffset(),
              longitude: madrid.lng + randomOffset(),
              metadata: { deviceId: "test-device-001", battery: 85 }
            });
          }
        }
      }
      const existingSettings = await storage.getAppSettings();
      if (!existingSettings) {
        await storage.updateAppSettings({
          locationUpdateInterval: 5,
          keepAliveInterval: 15,
          apiEndpoint: "https://api.example.com/tracking",
          batterySavingMode: false,
          highAccuracyMode: true,
          batteryLowThreshold: 20,
          batteryLowUpdateInterval: 15,
          inactiveTimeThreshold: 30,
          motionDetectionEnabled: true,
          minimumMovementDistance: 10
        });
        console.log("Configuraci\xF3n inicial creada");
      }
    } catch (error) {
      console.error("Error al crear datos de ejemplo:", error);
    }
  }
  const httpServer = createServer(app2);
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    verifyClient: () => true
    // Desactivar verificación para entorno de desarrollo
  });
  wss.on("connection", (ws2) => {
    let workerId = null;
    ws2.on("message", async (message) => {
      try {
        const parsedMessage = JSON.parse(message.toString());
        if (parsedMessage.type === "auth") {
          workerId = parsedMessage.workerId;
          if (workerId) {
            const worker = await storage.getWorker(workerId);
            if (worker) {
              clients.set(workerId, ws2);
              await storage.updateWorkerOnlineStatus(workerId, true);
              broadcastLocations();
              ws2.send(JSON.stringify({
                type: "auth_success",
                data: { workerId }
              }));
            }
          }
        } else if (parsedMessage.type === "location" && workerId) {
          const locationData = {
            latitude: parsedMessage.latitude,
            longitude: parsedMessage.longitude
          };
          await storage.updateWorkerLocation(workerId, locationData);
          await storage.createActivityRecord(workerId, {
            type: "LOCATION_UPDATE",
            latitude: locationData.latitude,
            longitude: locationData.longitude,
            metadata: parsedMessage.metadata || {}
          });
          broadcastLocations();
          ws2.send(JSON.stringify({
            type: "location_updated",
            data: { timestamp: (/* @__PURE__ */ new Date()).toISOString() }
          }));
        } else if (parsedMessage.type === "check_in" && workerId) {
          await storage.createActivityRecord(workerId, {
            type: "CHECK_IN",
            latitude: parsedMessage.latitude,
            longitude: parsedMessage.longitude,
            metadata: parsedMessage.metadata || {}
          });
          await storage.updateWorkerLocation(workerId, {
            latitude: parsedMessage.latitude,
            longitude: parsedMessage.longitude
          });
          broadcastLocations();
          ws2.send(JSON.stringify({
            type: "check_in_recorded",
            data: { timestamp: (/* @__PURE__ */ new Date()).toISOString() }
          }));
        } else if (parsedMessage.type === "check_out" && workerId) {
          await storage.createActivityRecord(workerId, {
            type: "CHECK_OUT",
            latitude: parsedMessage.latitude,
            longitude: parsedMessage.longitude,
            metadata: parsedMessage.metadata || {}
          });
          await storage.updateWorkerLocation(workerId, {
            latitude: parsedMessage.latitude,
            longitude: parsedMessage.longitude
          });
          broadcastLocations();
          ws2.send(JSON.stringify({
            type: "check_out_recorded",
            data: { timestamp: (/* @__PURE__ */ new Date()).toISOString() }
          }));
        }
      } catch (error) {
        console.error("Error de mensaje WebSocket:", error);
        try {
          ws2.send(JSON.stringify({
            type: "error",
            data: { message: "Error procesando mensaje" }
          }));
        } catch (e) {
          console.error("Error enviando mensaje de error:", e);
        }
      }
    });
    ws2.on("close", async () => {
      if (workerId) {
        await storage.updateWorkerOnlineStatus(workerId, false);
        clients.delete(workerId);
        broadcastLocations();
      }
    });
  });
  return httpServer;
}

// server/vite.ts
import express from "express";
import fs from "fs";
import path2 from "path";
import { createServer as createViteServer, createLogger } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default = defineConfig({
  plugins: [
    react(),
    runtimeErrorOverlay(),
    ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
      await import("@replit/vite-plugin-cartographer").then(
        (m) => m.cartographer()
      )
    ] : []
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  }
});

// server/vite.ts
import { nanoid } from "nanoid";
var viteLogger = createLogger();
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
async function setupVite(app2, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        process.exit(1);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app2) {
  const distPath = path2.resolve(import.meta.dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/index.ts
var app = express2();
app.use(express2.json());
app.use(express2.urlencoded({ extended: false }));
app.use((req, res, next) => {
  const start = Date.now();
  const path3 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path3.startsWith("/api")) {
      let logLine = `${req.method} ${path3} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "\u2026";
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  const server = await registerRoutes(app);
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    res.status(status).json({ message });
    throw err;
  });
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const port = 5e3;
  server.listen({
    port,
    host: "0.0.0.0",
    reusePort: true
  }, () => {
    log(`serving on port ${port}`);
  });
})();
