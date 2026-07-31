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
- `marks` — `player_id`, `position`, `phrase_id`. UNIQUE (player_id, position).
- `keepalive` — jednořádková tabulka jen pro keepalive cron, viz [Udržení projektu vzhůru](#udržení-projektu-vzhůru).

`marks.phrase_id` je denormalizace: pozice sama by vyžadovala join zpátky na `players.card_phrase_ids[position+1]`, aby se zjistilo, *která fráze* byla označená. Sloupec je `NOT NULL`, frontend ho posílá při každém insertu.

RLS: anon má SELECT na všechno + INSERT na games/players/marks. UPDATE/DELETE jenom přes `SECURITY DEFINER` RPCs:

- `create_game(size)` → vrací `short_code`.
- `join_game(short_code, nickname)` → atomicky vytvoří hráče, namíchá kartu (s FREE středem pro 3×3 / 5×5), vrátí JSON s kartou.
- `claim_win(game_id, player_id)` → atomicky CAS na `winner_player_id IS NULL` → vrací `true` jen tomu, kdo vyhrál první.
- `get_phrase_stats(p_window_games int default 10)` → statistika per fráze za posledních N *odehraných* her (= hra s aspoň jedním markem). Vrací `shown_count`, `marked_count`, `mark_rate_pct`, `last_shown_at`, `last_marked_at`. **UI pro tohle neexistuje** — je to backend příprava pro budoucí admin panel. Zavoláš to buď z JS (`supabase.rpc('get_phrase_stats', { p_window_games: 10 })`) nebo ze Studio SQL editoru:

  ```sql
  select text, shown_count, marked_count, mark_rate_pct
  from get_phrase_stats(10)
  order by mark_rate_pct desc;
  ```
- `keepalive_ping()` → updatne `keepalive.last_ping`, vrací nový timestamp. Volá ho jenom cron.

## Setup (Supabase)

CLI je už nakonfigurované, projekt linkovaný. Pro čerstvý setup:

```sh
supabase link --project-ref zrtelsojvbkuugtbhsvl
supabase db push
```

Migrace v [`supabase/migrations/`](supabase/migrations/) aplikují v tomto pořadí:

| Migrace | Co dělá |
|---|---|
| `*_core_tables` | `phrases`, `games`, `players`, `marks` + indexy |
| `*_rls_policies` | RLS on, SELECT/INSERT policies pro anon |
| `*_rpcs` | `create_game`, `join_game`, `claim_win` + granty |
| `*_realtime` | `alter publication supabase_realtime add table games` |
| `*_seed_phrases` | 46 frází, idempotentní (`on conflict do nothing`) |
| `*_marks_phrase_id` | přidá `marks.phrase_id`, backfillne historii, `NOT NULL` |
| `*_phrase_stats_rpc` | `get_phrase_stats()` |
| `*_forward_compat_grants` | explicitní GRANTy — viz níž |
| `*_keepalive` | `keepalive` tabulka + `keepalive_ping()` RPC |

Realtime publication na `games` se zapíná v migraci `*_realtime.sql`. Pokud bys to chtěl ručně: Studio → Database → Replication → toggle `games`.

### Explicitní GRANTy (Supabase změna k 30. 10. 2026)

Supabase mění default: po **30. říjnu 2026** nebudou nové tabulky v `public` schématu automaticky dostupné přes Data API — budou potřebovat explicitní `GRANT`. Existující tabulky téhle DB si starý default drží, ale migrace `*_forward_compat_grants.sql` je grantuje explicitně, aby bylo schéma samostatné a přenositelné.

**Praktický dopad:** když po tom datu přidáš novou tabulku, musíš k ní přidat `grant select[, insert] on <tabulka> to anon, authenticated;`, jinak ji frontend přes supabase-js neuvidí (a chyba bude vypadat jako „tabulka neexistuje").

## Udržení projektu vzhůru

Projekt běží na **Supabase free tier**, který pausne DB po ~7 dnech „bez dostatečné aktivity". Tohle je nejčastější důvod, proč appka najednou nefunguje.

**Co se počítá jako aktivita:** zápis do databáze a práce v dashboardu. **Co se nepočítá:** anonymní čtení přes REST. To jsme si ověřili tvrdě — první pokus o keepalive posílal jen `GET` pingy 2× týdně, pingy vracely HTTP 200 a projekt přesto zaspal. (Navíc pak každý další cron run failoval, protože pauznutý projekt přestane resolvovat DNS, a chodily failure notifikace z GitHubu.)

**Aktuální řešení:** [`.github/workflows/keep-supabase-warm.yml`](.github/workflows/keep-supabase-warm.yml) — denní cron (07:00 UTC), který volá `keepalive_ping()` RPC, tedy dělá skutečný **zápis**. Workflow má i `workflow_dispatch`, takže se dá spustit ručně z Actions tabu.

Workflow navíc řeší druhou past: **GitHub vypíná scheduled workflows v repech bez commitů po 60 dnech.** Když je poslední commit starší než 21 dní, workflow pushne prázdný commit, aby cron zůstal živý. (Ten commit spustí no-op Pages rebuild, což nevadí.)

### Když projekt přece jen zaspí

Cron **neumí probudit už pauznutý projekt** — subdoména nefunguje, není koho pingnout. Jediná cesta je ruční resume:

1. [Supabase dashboard → projekt `zrtelsojvbkuugtbhsvl`](https://supabase.com/dashboard/project/zrtelsojvbkuugtbhsvl) → **Resume**.
2. Počkat ~30 s, než se DB nastartuje.
3. Data zůstávají — resume je možný do 90 dnů od pauzy. Po 90 dnech už jen export dat, projekt se neobnoví.

Frontend tenhle stav detekuje (`isProjectPausedError` v [`app.js`](app.js)) a místo generické chyby zobrazí hlášku, že DB spí a je potřeba ji probudit v dashboardu.

### Kdyby to pořád nestačilo

Pokud i s denním write-pingem začnou chodit „project is going to be paused" emaily, zbývají dvě cesty:

- **Supabase Pro** — $25/měsíc **per organizace** (ne per projekt), zahrnuje $10 compute kreditů, což pokryje jeden Micro instance. Projekty na Pro se nepausují nikdy.
- **Migrace na jiný provider** — např. Neon má scale-to-zero s automatickým probuzením do ~1 s, bez ručního resume. Postgres + RLS by fungovaly, ale **přišlo by se o Supabase Realtime** — musel by se nahradit pollingem (jednoduché, fallback už v kódu je) nebo externí službou (Ably/Pusher).

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
supabase/migrations/ — schéma, RLS, RPCs, realtime, seed, stats, granty, keepalive
.github/workflows/deploy.yml            — GitHub Pages deploy (push na main)
.github/workflows/keep-supabase-warm.yml — denní write-ping proti free-tier pauze
```

## Přístupy a provoz

Co je potřeba mít, aby se dala appka udržovat:

| Věc | Kde | K čemu |
|---|---|---|
| GitHub repo | [`littlemeat/product-team-bingo`](https://github.com/littlemeat/product-team-bingo) (public) | kód, deploy, keepalive cron |
| Supabase projekt | `zrtelsojvbkuugtbhsvl`, organizace **HSDC** | DB, fráze, resume při pauze |

Obojí je vázané na jeden účet. **Při předání projektu je potřeba přidat dalšího člověka do obou** — jinak nikdo nemůže probudit pauznutou DB ani editovat fráze:

- GitHub: Settings → Collaborators → Add people (nebo repo přesunout do organizace).
- Supabase: Organization settings → Team → Invite member (organizace HSDC).

Bez toho appka pojede jen dokud DB nezaspí — pak je to slepá ulička, protože resume vyžaduje dashboard přístup a data se po 90 dnech pauzy nedají obnovit.

## Co se nedodělalo (nápady na dál)

Vědomě odloženo, nic z toho nechybí pro hraní:

- **Admin UI pro fráze** — teď se edituje ve Supabase Studio. Chtělo by to jednoduchou stránku + login (magic link), aby fráze mohl přidávat kdokoli z týmu.
- **Stats UI** — backend hotový (`get_phrase_stats`), frontend ne. Nejlevnější další feature: tabulka „nejčastěji trefované fráze".
- **Moderation queue** — kdokoli navrhne frázi, admin schválí.
- **Auto-archivace** — fráze, které se dlouho netrefily, automaticky na `is_active = false`.
- Slack notifikace, zvuky, reakce.

Známá omezení (ne bugy):

- Dva taby ve stejném prohlížeči na stejnou hru = **jeden hráč**, ne dva (identita je v `localStorage` podle `short_code`). Pro test dvou hráčů použij inkognito nebo druhé zařízení.
- Sólo mód má 3×3 a 5×5, multiplayer navíc 4×4. Sólo pool frází v `phrases.js` je oddělený od DB a nesynchronizuje se.
