import { describe, expect, it } from "vitest";
import { createRestorer } from "../../src/server/translate-restore.ts";

// The stream restorer through its own small interface: model text in, piece by piece; the text with the names put
// back out, piece by piece.

const names = new Map([
  [1, "Bennet"],
  [2, "Netherfield Park"],
]);

function restoreInPieces(pieces: string[], map = names): string[] {
  const restorer = createRestorer(map);
  const out = pieces.map((piece) => restorer.push(piece));
  restorer.end();
  return out;
}
const restore = (text: string) => restoreInPieces([text]).join("");

/** Every way to cut `text` into two pieces, and the one-character-at-a-time cut. */
function cuts(text: string): string[][] {
  const chars = [...text];
  const all: string[][] = [chars];
  for (let at = 0; at <= chars.length; at++) all.push([chars.slice(0, at).join(""), chars.slice(at).join("")]);
  return all;
}

describe("putting names back", () => {
  it("replaces each token with the name it stands for", () => {
    expect(restore("[[1]]先生住在[[2]]。")).toBe("Bennet先生住在Netherfield Park。");
  });

  it("replaces a token that comes back several times", () => {
    expect(restore("[[1]]说：[[1]]不在。")).toBe("Bennet说：Bennet不在。");
  });

  it("leaves text without tokens as it is", () => {
    expect(restore("没有名字。")).toBe("没有名字。");
    expect(restore("见[1]和[注]，还有[[abc]]。")).toBe("见[1]和[注]，还有[[abc]]。");
  });

  it("restores a token the model wrote with spaces or with full-width or corner brackets", () => {
    expect(restore("[[ 1 ]]和[[2 ]]")).toBe("Bennet和Netherfield Park");
    expect(restore("［［１］］和［［２］］")).toBe("Bennet和Netherfield Park");
    expect(restore("【【1】】和【【 2 】】")).toBe("Bennet和Netherfield Park");
  });
});

describe("splitting a token across chunks", () => {
  const sentence = "他对[[1]]先生说，[[ 2 ]]很大，［［１］］笑了。";
  const expected = "他对Bennet先生说，Netherfield Park很大，Bennet笑了。";

  it("gives the same text wherever the stream is cut", () => {
    for (const pieces of cuts(sentence)) {
      expect(restoreInPieces(pieces).join("")).toBe(expected);
    }
  });

  it("gives the same text when every cut in a row is tried, three pieces at a time", () => {
    const chars = [...sentence];
    for (let a = 0; a <= chars.length; a++) {
      for (let b = a; b <= chars.length; b++) {
        const pieces = [chars.slice(0, a).join(""), chars.slice(a, b).join(""), chars.slice(b).join("")];
        expect(restoreInPieces(pieces).join("")).toBe(expected);
      }
    }
  });

  it("never lets a piece of a token out, at any point of the stream", () => {
    for (const pieces of cuts(sentence)) {
      const restorer = createRestorer(names);
      let sent = "";
      for (const piece of pieces) {
        sent += restorer.push(piece);
        expect(sent).not.toMatch(/[[\]［］【】]/);
        expect(sent).not.toMatch(/\d/);
      }
    }
  });

  it("holds back only what might still become a token, so the rest streams at once", () => {
    const restorer = createRestorer(names);
    expect(restorer.push("你好，[")).toBe("你好，");
    expect(restorer.push("[1")).toBe("");
    expect(restorer.push("]]先生")).toBe("Bennet先生");
    expect(restorer.push("来了")).toBe("来了");
  });

  it("lets a bracket through as soon as it cannot be a token", () => {
    const restorer = createRestorer(names);
    expect(restorer.push("见[")).toBe("见");
    expect(restorer.push("注]")).toBe("[注]");
  });
});

describe("tokens that cannot be restored", () => {
  it("tolerates a token the model dropped: the name is simply absent", () => {
    expect(restore("先生住在[[2]]。")).toBe("先生住在Netherfield Park。");
  });

  it("removes a token with a number that stands for nothing", () => {
    expect(restore("[[7]]先生来了，[[ 12 ]]也是。")).toBe("先生来了，也是。");
  });

  it("removes a token cut short at the end of the stream, whatever is left of it", () => {
    for (const tail of ["[", "[[", "[[ ", "[[3", "[[3 ", "[[3]", "［［２", "【【1】"]) {
      for (const pieces of cuts(`很好${tail}`)) {
        expect(restoreInPieces(pieces).join("")).toBe("很好");
      }
    }
  });

  it("does not let a long run of digits or spaces through as a token", () => {
    expect(restore("[[1234567890123]]")).toBe("[[1234567890123]]");
    expect(restore("[[     1]]")).toBe("[[     1]]");
  });

  it("copes with an empty map and with empty chunks", () => {
    const restorer = createRestorer(new Map());
    expect(restorer.push("")).toBe("");
    expect(restorer.push("[[1]]好")).toBe("好");
    restorer.end();
  });

  it("forgets the held part at the end of the answer", () => {
    const restorer = createRestorer(names);
    restorer.push("好[[1");
    restorer.end();
    expect(restorer.push("")).toBe("");
  });
});
