---
status: accepted
---

# Ochrona danych uwierzytelniania i rozmów

Rozmowy review używają zapisanych danych OpenAI OAuth. Wyłączamy obsługę kluczy API w ich runtime, aby usunięcie lub podmiana danych OAuth po rozpoczęciu review nie zmieniły sposobu uwierzytelniania na klucz API. Za odświeżanie i zapis tokenów pod blokadą odpowiada biblioteka. Harness otrzymuje dostęp do runtime, a wartości danych żądania pozostają wewnątrz niego. Odczyt statusu uwierzytelniania przekazuje ograniczony czasowo sygnał do magazynu danych, aby ograniczyć oczekiwanie na blokadę i zgłosić błąd odczytu zamiast użyć wcześniejszej wersji danych z pamięci.

CLI pokazuje komunikaty przygotowane przez aplikację, ponieważ błędy dostawcy i magazynu mogą zawierać szczegóły takie jak treść odpowiedzi endpointu tokenów lub adres przekierowania OAuth. Końcowe błędy strumienia modelu zastępujemy bezpiecznymi komunikatami przed przekazaniem ich do pi-durable, które może utrwalić je w rozmowie. Komunikaty zachowują rozróżnienie między błędem przejściowym a błędem wymagającym interwencji, potrzebne do obsługi ponowień. Kody ręczne i dane tajne wprowadzane podczas logowania pozostają niewidoczne w terminalu.

Plik bazy otrzymuje uprawnienia `0600` przed otwarciem przez SQLite, ponieważ SQLite na podstawie trybu bazy ustala uprawnienia plików WAL i SHM. Przy otwarciu ograniczamy również uprawnienia plików pomocniczych pozostałych po przerwanym procesie.
