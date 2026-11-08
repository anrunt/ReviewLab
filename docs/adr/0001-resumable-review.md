---
status: accepted
---

# Wznawianie niedokończonego review w pierwszej wersji

Pierwsza wersja umożliwia wznowienie niedokończonego review po awarii. Review jest związane z ustalonymi SHA, kontekstem PR-a i konfiguracją, w tym treścią użytego system promptu; nowe commity wymagają nowego review.

Przygotowanie wejścia, przygotowanie snapshotu, analiza oraz walidacja i zapis raportu mają zapisywany postęp. Korzystamy z trwałej rozmowy i mechanizmów zadań pi-durable, a aplikacja odpowiada za powiązanie tego stanu z wejściem review i dostępnością plików właściwego snapshotu. Sam zapis rozmowy nie zapewnia odtworzenia całego procesu. Niepoprawny raport otrzymuje jedną próbę korekty w tej samej rozmowie, bez rozpoczynania całej analizy od nowa.

Przyjmujemy koszt obsługi trwałego stanu i odtwarzania przerwanej pracy, aby awaria na późnym etapie nie wymuszała ponownej analizy całego PR-a. Nie gwarantujemy zachowania niedokończonego żądania do modelu: operacja przerwana przed zapisaniem wyniku może wymagać ponowienia.

Każde review otrzymuje identyfikator i jest wznawiane jawną komendą. Wznowienie wykorzystuje zapisane wejście i konfigurację; zwykłe uruchomienie review dla URL-a PR-a rozpoczyna nową ocenę.

Każdy snapshot znajduje się we własnym katalogu danych aplikacji, poza systemowym katalogiem tymczasowym. Niedokończone review zachowuje snapshot między uruchomieniami. Dopiero poprawne zakończenie review pozwala usunąć jego pliki, z zachowaniem raportu, rozmowy i danych wejściowych. Nowe commity wymagają pobrania nowego snapshotu.

Poprawne zakończenie oznacza przejście walidacji raportu i jego trwały zapis. Następnie aplikacja automatycznie usuwa snapshot, bez dodatkowego potwierdzenia użytkownika. Samo otrzymanie końcowej odpowiedzi modelu nie oznacza zakończenia review.

Nie ograniczamy liczby wywołań narzędzi. Domyślny limit czasu wykonania wynosi 30 minut i można go skonfigurować. Przekroczenie limitu lub przerwanie przez użytkownika pozostawia review niedokończone i możliwe do wznowienia. Wznowienie otrzymuje nowy budżet czasu, ale zachowuje wykorzystaną próbę korekty raportu. Włączamy automatyczną kompakcję kontekstu podczas długich analiz.

Cache współdzielony między review, analiza kolejnych commitów w ramach istniejącego review oraz automatyczna implementacja poprawek po komentarzu na GitHubie pozostają poza zakresem pierwszej wersji.
