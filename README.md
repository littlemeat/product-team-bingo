# Product Team Bingo

Bingo karta pro produktové meetingy. Klikej na políčka, jak je tvůj šéf vyslovuje. Když máš v řadě / sloupci / diagonále všechno → BINGO. 🎉

**Live:** https://littlemeat.github.io/product-team-bingo/

Dva režimy:

- **Multiplayer** (default, `index.html`) — vytvoříš hru, pošleš odkaz kolegům, každý hraje na své kartě, kdo první bingne ten vyhrál a všichni to vidí. Vyžaduje online (Supabase).
- **Sólo** (`solo.html`) — stará offline verze, funguje i přes `file://`. Stav v localStorage.

## Hraní (multiplayer)

1. Otevři [`index.html`](index.html). Vyber velikost (3×3 / 4×4 / 5×5) a klikni **Vytvořit hru**.
2. Klikni na žlutý pill `KÓD: xxxxxx 📋` v horní liště — odkaz se zkopíruje, pošli ho ostatním.
3. Každý si zadá přezdívku — dostane unikátní kartu s náhodným výběrem frází.
4. Klikej na políčka. Stav se ukládá průběžně do DB i lokálně.
5. Kdo první udělá bingo (řada, sloupec, diagonála), vyhrál — všichni vidí banner `🎉 [jméno] WON 🎉`.

Po vyhrání se karta uzamkne pro všechny hráče a banner zůstane přes obrazovku. Tlačítko **← Zpět** v horní liště je nad bannerem dostupné — odejdeš zpátky na landing. Refresh prohlížeče stav zachová (player_id + označení).

> ⚠️ Identita hráče se ukládá do `localStorage` podle `short_code`. Dva taby ve stejném prohlížeči na stejnou hru tedy budou vidět **stejnou kartu** (stejný hráč ve dvou tabech). Pro testování dvou hráčů použij dvě zařízení nebo inkognito okno.

## Hraní (sólo offline)

Otevři [`solo.html`](solo.html) v prohlížeči — žádný server, žádné dependencies, žádný Supabase. Vše v localStorage.

## Editace frází

Otevři [Supabase Studio → Table editor → `phrases`](https://supabase.com/dashboard/project/zrtelsojvbkuugtbhsvl/editor) a edituj řádky. Změna se projeví okamžitě v nově vytvořených hrách (existující karty mají snapshot phrase_id, takže se nemění uprostřed hry).

- Pole `is_active` můžeš nastavit na `false` místo mazání — fráze zmizí z poolu, ale historické hry zůstávají platné.
- Pole `text` má unique constraint, takže duplicity nelze vytvořit.

Sólo mód má vlastní pool v [`phrases.js`](phrases.js) (editace = úprava souboru a `git push`).

## Architektura

- **Frontend:** vanilla HTML/CSS/JS, žádný build, deployne se přímo na GitHub Pages.
- **Backend:** Supabase (Postgres + Realtime + RLS), projekt `zrtelsojvbkuugtbhsvl`.
- **Auth:** anonymní (přezdívky), bez login flow.
- **Realtime:** klienti subscribují na změny `games.winner_player_id`. Při výpadku WebSocketu fallback 5s polling.

### Schéma

- `phrases` — pool frází (text, is_active).
- `games` — `short_code`, `size`, `winner_player_id`, `ended_at`. Změny publikované přes `supabase_realtime`.
- `players` — `game_id`, `nickname`, `card_phrase_ids` (snapshot karty).
- `marks` — `player_id`, `position`. UNIQUE (player_id, position).

RLS: anon má SELECT na všechno + INSERT na games/players/marks. UPDATE/DELETE jenom přes `SECURITY DEFINER` RPCs:

- `create_game(size)` → vrací `short_code`.
- `join_game(short_code, nickname)` → atomicky vytvoří hráče, namíchá kartu (s FREE středem pro 3×3 / 5×5), vrátí JSON s kartou.
- `claim_win(game_id, player_id)` → atomicky CAS na `winner_player_id IS NULL` → vrací `true` jen tomu, kdo vyhrál první.

## Setup (Supabase)

CLI je už nakonfigurované, projekt linkovaný. Pro čerstvý setup:

```sh
supabase link --project-ref zrtelsojvbkuugtbhsvl
supabase db push
```

Migrace v [`supabase/migrations/`](supabase/migrations/) aplikují v pořadí: schéma → RLS → RPCs → realtime publication → seed phrases.

Realtime publication na `games` se zapíná v migraci `*_realtime.sql` (`alter publication supabase_realtime add table games;`). Pokud bys to chtěl ručně: Studio → Database → Replication → toggle `games`.

### Přidání další fráze přes migraci (volitelné)

Místo Studio UI:

```sh
supabase migration new add_phrase
# přidat: insert into phrases (text) values ('nová věta') on conflict (text) do nothing;
supabase db push
```

## Konfigurace

V [`config.js`](config.js) je `SUPABASE_URL` a `SUPABASE_PUBLISHABLE_KEY` natvrdo. **Publishable key je bezpečně committable** do veřejného repa — je to nový formát `sb_publishable_...`, který je explicitně určený pro frontend a žádnou autoritu sám o sobě neuděluje. Veškerá bezpečnost je v RLS politikách a RPC funkcích na backendu.

Kdyby tě to znervózňovalo: vyzkoušej si v terminálu, že přímý PATCH na `phrases` nebo `games` s tímto klíčem nic neudělá:

```sh
curl -X PATCH \
  'https://zrtelsojvbkuugtbhsvl.supabase.co/rest/v1/games?short_code=eq.xxxxxx' \
  -H "apikey: sb_publishable_31GnVukn18yPC2G_eOW6CA_jXoMeMIf" \
  -H "Authorization: Bearer sb_publishable_31GnVukn18yPC2G_eOW6CA_jXoMeMIf" \
  -H "Content-Type: application/json" \
  -d '{"winner_player_id": null}'
# → [] (žádný řádek neupraven)
```

## Lokální spuštění

Sólo mode: stačí otevřít [`solo.html`](solo.html) v prohlížeči.

Multiplayer potřebuje servírovat z HTTP (kvůli ES modules a fetch ke Supabase):

```sh
python3 -m http.server 8765
# pak otevři http://localhost:8765/
```

## Deployment (GitHub Pages)

Repo má workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml). Po pushi na `main` se obsah automaticky deployne. Žádný build step.

První setup (jenom poprvé): Settings → Pages → Source: GitHub Actions.

## Stack

Vanilla HTML + CSS + JS (ES modules). Žádné dependencies, žádný build. Supabase JS client se importuje přímo z `https://esm.sh/@supabase/supabase-js@2` v runtime.

## Files

```
index.html         — multiplayer SPA (landing + game)
app.js             — multiplayer logika (routing, join, marks, realtime, win)
solo.html          — sólo offline bingo
solo.js            — sólo logika (původní vanilla, nedotčená)
phrases.js         — pool frází pro sólo mode (multiplayer používá DB)
config.js          — Supabase URL + publishable key
supabase-client.js — Supabase JS client init
styles.css         — Memphis / Y2K styling pro oba módy
supabase/migrations/ — schéma, RLS, RPCs, realtime, seed
.github/workflows/deploy.yml — GitHub Pages deploy
```
