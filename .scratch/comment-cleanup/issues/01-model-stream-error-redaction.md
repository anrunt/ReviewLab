# Redagowanie błędów bez nadpisywania metody runtime

Status: needs-triage

`getConversationModelRuntime` w `src/auth.ts` przechwytuje wywołania pi-durable przez przypisanie do `runtime.streamSimple`. Ogranicza to redakcję do tej metody i wiąże ochronę zapisanej rozmowy z konkretną ścieżką generowania w pi-durable. Błędy dostawcy należy redagować, zanim dotrą do rozmowy lub CLI.

Sprawdzić punkty rozszerzeń biblioteki dla błędów modelu. `HarnessOptions.models` przyjmuje interfejs `Models`, więc gdy brak dedykowanego mechanizmu redakcji, można przekazać go przez jawny adapter zamiast zmieniać metodę obiektu `ModelRuntime`. Zachować rozróżnienie między błędami przejściowymi a pozostałymi, przerwanie żądania i obsługę OAuth. Sprawdzić błędy zwracane w strumieniu i wyjątki rzucane podczas jego otwierania lub odczytu.
