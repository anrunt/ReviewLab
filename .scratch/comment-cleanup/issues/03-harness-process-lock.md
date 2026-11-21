# Zwalnianie blokady bazy rozmów po zakończeniu procesu

Status: needs-triage

`openConversationHarness` w `src/conversation.ts` tworzy katalog `conversations.lock` jako blokadę dla adaptera SQLite. Po awarii przed `rmdir` katalog może blokować jawne wznowienie review, mimo że poprzedni proces już nie działa.

Ocenić dostępny w `@earendil-works/chord/node` mechanizm `processLock`, którego blokadę zwalnia system po zakończeniu procesu. Sprawdzić zgodność mechanizmu z obsługiwanymi systemami i migrację z blokady katalogowej. Zachować wyłączność na poziomie bazy od chwili jej otwarcia do zamknięcia. Drugie uruchomienie ma otrzymać czytelny komunikat podczas pracy pierwszego, a wznowienie ma działać po awarii pierwszego procesu bez ręcznego usuwania katalogu.
