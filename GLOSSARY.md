# AI Reviewer

Ocena zmian w pull requeście pod kątem wprowadzonych błędów.

## Language

**Review**:
Jedna ocena zmian w PR-ze, odnosząca się do ustalonych wersji kodu, kontekstu i zasad oceny. Wznowienie kontynuuje tę samą ocenę; ocena nowych commitów jest nowym review.

**Raport review**:
Wynik oceny zmian w pull requeście, przeznaczony dla osoby zlecającej review. Jego główną treścią są znalezione problemy; uwagi o stylu i konkretne pozytywy mają znaczenie drugorzędne.

**Problem (finding)**:
Konkretny błąd wprowadzony przez zmiany w pull requeście, opisany przez wskazanie miejsca w kodzie, scenariusza wystąpienia i skutku. Sama preferencja stylistyczna nie jest problemem.

**Kontekst PR-a**:
Informacje stanowiące podstawę review: tytuł i opis pull requesta, identyfikacja ocenianych wersji kodu, lista zmienionych plików i ich zmiany oraz powiązany kod potrzebny do oceny. W pierwszej wersji nie obejmuje komentarzy, wcześniejszych review ani powiązanych issues.

**Raport częściowy**:
Raport review, którego zakres oceny jest ograniczony przez brakujące dane i który jawnie wskazuje pominięte pliki oraz ograniczenia analizy. Brak znalezionych problemów dotyczy wyłącznie przeanalizowanego zakresu.

**Snapshot repozytorium**:
Stan plików repozytorium w konkretnym commicie, obejmujący zarówno pliki zmienione w PR-ze, jak i pozostałe pliki. Jest źródłem kodu dostępnego podczas review; jego dostępność nie oznacza, że cały kod został przeanalizowany.

**Propozycja naprawy**:
Sposób usunięcia znalezionego problemu przedstawiony w raporcie review. Dla małej poprawki wskazuje konkretną zmianę kodu, a dla dużej, wymagającej wielu zmian, przyjmuje postać promptu naprawczego.

**Prompt naprawczy**:
Instrukcja dla modelu wykonującego osobne zadanie naprawy konkretnego problemu znalezionego podczas review. Opisuje problem i oczekiwany rezultat naprawy.
