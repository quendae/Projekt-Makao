# Projekt Makao

Offline'owa gra **Makao** w czystym HTML, CSS i JavaScript. Rozgrywka: **1 człowiek + 2 albo 3 boty**, bez backendu i bez zewnętrznych bibliotek.

## Uruchomienie

Najprościej uruchomić katalog przez dowolny lokalny serwer HTTP, np.:

```bash
python -m http.server 8080
```

Następnie otworzyć `http://localhost:8080`.

> Gra używa modułów ES, dlatego zalecany jest serwer HTTP zamiast otwierania `index.html` bezpośrednio przez `file://`.

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
- 2 i 3 nakładają kary dobierania i mogą je kumulować;
- 4 blokuje kolejkę, a kolejna 4 może przenieść i zwiększyć blokadę;
- walet żąda wartości 5–10;
- dama działa według „dama na wszystko, wszystko na damę”, ale **nie przełamuje aktywnej kary, blokady ani żądania**;
- as żąda koloru dla następnego gracza;
- K♥: +5 kart dla następnego gracza;
- K♠: +5 kart dla poprzedniego gracza;
- K♣ i K♦ nie mają funkcji specjalnej;
- przy jednej karcie wymagana jest deklaracja **MAKAO**; brak deklaracji i STOP MAKAO = +5 kart;
- po zejściu pierwszej osoby pozostali grają dalej o 2., 3. i 4. miejsce;
- po wyczerpaniu talii stos odrzuconych jest tasowany ponownie z zachowaniem wierzchniej karty.

## Warstwa wizualna

UI jest adaptacją dostarczonego baseline'u SKAT: ciemny cyfrowy card-room, emeraldowy felt, ciepłe drewno, złoty akcent stanów, kremowe karty, Georgia dla elementów „stołowych”, systemowy sans-serif dla sterowania, tekstowe awatary i CSS-owe rewersy kart. Mechanika SKAT-a nie została przeniesiona.

## Struktura

- `index.html` — ekran gry, menu i modale;
- `css/styles.css` — kompletna warstwa wizualna i responsywność;
- `js/constants.js` — talia, kolory, konfiguracja;
- `js/rules.js` — czysta walidacja zasad i grup kart;
- `js/bot.js` — wybór ruchów botów;
- `js/game.js` — stan partii, kolejki, kary, żądania, klasyfikacja;
- `js/ui.js` — renderowanie DOM i obsługa interakcji;
- `js/main.js` — bootstrap aplikacji;
- `tests/rules.test.js` — testy reguł i inicjalizacji partii.

## Testy

```bash
npm test
npm run check
```
