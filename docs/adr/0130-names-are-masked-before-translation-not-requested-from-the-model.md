# Names are masked before translation, not requested from the model

The owner wants English names to stay English inside the Chinese. Asking the model to keep them does not work: in the benchmark Hy-MT2-7B kept 0 of 9 names under a plain instruction and 4 of 9 under the model card's terminology template, and it spelled the same name two ways. So the app server swaps each proper name for an opaque token (`[[1]]`) before the text goes to the model, tells the model to keep such tokens, and puts the names back into the stream (9 of 9 in the benchmark). The cost is a home-made name detector, so a few capitalised ordinary words get masked and a few sentence-initial names are missed; the detector therefore leans towards translating (a stop-list in a plain data file, sentence-initial words only when known) and takes names the caller already knows. The names never reach the model server, which also keeps the mapping inside one request. Do not "simplify" this back to a prompt instruction, or move the masking into the browser, where it would have to be repeated for every client.

## Considered options

- A stronger prompt, in English or Chinese, with or without examples: tried, 0 of 9 or 4 of 9 kept.
- The model card's terminology template mapping each name to itself: 4 of 9 kept, and it needs the names found anyway.
- Brackets or the English name beside the Chinese one: rejected by the owner, who wants the plain English name inside the sentence.
