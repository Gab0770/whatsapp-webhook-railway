const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 3000;

// ============================================
// CONFIGURAZIONE
// ============================================
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "menoo_test";
const WHATSAPP_API_TOKEN = process.env.WHATSAPP_API_TOKEN || "";
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID || "";
const WHATSAPP_API_URL = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

// ============================================
// STORAGE IN MEMORIA (per il prototipo)
// ============================================
// Struttura: { "393331234567": { name: "Mario", messages: [...] } }
const conversations = {};

function addMessage(from, contactName, message) {
  if (!conversations[from]) {
    conversations[from] = {
      name: contactName || from,
      messages: [],
    };
  }
  // Aggiorna il nome se disponibile
  if (contactName && contactName !== "Sconosciuto") {
    conversations[from].name = contactName;
  }
  conversations[from].messages.push(message);
  return conversations[from];
}

// ============================================
// MIDDLEWARE
// ============================================
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ============================================
// PAGINA PRINCIPALE - Dashboard Chat
// ============================================
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ============================================
// API - Lista conversazioni
// ============================================
app.get("/api/conversations", (req, res) => {
  const list = Object.entries(conversations).map(([phone, data]) => {
    const lastMsg = data.messages[data.messages.length - 1];
    return {
      phone,
      name: data.name,
      lastMessage: lastMsg?.text || lastMsg?.type || "",
      lastTimestamp: lastMsg?.timestamp || "",
      unread: data.messages.filter((m) => m.direction === "incoming" && !m.read)
        .length,
    };
  });
  // Ordina per ultimo messaggio (più recente prima)
  list.sort((a, b) => (b.lastTimestamp || "").localeCompare(a.lastTimestamp || ""));
  res.json(list);
});

// ============================================
// API - Messaggi di una conversazione
// ============================================
app.get("/api/conversations/:phone", (req, res) => {
  const conv = conversations[req.params.phone];
  if (!conv) {
    return res.status(404).json({ error: "Conversazione non trovata" });
  }
  // Segna come letti
  conv.messages.forEach((m) => {
    if (m.direction === "incoming") m.read = true;
  });
  res.json(conv);
});

// ============================================
// API - Invia messaggio WhatsApp
// ============================================
app.post("/api/send", async (req, res) => {
  const { to, text } = req.body;

  if (!to || !text) {
    return res.status(400).json({ error: "Servono 'to' e 'text'" });
  }

  if (!WHATSAPP_API_TOKEN || !PHONE_NUMBER_ID) {
    // Modalita' demo: salva il messaggio localmente senza inviarlo
    console.log("DEMO MODE: messaggio non inviato (token API non configurato)");
    const msg = {
      id: "demo_" + Date.now(),
      text,
      timestamp: new Date().toISOString(),
      direction: "outgoing",
      status: "demo",
    };
    addMessage(to, null, msg);
    io.emit("message:sent", { phone: to, message: msg });
    return res.json({ success: true, demo: true, message: msg });
  }

  try {
    const response = await axios.post(
      WHATSAPP_API_URL,
      {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${WHATSAPP_API_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    const msg = {
      id: response.data.messages?.[0]?.id || "msg_" + Date.now(),
      text,
      timestamp: new Date().toISOString(),
      direction: "outgoing",
      status: "sent",
    };

    addMessage(to, null, msg);
    io.emit("message:sent", { phone: to, message: msg });

    console.log("Messaggio inviato a", to, ":", text);
    res.json({ success: true, message: msg });
  } catch (error) {
    console.error(
      "Errore invio:",
      error.response?.data || error.message
    );
    res.status(500).json({
      error: "Errore nell'invio del messaggio",
      details: error.response?.data || error.message,
    });
  }
});

// ============================================
// GET /webhook - VERIFICA Meta
// ============================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("=== VERIFICA WEBHOOK ===");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("VERIFICA OK!");
    return res.status(200).send(challenge);
  }

  console.log("VERIFICA FALLITA");
  return res.status(403).send("Forbidden");
});

// ============================================
// POST /webhook - RICEZIONE messaggi da Meta
// ============================================
app.post("/webhook", (req, res) => {
  const body = req.body;

  if (body.object !== "whatsapp_business_account") {
    return res.status(404).send("Not Found");
  }

  if (body.entry) {
    body.entry.forEach((entry) => {
      entry.changes?.forEach((change) => {
        const value = change.value;

        // Messaggi in arrivo
        if (value?.messages) {
          value.messages.forEach((message) => {
            const from = message.from;
            const contactName =
              value.contacts?.[0]?.profile?.name || "Sconosciuto";

            let text = "";
            if (message.type === "text") {
              text = message.text?.body || "";
            } else if (message.type === "image") {
              text = "[Immagine]" + (message.image?.caption ? ": " + message.image.caption : "");
            } else if (message.type === "button") {
              text = message.button?.text || "[Bottone]";
            } else if (message.type === "location") {
              text = `[Posizione: ${message.location?.latitude}, ${message.location?.longitude}]`;
            } else {
              text = `[${message.type}]`;
            }

            const msg = {
              id: message.id,
              text,
              type: message.type,
              timestamp: new Date(
                parseInt(message.timestamp) * 1000
              ).toISOString(),
              direction: "incoming",
              read: false,
            };

            const conv = addMessage(from, contactName, msg);

            console.log(`Messaggio da ${contactName} (${from}): ${text}`);

            // Invia al frontend in tempo reale
            io.emit("message:received", {
              phone: from,
              name: contactName,
              message: msg,
            });
          });
        }

        // Status updates
        if (value?.statuses) {
          value.statuses.forEach((status) => {
            io.emit("message:status", {
              messageId: status.id,
              status: status.status,
              recipientId: status.recipient_id,
            });
            console.log(`Status: ${status.id} -> ${status.status}`);
          });
        }
      });
    });
  }

  return res.status(200).send("OK");
});

// ============================================
// WEBSOCKET
// ============================================
io.on("connection", (socket) => {
  console.log("Dashboard connessa:", socket.id);

  socket.on("disconnect", () => {
    console.log("Dashboard disconnessa:", socket.id);
  });
});

// ============================================
// AVVIO SERVER
// ============================================
server.listen(PORT, () => {
  console.log(`Server attivo sulla porta ${PORT}`);
  console.log(`Verify token: ${VERIFY_TOKEN}`);
  console.log(
    `WhatsApp API: ${WHATSAPP_API_TOKEN ? "configurato" : "NON configurato (demo mode)"}`
  );
  console.log(
    `Phone Number ID: ${PHONE_NUMBER_ID || "NON configurato"}`
  );
});
