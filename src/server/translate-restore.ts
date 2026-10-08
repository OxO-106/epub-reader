// The other half of name masking (translate-names.ts): puts the names back into the model's answer as it streams.
//
// The model is told to keep tokens like [[1]] exactly, and nearly always does. This is generous about the ways it
// might not: spaces inside ([[ 1 ]]), full-width digits and brackets (［［１］］), corner brackets (【【1】】). A token
// can arrive cut anywhere across chunks, so the end of each chunk that could still become a token is held back until
// the next chunk settles it. Nothing that looks like a token is ever sent on: a number that stands for nothing (the
// model made one up) is removed, and so is a token cut short when the stream ends.

const open = "[［【";
const close = "\\]］】";
// A whole token: two opening brackets, a number, two closing brackets, with a few spaces allowed around the number.
const token = new RegExp(`^[${open}]{2}[ \\t]{0,3}([0-9０-９]{1,9})[ \\t]{0,3}[${close}]{2}`);
// The start of a token, as far as it has come.
const tokenStart = new RegExp(`^[${open}](?:[${open}][ \\t]{0,3}(?:[0-9０-９]{1,9}[ \\t]{0,3}[${close}]?)?)?$`);
/** No token is longer than this (two brackets, three spaces, nine digits, three spaces, two brackets: 19). */
const longestToken = 24;

const toNumber = (digits: string) => Number(digits.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10)));

export interface Restorer {
  /** Takes the next piece of the model's answer; returns the text that is safe to send now. */
  push(chunk: string): string;
  /** The answer is over: drops whatever was held back, since it can only be a broken token. */
  end(): void;
}

/** `originals` maps each token number to the text it stood for (from `maskNames`). */
export function createRestorer(originals: ReadonlyMap<number, string>): Restorer {
  let held = "";
  return {
    push(chunk) {
      const text = held + chunk;
      held = "";
      let out = "";
      let at = 0;
      while (at < text.length) {
        if (!open.includes(text[at]!)) {
          let next = at + 1;
          while (next < text.length && !open.includes(text[next]!)) next++;
          out += text.slice(at, next);
          at = next;
          continue;
        }
        const rest = text.slice(at, at + longestToken);
        const whole = token.exec(rest);
        if (whole) {
          out += originals.get(toNumber(whole[1]!)) ?? "";
          at += whole[0].length;
        } else if (at + rest.length === text.length && tokenStart.test(rest)) {
          held = rest; // it may still become a token with the next chunk
          break;
        } else {
          out += text[at];
          at++;
        }
      }
      return out;
    },
    end() {
      held = "";
    },
  };
}
