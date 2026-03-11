const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// Token che hai impostato su Meta Dashboard
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "menoo_test";

// Parse JSON body (per i messaggi POST da Meta)
app.use(express.json());

// ============================================
// HEALTH CHECK - per verificare che il server funziona
// ============================================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "WhatsApp Webhook Test",
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// GET /webhook - VERIFICA del webhook da Meta
// ============================================
// Quando clicchi "Verifica e salva" su Meta Dashboard,
// Meta invia una GET con hub.mode, hub.verify_token e hub.challenge.
// Se il token corrisponde, restituisci hub.challenge come testo semplice.
// ============================================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("=== VERIFICA WEBHOOK ===");
  console.log("hub.mode:", mode);
  console.log("hub.verify_token:", token ? "***fornito***" : "***mancante***");
  console.log("hub.challenge:", challenge);

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("VERIFICA OK!");
    // IMPORTANTE: restituire SOLO la challenge come testo semplice
    return res.status(200).send(challenge);
  }

  console.log("VERIFICA FALLITA - token non corrisponde");
  return res.status(403).send("Forbidden");
});

// ============================================
// POST /webhook - RICEZIONE messaggi da Meta
// ============================================
// Dopo la verifica, Meta invia qui i messaggi dei clienti.
// ============================================
app.post("/webhook", (req, res) => {
  const body = req.body;

  console.log("=== MESSAGGIO RICEVUTO ===");
  console.log(JSON.stringify(body, null, 2));

  if (body.object !== "whatsapp_business_account") {
    return res.status(404).send("Not Found");
  }

  // Processa ogni messaggio
  if (body.entry) {
    body.entry.forEach((entry) => {
      entry.changes?.forEach((change) => {
        const value = change.value;

        // Messaggi in arrivo
        if (value?.messages) {
          value.messages.forEach((message) => {
            const from = message.from;
            const type = message.type;
            const contactName =
              value.contacts?.[0]?.profile?.name || "Sconosciuto";

            console.log("--- NUOVO MESSAGGIO ---");
            console.log("Da:", from, "(", contactName, ")");
            console.log("Tipo:", type);

            if (type === "text") {
              console.log("Testo:", message.text?.body);
            } else if (type === "image") {
              console.log("Immagine ID:", message.image?.id);
            } else if (type === "button") {
              console.log("Bottone:", message.button?.text);
            }
          });
        }

        // Status updates (sent, delivered, read)
        if (value?.statuses) {
          value.statuses.forEach((status) => {
            console.log("--- STATUS UPDATE ---");
            console.log("Messaggio:", status.id, "->", status.status);
          });
        }
      });
    });
  }

  // IMPORTANTE: rispondere SEMPRE 200 OK a Meta
  return res.status(200).send("OK");
});

// Avvia il server
app.listen(PORT, () => {
  console.log(`Webhook server attivo sulla porta ${PORT}`);
  console.log(`Verify token: ${VERIFY_TOKEN}`);
});
