// Configurazione del sito Veritas: è l'unico file da modificare per i collegamenti esterni.
window.VERITAS_CONFIG = {
  // API del modello (backend/api.py).
  // Vuoto = modalità DEMO: il telefono usa risposte preregistrate, nessun server necessario.
  // In locale: "http://localhost:8000"  (oppure apri il sito con ?api=http://localhost:8000)
  apiBaseUrl: "https://routine-employers-method-nut.trycloudflare.com",
  requestTimeoutMs: 60000,
  defaultK: 3,
  maxClaimChars: 300,

  // Newsletter: endpoint del form Brevo già usato nella landing (doppio opt-in attivo su Brevo).
  newsletterAction:
    "https://f48ba791.sibforms.com/serve/MUIFACWD1PZ7QZ1mllnl6VMVRTbk_G3XJJxjAeJ1M3CtCbDSFQDiu8AAueIIAC5X912onXMGhhXIfswpyw7yVrAwR2KrAJRkOHIEimNLnbkynKwX3YxfL2BaAe2NiIXhCUa57LehwyygqbIyNOKfW2WeuooORfziyCGvPXYG71HDhXkZCtvPE_PuftzZEgW9KKXjkdAX4QwTARJiwg==",

  // Contatti e social. Se linkedinUrl è vuoto, il pulsante LinkedIn non viene mostrato.
  contactEmail: "veritas.infomail@gmail.com",
  linkedinUrl: "",
};
