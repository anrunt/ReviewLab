# Review PR-a — uzgodniony zakres pierwszej wersji

Dokument zbiera decyzje z rozmowy projektowej. Opisuje docelowe zachowanie; nie oznacza, że funkcje zostały zaimplementowane. Terminologia: [GLOSSARY.md](../GLOSSARY.md). Decyzja o trwałym stanie: [ADR-0001](adr/0001-resumable-review.md).

## Cel i wynik

CLI przyjmuje URL PR-a i przygotowuje lokalny raport dla użytkownika. Nie wymaga lokalnego checkoutu ocenianego repozytorium.

Priorytetem są konkretne błędy wprowadzone przez PR. Problem musi mieć wskazanie miejsca w kodzie, scenariusza wystąpienia i skutku. Model pomija luźne podejrzenia; może zwrócić pustą listę problemów. Uwagi o stylu i konkretne pozytywy są drugorzędne, bez obowiązkowych pochwał.

Model zwraca ustrukturyzowany raport: podsumowanie, listę problemów oraz ograniczenia analizy. Każdy problem zawiera wagę, plik i lokalizację, opis scenariusza, skutek oraz propozycję naprawy. CLI waliduje wynik i przedstawia go w czytelnej formie.

Propozycja naprawy ma jedną z dwóch postaci:

- Mała, lokalna poprawka: diff wskazujący usuwane i dodawane linie w jednym pliku, z limitem 30 takich linii łącznie. Odnosi się do ocenianego snapshotu. Sam krótki zapis nie wystarcza, jeśli naprawa wymaga skoordynowania zmian w innych miejscach.
- Większa poprawka: samodzielny prompt naprawczy, który można przekazać do osobnej sesji implementacyjnej. Opisuje problem, lokalizację, oczekiwany rezultat i sposób sprawdzenia poprawki.

Reviewer prezentuje propozycje; nie zmienia kodu ocenianego repozytorium.

## Wejście i dostęp do kodu

Na początku model otrzymuje tytuł i opis PR-a, identyfikację ocenianych wersji, listę zmienionych plików i dostępne patche. Komentarze, wcześniejsze review i powiązane issues są poza zakresem pierwszej wersji.

Aplikacja pobiera pełny snapshot repozytorium z ustalonego `head.sha`. Snapshot już zawiera zmiany PR-a; aplikacja nie nakłada na niego patcha. Każde review ma własny katalog snapshotu w danych aplikacji, zawsze poza systemowym `/tmp`. Pobranie całego repozytorium nie oznacza wysłania wszystkich jego plików do kontekstu modelu.

Model ma narzędzia do:

- listowania plików snapshotu;
- odczytu pliku lub fragmentu z numerami linii;
- wyszukiwania tekstu w snapshocie;
- odczytu pojedynczego pliku w wersji odniesienia, na żądanie.

Wersją odniesienia jest merge base odpowiadający diffowi PR-a, nie dowolny bieżący stan gałęzi docelowej. Nie pobieramy drugiego pełnego snapshotu. Wcześniejsze pliki są pomocniczym źródłem, używanym, kiedy diff i aktualny kod nie wystarczają do oceny.

Narzędzia nie udostępniają modelowi zapisu plików ani uruchamiania poleceń. Odczyty lokalne są ograniczone do przygotowanego snapshotu. Instrukcje review wymagają sprawdzania istotnych zależności zmienionego zachowania przed sformułowaniem oceny.

Nieudane przygotowanie podstawowego snapshotu przerywa review przed analizą. Braki pojedynczych patchy lub wcześniejszych plików mogą skutkować raportem częściowym, jeśli pozostałe dane pozwalają na użyteczną ocenę. Raport jawnie wskazuje pominięte pliki i ograniczenia; brak znalezionych błędów dotyczy tylko ocenionego zakresu.

## System prompt i język

Domyślny system prompt jest po angielsku i zawiera jawne polecenie generowania raportu po polsku. Użytkownik może wskazać własny plik z pełną treścią promptu, między innymi zmieniając język odpowiedzi. Przy braku własnego pliku używany jest prompt domyślny.

Treść promptu użytego przy rozpoczęciu review jest zapisywana, aby wznowienie nie zależało od późniejszej edycji pliku. Uprawnienia narzędzi i walidacja struktury raportu są egzekwowane przez aplikację niezależnie od treści promptu.

## Przebieg i wznowienie

Przebieg obejmuje zapisywane etapy:

