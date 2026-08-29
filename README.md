# Projekt Makao

Przeglądarkowa gra **Makao** w czystym HTML, CSS i JavaScript. Można grać całkowicie offline przeciwko botom albo utworzyć prywatny stół **WebRTC P2P** dla 3–4 graczy, również w układzie mieszanym człowiek + boty.

## Tryby gry

### Offline

- 1 lokalny gracz + 2 albo 3 boty;
- bez backendu i bez połączenia z internetem;
- `makao-single.html` nadal można otworzyć bezpośrednio z dysku.

### Multiplayer P2P

- prywatne pokoje z krótkim kodem;
- 3 albo 4 miejsca przy stole;
- host jest jedynym właścicielem autorytatywnego stanu gry;
- goście wysyłają wyłącznie akcje, nigdy zmodyfikowany stan;
- host waliduje akcję tym samym silnikiem zasad co tryb offline;
- po zestawieniu połączenia ruchy idą przez niezawodny, uporządkowany WebRTC DataChannel;
- każdy gość dostaje przefiltrowany widok: własna ręka jest jawna, ręce przeciwników i kolejność talii pozostają ukryte;
- puste miejsca można przed startem zarezerwować dla istniejących botów; boty działają wyłącznie w przeglądarce hosta;
- utrata połączenia podczas partii wstrzymuje grę i pokazuje czytelny komunikat zamiast pozostawiać stół w niespójnym stanie.

Sygnalizacja WebRTC jest osobną, małą usługą Cloudflare Worker + Durable Object w katalogu `cloudflare-signaling/`. Nie zawiera zasad ani stanu partii. Instrukcja wdrożenia: [`DEPLOY_MULTIPLAYER.md`](DEPLOY_MULTIPLAYER.md).

## Uruchomienie

### Jeden plik — offline

Pobierz `makao-single.html` i otwórz go w przeglądarce. Tryb offline działa bez serwera. Multiplayer wymaga HTTPS i wdrożonej sygnalizacji `/api/`.

### Wersja deweloperska

```bash
python -m http.server 8080
```

Następnie otwórz `http://localhost:8080`.

## Ustalony wariant zasad

Podstawą są dwa źródła wskazane dla projektu:

- Wikipedia: https://pl.wikipedia.org/wiki/Makao_(gra_karciana)
- Morele.net: https://www.morele.net/wiadomosc/gra-karciana-makao-jak-grac-zasady-i-praktyczne-porady-gry-karcianej/18363/

Rozbieżności między regionalnymi wariantami są rozstrzygnięte przez kontrakt `rules/rules-contract.json`. Multiplayer nie ma osobnego silnika zasad — wszystkie lokalne i zdalne ruchy przechodzą przez tę samą warstwę gry.

Najważniejsze decyzje wariantu pozostają bez zmian: 52 karty bez jokerów, 5 kart na start, niefunkcyjna karta startowa, zagrania 1/3/4 kart tej samej wartości, „pierwsza karta ratuje”, kumulowane 2/3, blokady 4, Walet 5–10 lub „Nic”, żądanie koloru Asem, funkcje K♥/K♠, deklaracja MAKAO i dalsza gra o kolejne miejsca.

## Architektura multiplayera

```text
Cloudflare Worker / Durable Object
        │  tylko pokój + SDP
        │
  ┌─────┴─────┐
  │    HOST   │  autorytatywna symulacja + boty
  └───┬───┬───┘
      │   │
 WebRTC   WebRTC
      │   │
   Guest Guest
```

Host przydziela stabilne numery miejsc. Pakiet akcji nie może wskazać innego miejsca — miejsce wynika z połączenia peer. Stan wysyłany do gości jest filtrowany per miejsce; kolejność talii i cudze karty nie trafiają do przeglądarki gościa.

## Struktura

- `index.html` — ekran gry, menu i lobby multiplayera;
- `css/styles.css`, `css/ux-fixes.css` — główny interfejs;
- `css/multiplayer.css` — responsywne lobby i stany połączeń;
- `js/game.js` — autorytatywny stan, kolejki, efekty kart i wspólny dispatcher akcji;
- `js/multiplayer.js` — pokoje, miejsca, WebRTC, protokół wiadomości i filtrowanie stanu;
- `js/rules.js` — czysta walidacja zasad;
- `js/bot.js` — istniejąca AI używana offline i przez hosta w stole hybrydowym;
- `js/ui.js` — renderowanie z perspektywy lokalnego miejsca;
- `js/ux-effects.js` — wyłącznie efekty wizualne;
- `cloudflare-signaling/` — sygnalizacja WebRTC;
- `tests/multiplayer.test.js` — host authority, ukryte dane, routing i pełne gry hybrydowe;
- `tests/browser/multiplayer-ui.spec.js` — lobby desktop/tablet/telefon pionowo i poziomo;
- `makao-single.html` — automatycznie generowana wersja jednoplikowa.

## Testy

```bash
npm test
npm run check
npm run rules:audit
npm run stress -- 1000
npm run test:multiplayer
```

Test multiplayera sprawdza m.in. ukrywanie kart, brak kolejności talii u gościa, odrzucanie ruchów spoza tury/cudzą kartą/na miejscu bota, rezerwację miejsc oraz ukończenie pełnych 3- i 4-osobowych gier hybrydowych. Osobny workflow Playwright sprawdza lobby na 1440×900, 1024×768, 390×844 i 844×390.
