# Projekt Makao

Offline'owa gra **Makao** w czystym HTML, CSS i JavaScript. Rozgrywka: **1 człowiek + 2 albo 3 boty**, bez backendu i bez zewnętrznych bibliotek.

## Uruchomienie

### Jeden plik — bez instalacji

Pobierz tylko `makao-single.html` i otwórz go dwuklikiem w przeglądarce. Cały CSS i JavaScript są osadzone w tym jednym pliku, więc nie wymaga on lokalnego serwera ani pobierania pozostałych plików repozytorium.

### Wersja deweloperska

Pełną, modułową wersję projektu najprościej uruchomić przez dowolny lokalny serwer HTTP, np.:

```bash
python -m http.server 8080
```

Następnie otworzyć `http://localhost:8080`.

> Modułowy `index.html` używa ES Modules, dlatego dla tej wersji zalecany jest serwer HTTP. `makao-single.html` działa bezpośrednio przez `file://`.

## Ustalony wariant zasad

Podstawą są wyłącznie dwa źródła wskazane dla projektu:

- Wikipedia: https://pl.wikipedia.org/wiki/Makao_(gra_karciana)
- Morele.net: https://www.morele.net/wiadomosc/gra-karciana-makao-jak-grac-zasady-i-praktyczne-porady-gry-karcianej/18363/

Ponieważ oba teksty opisują regionalne warianty Makao, rozbieżności zostały rozstrzygnięte decyzjami autora projektu:

- 52 karty, bez jokerów;
- 1 gracz + 2 lub 3 boty;
- każdy dostaje 5 kart;
- karta startowa nie może być funkcyjna;
- podstawowe zagranie: ten sam kolor albo ta sama wartość;
- można wyłożyć **1, 3 lub 4** karty tej samej wartości; pary i schodki są wyłączone;
- działa zasada **„pierwsza karta ratuje”**;
- 2 i 3 nakładają kary dobierania; przy aktywnej karze wolno odpowiedzieć wyłącznie 2/3 pasującą **kolorem albo wartością** do karty na wierzchu;
- kary z kilku 2/3 sumują się według **łącznej liczby oczek** (np. trzy 2 = +6, trzy 3 = +9);
- 4 blokuje kolejkę, a kolejna 4 może przenieść i zwiększyć blokadę;
- walet żąda wartości 5–10, ale tylko takiej, którą zagrywający ma jeszcze w ręce; można też wybrać **„Nic”** i nie żądać żadnej wartości;
- dama działa według „dama na wszystko, wszystko na damę”, ale **nie przełamuje aktywnej kary, blokady ani żądania**;
- as żąda koloru dla następnego gracza;
- K♥: +5 kart dla następnego gracza, bez dodatkowej utraty tury;
- K♠: +5 kart dla poprzedniego gracza;
- K♣ i K♦ nie mają funkcji specjalnej;
- przy jednej karcie wymagana jest deklaracja **MAKAO**; brak deklaracji i STOP MAKAO = +5 kart;
- po zejściu pierwszej osoby pozostali grają dalej o 2., 3. i 4. miejsce;
- po wyczerpaniu talii stos odrzuconych jest tasowany ponownie z zachowaniem wierzchniej karty.

## Warstwa wizualna

UI jest adaptacją dostarczonego baseline'u SKAT: ciemny cyfrowy card-room, emeraldowy felt, ciepłe drewno, złoty akcent stanów, kremowe karty, Georgia dla elementów „stołowych”, systemowy sans-serif dla sterowania, tekstowe awatary i CSS-owe rewersy kart. Mechanika SKAT-a nie została przeniesiona.

## Struktura

- `makao-single.html` — gotowa samowystarczalna wersja do pobrania i uruchomienia dwuklikiem;
- `index.html` — ekran gry, menu i modale wersji modułowej;
- `css/styles.css` — kompletna warstwa wizualna i responsywność;
- `js/constants.js` — talia, kolory, konfiguracja;
- `js/rules.js` — czysta walidacja zasad i grup kart;
- `js/bot.js` — wybór ruchów botów;
- `js/game.js` — stan partii, kolejki, kary, żądania, klasyfikacja;
- `js/ui.js` — renderowanie DOM i obsługa interakcji;
- `js/ux-effects.js` — kompresja dużej ręki i krótkie animacje ruchu kart;
- `js/main.js` — bootstrap aplikacji;
- `scripts/build-single.mjs` — generator jednoplikowego HTML-a;
- `tests/rules.test.js` — testy reguł i inicjalizacji partii.

`makao-single.html` jest automatycznie regenerowany przez GitHub Actions po zmianie źródeł gry.

## Testy

```bash
npm test
npm run check
```
