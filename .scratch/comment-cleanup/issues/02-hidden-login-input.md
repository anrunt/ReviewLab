# Oddzielenie wyświetlania promptu logowania od wyciszania wejścia

Status: needs-triage

W `src/auth.ts` obsługa `secret` i `manual_code` wywołuje `terminal.question`, a następnie ustawia `hideInput`. Obie operacje korzystają z tego samego strumienia wyjściowego. Widoczność treści promptu zależy od tego, czy `question` wypisze ją przed zmianą flagi. API `node:readline/promises` udostępnia anulowanie pytania przez `AbortSignal`, ale nie ma osobnej opcji wyłączenia echa dla pytania.

Oddzielić wypisanie treści promptu od odczytu odpowiedzi, z wyciszeniem od początku odczytu. Zachować widoczność zwykłych promptów i anulowanie logowania. Sprawdzić na pseudoterminalu wpisywanie i wklejanie kodów oraz przywrócenie wyjścia po odpowiedzi, anulowaniu i błędzie.
