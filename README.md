# Product Team Bingo

Static HTML bingo card pro produktové meetingy. Klikej na políčka, jak je tvůj šéf vyslovuje. Když máš pět v řadě → BINGO. 🎉

## Hraní

Otevři `index.html` v prohlížeči (nebo nasazenou GitHub Pages adresu). Vyber velikost karty (3×3 / 4×4 / 5×5), klikej na políčka. Stav se pamatuje přes refresh (localStorage).

- **3×3** a **5×5** mají FREE políčko uprostřed (předznačené hvězdičkou).
- **4×4** má všech 16 políček s frázemi.
- Tlačítko **Nová karta** zamíchá nově (zachová velikost, smaže označení).

## Editace frází

Otevři [`phrases.js`](phrases.js), uprav pole `window.PHRASES`, commitni a pushni. Žádný build step není potřeba — GitHub Pages to deployne přímo. Drž počet frází na **min. 24**, aby fungovala 5×5 karta.

## Lokální spuštění

Stačí otevřít `index.html` v prohlížeči — žádný server, žádné dependencies.

```sh
open index.html
```

## Deployment (GitHub Pages)

Repo má workflow `.github/workflows/deploy.yml`. Po pushi na `main` se obsah automaticky deployne na Pages.

První setup: v Settings → Pages nastav **Source: GitHub Actions**.

## Stack

Vanilla HTML + CSS + JavaScript. Nula dependencies, nula build stepu, nula frameworků. Funguje i přes `file://`.

## Files

- `index.html` — markup
- `styles.css` — všechen styling (Memphis / Y2K vibe)
- `app.js` — logika (generování karty, označování, bingo detekce, persistence, konfety)
- `phrases.js` — pool frází (uprav tady)