1. Przygotowanie i utrwalenie danych wejściowych oraz konfiguracji review.
2. Przygotowanie snapshotu dla ustalonego commita.
3. Analizę w rozmowie pi-durable, z narzędziami odczytu.
4. Walidację raportu i ewentualną jednorazową korektę.
5. Trwały zapis poprawnego raportu i oznaczenie review jako zakończonego, a następnie sprzątnięcie snapshotu i prezentację wyniku.

Każde review ma identyfikator pokazywany przez CLI. Jawna komenda wznowienia, np. `resume <review-id>`, kontynuuje zapisane review. Zwykłe uruchomienie review dla URL-a rozpoczyna nową ocenę. Nowe commity wymagają nowego review i nowego snapshotu; istniejąca analiza pozostaje związana z zapisanymi SHA.

Stan rozmowy i checkpointy pi-durable są podstawą wznowienia, ale dostępność plików oraz zapis etapów przygotowania wejścia pozostają odpowiedzialnością aplikacji. Przerwana operacja bez zapisanego wyniku może wymagać ponowienia.

Snapshot niedokończonego review pozostaje na dysku. Po poprawnym zakończeniu aplikacja automatycznie usuwa jego pliki, zachowując raport, rozmowę i dane wejściowe. Zakończenie wymaga walidacji i trwałego zapisu raportu, bez dodatkowego ręcznego potwierdzenia. Sprzątanie po zapisaniu wyniku nie może wymuszać ponownego uruchomienia analizy.

## Walidacja, limity i kompakcja

Walidacja obejmuje strukturę raportu, ograniczenia małej poprawki oraz możliwość zastosowania proponowanego diffu do ocenianego pliku, bez zapisywania poprawki. Nie potwierdza poprawności działania proponowanego kodu.

Niepoprawna odpowiedź otrzymuje jedną próbę korekty w tej samej rozmowie, z konkretnymi błędami walidacji i zachowaniem dotychczasowego kontekstu. Model zwraca cały poprawiony raport. Kolejna niepoprawna odpowiedź kończy się błędem. Licznik tej próby jest trwały; wznowienie go nie zeruje. Korekta raportu jest odrębna od ponawiania błędów sieciowych i wznawiania procesu po awarii.

Nie ma limitu liczby wywołań narzędzi. Domyślny limit czasu wynosi 30 minut i jest konfigurowalny. Przekroczenie limitu lub `Ctrl+C` pozostawia review niedokończone i możliwe do wznowienia. Wznowienie dostaje nowy budżet czasu.

Automatyczna kompakcja pi-durable pozwala kontynuować długą analizę: starszy kontekst jest zastępowany streszczeniem, a pełna historia pozostaje zapisana. Streszczenie może utracić szczegóły; narzędzia nadal pozwalają ponownie sprawdzić kod. Na początek wykorzystujemy wbudowany mechanizm biblioteki.

## Proponowana kolejność implementacji

1. **Kontrakt review i trwałe wejście.** Zdefiniować dane wejściowe, strukturę raportu oraz zapis tożsamości i postępu review. Od początku przypisać do review konkretne SHA i treść promptu, aby kolejne etapy miały stabilne dane do wznowienia.
2. **Snapshot i odczyt historyczny.** Rozszerzyć pobieranie danych GitHuba o wersję odniesienia, pobranie snapshotu oraz pojedynczych wcześniejszych plików. Obsłużyć katalog review i przerwane przygotowanie snapshotu.
3. **Narzędzia, prompt i analiza.** Podłączyć narzędzia do pi-durable, przygotować domyślny prompt i przekazywanie kontekstu PR-a, powiązać rozmowę z review.
4. **Raport i zakończenie.** Dodać walidację, jednorazową korektę, zapis wyniku, prezentację i sprzątanie po poprawnym zakończeniu.
5. **Pełna obsługa CLI i recovery.** Spiąć nowe review, własny prompt, jawne wznowienie, przerwanie oraz limit czasu. Sprawdzić zachowanie przy awarii każdego etapu, również po zapisie raportu, lecz przed sprzątnięciem plików.

To kolejność prac, nie zgoda na rozpoczęcie implementacji. Przed kodowaniem należy wskazać dokładne pliki i cel zmian. Testy i commity wymagają osobnego wyraźnego polecenia użytkownika.

## Kolejne wersje

- Współdzielony cache snapshotów.
- Kontynuowanie pracy nad PR-em po kolejnych commitach, z wykorzystaniem wcześniejszych ustaleń.
- Publikowanie review na GitHubie.
- Uruchamianie sesji naprawczej pi-durable przez komentarz na GitHubie i wysyłanie commita z poprawką.
