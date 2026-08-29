# Wdrożenie multiplayera P2P Makao

Gra i sygnalizacja są wdrażane oddzielnie. Pliki gry pozostają zwykłym statycznym frontendem, a `cloudflare-signaling/` obsługuje wyłącznie utworzenie pokoju i wymianę SDP potrzebnego do WebRTC.

> Konfiguracja `wrangler.jsonc` używa przykładowej docelowej domeny `makao.qqnd.fyi`. Jeżeli Makao jest publikowane pod innym hostem, zmień tylko `routes[].pattern` na `<twoj-host>/api/*`. Frontend domyślnie korzysta z `/api` na tym samym originie.

## 1. Frontend

Wdróż zawartość repozytorium na serwer WWW przez HTTPS. Produkcyjny multiplayer wymaga bezpiecznego originu; tryb offline działa niezależnie od Workera.

Jeżeli używasz wersji modułowej, serwer musi udostępnić `index.html`, `css/` i `js/`. Wersja `makao-single.html` również zawiera moduł multiplayera po wygenerowaniu, ale po otwarciu przez `file://` pozostaje praktycznie trybem offline.

## 2. Cloudflare Worker

```bash
cd cloudflare-signaling
npm install
npx wrangler login
npm run deploy
```

Worker używa Durable Object `SignalingRoom`. Pokój żyje maksymalnie 30 minut i może przyjąć do trzech gości, dzięki czemu host + 3 gości tworzą stół czteroosobowy.

## 3. Trasa

Dla domeny z przykładowej konfiguracji Worker przejmuje tylko:

```text
makao.qqnd.fyi/api/*
```

`/`, `/index.html`, CSS i JavaScript nadal obsługuje zwykły serwer WWW. Dzięki temu awaria sygnalizacji nie blokuje startu gry offline.

## 4. Test po wdrożeniu

Otwórz:

```text
https://makao.qqnd.fyi/api/health
```

Oczekiwana odpowiedź:

```json
{"ok":true,"service":"makao-signaling"}
```

Następnie otwórz grę na dwóch urządzeniach/przeglądarkach:

1. host: Multiplayer → Utwórz stół → wpisz nick → utwórz pokój;
2. guest: Multiplayer → Dołącz → wpisz ten sam kod i ewentualne hasło;
3. sprawdź, czy gość pojawia się na stabilnym miejscu w lobby;
4. opcjonalnie włącz boty na wolnych miejscach;
5. rozpocznij grę.

Po uruchomieniu partii Worker zamyka pokój sygnalizacyjny. Dalsze wiadomości gry idą przez WebRTC DataChannel.

## 5. Model bezpieczeństwa

Gość nie wysyła pełnego stanu gry. Wysyła jedynie akcję, np. identyfikatory kart do zagrania. Host przypisuje akcję do miejsca wynikającego z konkretnego DataChannel, waliduje ją i dopiero wtedy zmienia stan.

Host wysyła każdemu gościowi osobny widok. Cudze ręce oraz kolejność talii są usuwane przed wysłaniem — nie są tylko ukrywane przez CSS.

To model przeznaczony do prywatnych gier. Host nadal posiada cały stan i teoretycznie może go podejrzeć. Odporna na oszustwa gra rankingowa wymagałaby przeniesienia autorytetu na zaufany serwer.

## 6. Sieci restrykcyjne

Konfiguracja klienta używa publicznego STUN. Typowe domowe połączenia powinny zestawić P2P, ale restrykcyjne NAT/firewall mogą wymagać w przyszłości serwera TURN. TURN nie zmienia modelu host-authoritative — jedynie przekazuje zaszyfrowany ruch WebRTC, gdy bezpośrednia ścieżka nie jest dostępna.
