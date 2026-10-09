# Names are transliterated into Chinese, not kept in English

Supersedes ADR 0130. The owner now wants the Chinese to read as Chinese all the way through: every name of a person or place is put into Chinese characters by its sound (音译), so a character called River becomes something like 瑞弗, not 河 ("river"), and a well-known name keeps its usual Chinese form.

The model already leans this way (the benchmark behind ADR 0130 found it transliterates names however it is asked), so the work left is telling it which words are names. The name detector stays (`translate-names.ts` with `name-stop-list.txt`, and the Reader still sends the names it learned from the section, so a name that starts a sentence is caught); its findings are now listed in the prompt ("Names in the text: …") with the transliteration rule, and the text goes to the model unchanged. The masking with `[[n]]` tokens and the stream-safe restore (`translate-restore.ts`) are gone, and the answer is passed through as the model writes it.

The cost: the model picks the characters, so the same name may come out a little differently from one paragraph to another; nothing is remembered between requests (the text being translated, names included, is still never stored). A per-Book glossary that pins one transliteration per name would fix that, at the price of keeping names from the Book.
