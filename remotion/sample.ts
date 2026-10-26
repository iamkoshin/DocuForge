import type { RenderProps, RenderScene, SceneData, SceneType } from "../src/lib/schemas";

// Demo props for Remotion Studio and render smoke tests: every scene type, synthetic word timings, no audio.
const FPS = 30;
const spec: [SceneType, string, string[], SceneData][] = [
  ["KineticCaption", "In just nine days, a thirty-two billion dollar empire vanished.", ["vanished"], {}],
  ["ChapterTitle", "It started with a math genius and a trading firm.", [], { chapterNumber: 1, chapterTitle: "The Golden Boy" }],
  ["NameReveal", "Sam Bankman-Fried founded FTX in twenty nineteen.", ["Bankman-Fried"], { name: "Sam Bankman-Fried", role: "Founder & CEO, FTX" }],
  ["BigNumber", "At its peak, FTX was valued at thirty-two billion dollars.", ["thirty-two"], { number: "32", numberPrefix: "$", numberSuffix: " billion", label: "Valuation, January 2022" }],
  ["Timeline", "Then, in November, everything moved very fast.", [], { timelineEvents: [{ date: "Nov 2", label: "Leaked balance sheet" }, { date: "Nov 6", label: "Binance sells FTT" }, { date: "Nov 8", label: "Withdrawals halted" }, { date: "Nov 11", label: "Bankruptcy filing" }] }],
  ["FlowDiagram", "Customer deposits flowed from FTX to its sister firm, Alameda Research.", ["Alameda"], { nodes: ["Customers", "FTX", "Alameda Research"], flowLabel: "customer deposits" }],
  ["PaperDocument", "The balance sheet told a different story.", ["different"], { docType: "balance-sheet", docTitle: "Alameda Research — assets", docRows: [{ label: "FTT tokens", value: "$5.82B" }, { label: "Cash", value: "$134M" }, { label: "Loans payable", value: "-$7.4B", negative: true }] }],
  ["PaperDocument", "On November eleventh, FTX filed for bankruptcy.", ["bankruptcy"], { docType: "filing", docTitle: "Voluntary Petition — Chapter 11", docRows: [{ label: "Debtor", value: "FTX Trading Ltd." }, { label: "Court", value: "D. Delaware" }], stampText: "Chapter 11" }],
  ["CodeSnippet", "Prosecutors said a hidden setting let Alameda borrow without limits.", ["hidden"], { code: "if (account == ALAMEDA) {\n  allow_negative = true\n  credit_limit = 65_000_000_000\n}", highlightLine: 2 }],
  ["PhotoStack", "Investors, celebrities and regulators had all trusted the story.", ["trusted"], { captions: ["Miami, 2021", "Washington, 2022"] }],
  ["Statement", "But the money was already gone.", [], { statement: "But the money was already gone." }],
  ["EndCard", "Trust, once spent, is the hardest asset to recover.", [], { statement: "Trust, once spent, is the hardest asset to recover.", footnote: "Sample footnote: current status of the story would appear here." }],
];

function build(): RenderProps {
  let start = 0;
  const scenes: RenderScene[] = spec.map(([type, narration, emphasisWords, data], index) => {
    const words = narration.split(/\s+/).map((w, i) => ({ word: w, start: 0.3 + i * 0.38, end: 0.3 + i * 0.38 + 0.32 }));
    const durationFrames = Math.round((words[words.length - 1].end + 1.2) * FPS);
    const s: RenderScene = { id: `s${index + 1}`, chapterId: "ch1", index, type, narration, emphasisWords, startFrame: start, durationFrames, audioOffsetFrames: 9, words, assets: [], data };
    start += durationFrames;
    return s;
  });
  return {
    title: "Sample",
    fps: FPS,
    width: 1920,
    height: 1080,
    format: "16:9",
    theme: "investigative",
    durationInFrames: start,
    scenes,
    sfx: [],
    speech: [],
    musicBaseDb: -20,
    pauseBoostDb: 5,
    thumbnail: { text: "Nine Days To Zero" },
  };
}

export const SAMPLE_PROPS: RenderProps = build();
