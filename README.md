# Veritas — sito v2

```
veritas-site/
├── index.html        struttura: navbar, hero, progetto, numeri, prototipo, team, newsletter/sostienici, footer
├── styles.css        design (colori della landing, font ospitati in fonts/)
├── app.js            animazioni, telefono interattivo, newsletter, menu mobile
├── config.js         ← API, endpoint Brevo, email e LinkedIn: si cambia solo qui
├── mock-data.js      risposte del modello per la modalità demo
├── fonts/            Schibsted Grotesk + Newsreader (licenza OFL, nessuna chiamata a Google)
├── DESIGN-NOTES.md   regole di design da rispettare quando si aggiunge qualcosa
└── backend/          api.py + fact_checker.py (vedi sotto)
```

## Provarlo in locale

```bash
python -m http.server 5500
```
Apri http://localhost:5500. **Usa la porta 5500**: è quella che l'API accetta di default (CORS).

Con il modello vero (chi ha `fever_delivery/` completo in `backend/`):
```bash
cd backend && pip install -r requirements.txt && python api.py
```
poi apri http://localhost:5500/?api=http://localhost:8000 → il badge nel telefono passa a **Live**.

## Far testare il modello vero ai ragazzi (da remoto)

In modalità demo il sito conosce solo le frasi registrate: qualsiasi altra frase risponde
"demo senza modello collegato". Per provare frasi nuove serve il modello acceso e raggiungibile:

1. Chi ha i file del modello lancia l'API: `cd backend && python api.py`
2. Sullo stesso PC apre un tunnel pubblico gratuito (Cloudflare, senza account):
   `cloudflared tunnel --url http://localhost:8000` → stampa un indirizzo `https://….trycloudflare.com`
3. Quell'indirizzo va in `config.js` → `apiBaseUrl`, e il sito si pubblica su GitHub Pages
   (`https://techno804.github.io/…` è già tra le origini ammesse dall'API).
4. Il modello resta raggiungibile finché PC, `api.py` e tunnel restano accesi. L'indirizzo cambia
   a ogni riavvio del tunnel: va aggiornato in `config.js`.

L'anteprima su claude.ai non può collegarsi al modello (blocca le richieste verso altri siti):
per i test con il modello usate GitHub Pages o il server locale.

## Demo con risposte vere per tutti i post

`cd backend && python genera_demo.py` verifica con il modello tutte le frasi dei post e degli
esempi e riscrive `mock-data.js`. Dopo, la demo senza server mostra tutti e 6 i post con risultati reali
(oggi ne mostra 3, quelli con una risposta già registrata).

## Cose da completare

- **Foto del team**: in `index.html`, dentro ogni `.portrait`, sostituisci lo `<span>` con
  `<img src="img/nome.jpg" alt="" />`. Ruoli: ora sono tutti "Co-founder".
- **LinkedIn**: incolla l'URL in `config.js` → `linkedinUrl` (il pulsante compare da solo).
- **Mock**: in `mock-data.js` alcune frasi sono PLACEHOLDER: si sostituiscono tutte lanciando `genera_demo.py`.
- **Newsletter**: usa lo stesso form Brevo della landing. Prima di pubblicare, fai una prova
  con la tua email e controlla che arrivi la mail di conferma.

## Contratto API

`POST /api/check` con `{"claim": "...", "k": 3}` → `FactCheckResult` di `fact_checker.py`
(`predicted_label`, `confidence`, `evidence_used`, `evidence_scores`, `abstained`, `abstention_reason`).
Errori: `{"error": {"code", "message"}}` con 400 / 422 / 500. `GET /api/health` per lo stato.
Test senza modello: `cd backend && python test_api.py`.

## Fonti dei numeri

1. Vosoughi, Roy, Aral — Science, 2018 (doi:10.1126/science.aap9559)
2. Van Noorden — Nature, 2023 (d41586-023-03974-8)
3. Richardson et al. — PNAS, 2025 (doi:10.1073/pnas.2420092122): raddoppio ogni 1,5 anni;
   8.589 ritrattati su 29.956 articoli sospetti = 28,7%
4. Flash Eurobarometro del Parlamento europeo sui social media, 2025 (via data.europa.eu): 36%
5. World Economic Forum, Global Risks Report 2026: disinformazione al 2° posto a due anni
