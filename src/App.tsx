import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ArrowLeft,
  BarChart3,
  BookOpenText,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Coins,
  Home,
  LineChart,
  NotebookTabs,
  Plus,
  ReceiptText,
  ScanLine,
  Sparkles,
  WalletCards,
  X,
} from "lucide-react";

type TabKey = "home" | "journal" | "receipts" | "analysis" | "tax";
type SettlementView = "monthly" | "annual";

type JournalUnit = {
  amount: number;
  tags: string[];
};

type ThoughtJournal = {
  aiBorrowing: JournalUnit;
  selfCapital: JournalUnit;
  thoughtAsset: JournalUnit;
  thoughtExpense: JournalUnit;
  selfDecisionBalance: {
    amount: number;
    text: string;
  };
};

type ThoughtReceipt = {
  id: string;
  date: string;
  time: string;
  topic: string;
  category: string;
  aiRole: string;
  aiScreenTimeMinutes: number;
  gained: string;
  feelingBefore: string;
  feelingAfter: string;
  distanceLevel: "ほどよい" | "近め" | "じっくり";
  selfDecision: string;
  thoughtBalance: string;
  journal?: ThoughtJournal;
};

type ReceiptFilter =
  | { type: "category"; value: string }
  | { type: "role"; value: string }
  | { type: "moodChange" }
  | { type: "selfDecision" };

type ConversationMessage = {
  role?: string;
  text?: string;
};

type RawConversation = {
  aiService?: string;
  url?: string;
  capturedAt?: string;
  conversationTitle?: string;
  messages?: ConversationMessage[];
};

type ThoughtReceiptCandidate = {
  aiService: string;
  conversationDate: string;
  topic: string;
  aiRole: string;
  aiAdded: string;
  selfDecision: string;
  feelingAfter: string;
  thinkingBalance: string;
};

type CandidateField = keyof ThoughtReceiptCandidate;

type IssuedThinkingReceipt = ThoughtReceiptCandidate & {
  receiptNo: string;
  issuedAt: string;
};

// 応募用プロトタイプなので、外部DBではなく画面確認用のサンプルデータを置いています。
const STORAGE_KEY = "watashi-to-ai-thought-receipts";
const RAW_CONVERSATION_KEY = "aiConversationRaw";
const THINKING_LEDGER_KEY = "thinkingLedger";
const RECEIPT_HASH_KEY = "receipt";
const DRAFT_QUERY_KEY = "draft";

const aiRoleOptions = [
  "壁打ち相手",
  "調査役",
  "先生",
  "編集者",
  "デザイナー",
  "カウンセラー",
  "参謀",
  "相棒",
  "その他",
];

const feelingAfterOptions = [
  "すっきりした",
  "考えが広がった",
  "安心した",
  "迷いが増えた",
  "頼りすぎたかも",
  "まだ保留",
];

const thinkingBalanceOptions = [
  "自分の判断が多い",
  "AIの助けが多い",
  "一緒に考えた",
  "まだ保留",
];

const emptyLedgerMessage =
  "まだ保存された思考レシートがありません。レシートを発行して帳簿に保存すると、ここに記録が表示されます。";

const demoConversation: RawConversation = {
  aiService: "ChatGPT",
  url: "https://chatgpt.com/",
  capturedAt: "2026/07/04 14:30",
  conversationTitle: "作品コンセプトの整理",
  messages: [
    {
      role: "user",
      text: "「私とAIの確定申告」という作品を、A3ポスターで伝わる形に整理したいです。",
    },
    {
      role: "assistant",
      text: "AIとの会話を使いっぱなしにせず、思考レシートとして発行し、帳簿にため、月次決算や確定申告で振り返る体験構造にすると伝わりやすいです。",
    },
    {
      role: "user",
      text: "思考レシートを主役にし、紙とデジタルをつなぐサービスとして見せる方向で進めます。",
    },
  ],
};

const sampleThinkingLedgerReceipts: IssuedThinkingReceipt[] = [
  {
    receiptNo: "TR-SAMPLE-001",
    issuedAt: "2026/07/04 10:10",
    aiService: "ChatGPT",
    conversationDate: "2026/07/04 09:40",
    topic: "作品コンセプトの壁打ち",
    aiRole: "壁打ち相手",
    aiAdded: "体験の流れ、展示で伝える一文、サービス名の見え方を整理した",
    selfDecision: "AIとの会話をレシート化して振り返る体験を作品の中心に置くことに決めた",
    feelingAfter: "考えが広がった",
    thinkingBalance: "一緒に考えた",
  },
  {
    receiptNo: "TR-SAMPLE-002",
    issuedAt: "2026/07/04 11:25",
    aiService: "Claude",
    conversationDate: "2026/07/04 10:55",
    topic: "審査資料の文章構成",
    aiRole: "編集者",
    aiAdded: "見出しの順番、説明量の調整、審査員に伝わる要約を追加した",
    selfDecision: "最初にサービスの流れを示し、その後に技術構成を説明することに決めた",
    feelingAfter: "すっきりした",
    thinkingBalance: "自分の判断が多い",
  },
  {
    receiptNo: "TR-SAMPLE-003",
    issuedAt: "2026/07/03 16:40",
    aiService: "Perplexity",
    conversationDate: "2026/07/03 16:05",
    topic: "関連事例の調査",
    aiRole: "調査役",
    aiAdded: "AIログ、セルフリフレクション、データポータビリティの関連事例を比較した",
    selfDecision: "単なる履歴保存ではなく、自分の判断を残す帳簿として見せることに決めた",
    feelingAfter: "安心した",
    thinkingBalance: "AIの助けが多い",
  },
  {
    receiptNo: "TR-SAMPLE-004",
    issuedAt: "2026/07/03 21:15",
    aiService: "Gemini",
    conversationDate: "2026/07/03 20:50",
    topic: "展示体験のアイデア出し",
    aiRole: "相棒",
    aiAdded: "レシートプリンター、QR復元、月次決算の見せ方を提案した",
    selfDecision: "A3ポスターではレシート発行から確定申告までの流れを一枚で見せることに決めた",
    feelingAfter: "考えが広がった",
    thinkingBalance: "一緒に考えた",
  },
  {
    receiptNo: "TR-SAMPLE-005",
    issuedAt: "2026/07/02 18:20",
    aiService: "NotebookLM",
    conversationDate: "2026/07/02 17:45",
    topic: "資料整理と要点抽出",
    aiRole: "先生",
    aiAdded: "既存メモから重要な論点と未整理の問いを抽出した",
    selfDecision: "発表では技術説明よりも、AIとの関係を記録する価値を先に伝えることに決めた",
    feelingAfter: "すっきりした",
    thinkingBalance: "自分の判断が多い",
  },
];

const journalCategories = [
  { key: "aiBorrowing", label: "AI借入", color: "#2563EB" },
  { key: "selfCapital", label: "自己出資", color: "#38BDF8" },
  { key: "thoughtAsset", label: "思考資産", color: "#0EA5E9" },
  { key: "thoughtExpense", label: "思考支出", color: "#93C5FD" },
  { key: "selfDecisionBalance", label: "自己判断残高", color: "#64748B" },
] as const;

type JournalCategoryKey = (typeof journalCategories)[number]["key"];

const initialReceipts: ThoughtReceipt[] = [
  {
    id: "R-20260630-001",
    date: "2026-06-30",
    time: "21:30",
    topic: "企画制作について相談",
    category: "企画・制作",
    aiRole: "相棒",
    aiScreenTimeMinutes: 18,
    gained: "アイデア整理",
    feelingBefore: "迷い",
    feelingAfter: "納得",
    distanceLevel: "近め",
    selfDecision: "アプリ側を自分が担当する",
    thoughtBalance: "役割分担が明確になった",
  },
  {
    id: "R-20260629-002",
    date: "2026-06-29",
    time: "23:05",
    topic: "レポート構成の相談",
    category: "課題・レポート",
    aiRole: "先生",
    aiScreenTimeMinutes: 24,
    gained: "論点の整理",
    feelingBefore: "焦り",
    feelingAfter: "見通し",
    distanceLevel: "ほどよい",
    selfDecision: "導入は自分の体験から書く",
    thoughtBalance: "書く順番が決まった",
  },
  {
    id: "R-20260628-003",
    date: "2026-06-28",
    time: "18:20",
    topic: "友人への返信文を考える",
    category: "人間関係",
    aiRole: "鏡",
    aiScreenTimeMinutes: 12,
    gained: "言い方の調整",
    feelingBefore: "もやもや",
    feelingAfter: "落ち着き",
    distanceLevel: "ほどよい",
    selfDecision: "短く正直に伝える",
    thoughtBalance: "相手への配慮を残せた",
  },
  {
    id: "R-20260627-004",
    date: "2026-06-27",
    time: "16:10",
    topic: "インターン先の選び方",
    category: "進路・将来",
    aiRole: "相談役",
    aiScreenTimeMinutes: 31,
    gained: "比較軸",
    feelingBefore: "不安",
    feelingAfter: "前向き",
    distanceLevel: "じっくり",
    selfDecision: "今週は2社だけ深く調べる",
    thoughtBalance: "優先順位が見えた",
  },
  {
    id: "R-20260625-005",
    date: "2026-06-25",
    time: "09:45",
    topic: "プレゼン原稿の言い換え",
    category: "文章作成",
    aiRole: "助手",
    aiScreenTimeMinutes: 16,
    gained: "表現の候補",
    feelingBefore: "硬さ",
    feelingAfter: "自然",
    distanceLevel: "ほどよい",
    selfDecision: "最後の一文は自分の言葉に戻す",
    thoughtBalance: "伝えたい温度が残った",
  },
  {
    id: "R-20260623-006",
    date: "2026-06-23",
    time: "22:15",
    topic: "眠る前の気持ちを整理",
    category: "感情整理",
    aiRole: "カウンセラー",
    aiScreenTimeMinutes: 21,
    gained: "気持ちの変化",
    feelingBefore: "疲れ",
    feelingAfter: "安心",
    distanceLevel: "近め",
    selfDecision: "明日の朝に考え直す",
    thoughtBalance: "今日の自分を責めずに終えた",
  },
  {
    id: "R-20260621-007",
    date: "2026-06-21",
    time: "14:00",
    topic: "新しいサービス事例を調べる",
    category: "調べもの",
    aiRole: "助手",
    aiScreenTimeMinutes: 27,
    gained: "比較メモ",
    feelingBefore: "散らかり",
    feelingAfter: "整理",
    distanceLevel: "ほどよい",
    selfDecision: "参考にする点を3つに絞る",
    thoughtBalance: "情報が帳簿に収まった",
  },
  {
    id: "R-20260618-008",
    date: "2026-06-18",
    time: "12:40",
    topic: "買うか迷っている教材の相談",
    category: "日常判断",
    aiRole: "親友",
    aiScreenTimeMinutes: 9,
    gained: "判断材料",
    feelingBefore: "迷い",
    feelingAfter: "保留",
    distanceLevel: "ほどよい",
    selfDecision: "来週まで買わずに様子を見る",
    thoughtBalance: "急がない選択ができた",
  },
  {
    id: "R-20260614-009",
    date: "2026-06-14",
    time: "20:10",
    topic: "企画タイトル案を出す",
    category: "企画・制作",
    aiRole: "相棒",
    aiScreenTimeMinutes: 34,
    gained: "発想の広がり",
    feelingBefore: "停滞",
    feelingAfter: "わくわく",
    distanceLevel: "近め",
    selfDecision: "応募名は自分で最終決定する",
    thoughtBalance: "候補と判断理由が残った",
  },
  {
    id: "R-20260610-010",
    date: "2026-06-10",
    time: "08:25",
    topic: "ゼミで話す内容の確認",
    category: "課題・レポート",
    aiRole: "先生",
    aiScreenTimeMinutes: 15,
    gained: "要点確認",
    feelingBefore: "緊張",
    feelingAfter: "準備完了",
    distanceLevel: "ほどよい",
    selfDecision: "結論を先に話す",
    thoughtBalance: "説明の軸ができた",
  },
];

const sampleScannedReceipt: ThoughtReceipt = {
  id: "R-20260701-001",
  date: "2026-07-01",
  time: "22:10",
  topic: "アプリの機能追加について相談",
  category: "企画・制作",
  aiRole: "相談役",
  aiScreenTimeMinutes: 22,
  gained: "実装手順の整理",
  feelingBefore: "少し不安",
  feelingAfter: "見通しが立った",
  distanceLevel: "近め",
  selfDecision: "まずは読み取り機能から追加する",
  thoughtBalance: "一気に作らず、段階的に進める方針が決まった",
  journal: {
    aiBorrowing: {
      amount: 4,
      tags: ["比較軸", "言語化", "手順整理"],
    },
    selfCapital: {
      amount: 3,
      tags: ["目的", "違和感", "最終判断"],
    },
    thoughtAsset: {
      amount: 5,
      tags: ["見通し", "判断材料", "方向性"],
    },
    thoughtExpense: {
      amount: 2,
      tags: ["迷い", "調べる手間"],
    },
    selfDecisionBalance: {
      amount: 4,
      text: "ホームに読み取り機能を置くことを決めた",
    },
  },
};

const previousSettlement = {
  title: "5月の思考決算書",
  status: "完成済み",
  description:
    "5月に記録された思考レシートから、AIとの関わり方と自分に残った判断をまとめました。",
  summary:
    "5月は、課題・レポートと文章作成の相談が中心でした。AIには先生や助手の役割を求める場面が多く、考えを整えてから自分の言葉で提出物に落とし込む流れが残っています。",
  metrics: [
    { label: "AIスクリーンタイム", value: "2時間53分" },
    { label: "思考レシート", value: "9枚" },
    { label: "主要相談科目", value: "課題・レポート" },
    { label: "よく求めた役割", value: "先生" },
  ],
  balances: [
    "自己判断残高：8件",
    "思考収入：論点整理、文章化、見通し",
    "気持ちの変化：5件",
  ],
};

const baseMonthlyScreenTime = [
  { month: "2月", minutes: 138 },
  { month: "3月", minutes: 164 },
  { month: "4月", minutes: 196 },
  { month: "5月", minutes: 173 },
];

const moodFlow = [
  { label: "6/10", score: 62 },
  { label: "6/14", score: 78 },
  { label: "6/18", score: 58 },
  { label: "6/23", score: 74 },
  { label: "6/27", score: 82 },
  { label: "6/30", score: 88 },
];

const tabLabels: Record<TabKey, string> = {
  home: "レシート",
  journal: "仕訳",
  receipts: "帳簿",
  analysis: "月次",
  tax: "決算",
};

type ReaderStep = "closed" | "scan" | "confirm";
type AnalysisFocus = "analysis-screen-time" | null;

function resetPageScroll(behavior: ScrollBehavior = "auto", extraElement?: HTMLElement | null) {
  if (typeof window === "undefined") return;

  const candidates = [
    extraElement,
    document.querySelector(".screen"),
    document.querySelector(".phone-frame"),
    document.querySelector(".app-shell"),
    document.querySelector("main"),
    document.scrollingElement,
    document.documentElement,
    document.body,
  ].filter((element): element is HTMLElement => element instanceof HTMLElement);

  const elements = Array.from(new Set(candidates));
  const reset = () => {
    elements.forEach((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
      element.scrollTo({ top: 0, left: 0, behavior });
    });
    window.scrollTo({ top: 0, left: 0, behavior });
  };

  reset();
  window.setTimeout(reset, 0);
  window.setTimeout(reset, 80);
  window.requestAnimationFrame(() => {
    reset();
    window.requestAnimationFrame(reset);
  });
}

function App() {
  const screenRef = useRef<HTMLDivElement | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("home");
  const [receiptData, setReceiptData] = useState<ThoughtReceipt[]>(loadReceipts);
  const [readerStep, setReaderStep] = useState<ReaderStep>("closed");
  const [scannedReceipt, setScannedReceipt] = useState<ThoughtReceipt | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<ThoughtReceipt | null>(null);
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilter | null>(null);
  const [filterOrigin, setFilterOrigin] = useState<TabKey | null>(null);
  const [analysisFocus, setAnalysisFocus] = useState<AnalysisFocus>(null);
  const [settlementView, setSettlementView] = useState<SettlementView>("monthly");
  const [isSettlementOpen, setIsSettlementOpen] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [highlightedReceiptId, setHighlightedReceiptId] = useState<string | null>(null);
  const [conversationCandidate, setConversationCandidate] =
    useState<ThoughtReceiptCandidate | null>(null);
  const [conversationMessage, setConversationMessage] = useState("");
  const [candidateIssueMessage, setCandidateIssueMessage] = useState("");
  const [issuedReceipt, setIssuedReceipt] = useState<IssuedThinkingReceipt | null>(null);
  const [receiptUrl, setReceiptUrl] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrMessage, setQrMessage] = useState("");
  const [ledgerMessage, setLedgerMessage] = useState("");
  const [receiptActionMessage, setReceiptActionMessage] = useState("");
  const [thinkingLedger, setThinkingLedger] =
    useState<IssuedThinkingReceipt[]>(loadThinkingLedger);
  const stats = useMemo(() => buildStats(receiptData), [receiptData]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(receiptData));
    } catch {
      // 保存できない環境でも、画面上の追加体験はそのまま使えます。
    }
  }, [receiptData]);

  useEffect(() => {
    if (activeTab !== "tax" || !analysisFocus) return;

    window.setTimeout(() => {
      document.getElementById(analysisFocus)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      setAnalysisFocus(null);
    }, 80);
  }, [activeTab, analysisFocus]);

  useEffect(() => {
    const restoredReceipt = restoreReceiptFromUrl();
    if (!restoredReceipt) return;

    setIssuedReceipt(restoredReceipt);
    setConversationCandidate(toReceiptCandidate(restoredReceipt));
    setConversationMessage("URLから思考レシートを復元しました。内容を確認して帳簿に保存できます。");
    setCandidateIssueMessage("復元済みのレシートです。");
    setIsSettlementOpen(false);
    setActiveTab("home");
    scrollScreenToTop("auto");
    clearDraftQueryParam();
  }, []);

  useEffect(() => {
    if (restoreReceiptFromUrl()) return;

    const draftConversation = restoreDraftConversationFromUrl();
    if (!draftConversation) return;

    try {
      localStorage.setItem(RAW_CONVERSATION_KEY, JSON.stringify(draftConversation));
    } catch {
      // URLからの取り込み自体は続けます。localStorage保存は再読み込み用の補助です。
    }

    setConversationCandidate(classifyConversation(draftConversation));
    setConversationMessage(
      "URLパラメータからAI会話データを読み込み、思考レシート候補を作成しました。内容を確認してから発行してください。",
    );
    setCandidateIssueMessage("");
    setIssuedReceipt(null);
    setLedgerMessage("");
    setIsSettlementOpen(false);
    setActiveTab("home");
    scrollScreenToTop("auto");
    clearDraftQueryParam();
  }, []);

  useEffect(() => {
    if (!issuedReceipt) {
      setReceiptUrl("");
      setQrCodeUrl("");
      setQrMessage("");
      return;
    }

    const url = createReceiptUrl(issuedReceipt);
    setReceiptUrl(url);
    setQrCodeUrl("");
    setQrMessage("");

    let cancelled = false;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320,
    })
      .then((dataUrl: string) => {
        if (cancelled) return;
        setQrCodeUrl(dataUrl);
      })
      .catch(() => {
        if (cancelled) return;
        setQrMessage("QRコードを生成できませんでした。レシート内容を短くして再発行してください。");
      });

    return () => {
      cancelled = true;
    };
  }, [issuedReceipt]);

  function openReader() {
    setIsSettlementOpen(false);
    setActiveTab("home");
    setReaderStep("scan");
    setScannedReceipt(null);
    setSaveMessage("");
    scrollScreenToTop("auto");
  }

  function closeReader() {
    setReaderStep("closed");
    setScannedReceipt(null);
    setActiveTab("home");
    scrollScreenToTop("auto");
  }

  function loadSampleReceipt() {
    setScannedReceipt(normalizeReceipt(sampleScannedReceipt));
    setReaderStep("confirm");
    scrollScreenToTop("auto");
  }

  function backToReaderScan() {
    setReaderStep("scan");
    scrollScreenToTop("auto");
  }

  function saveScannedReceipt() {
    if (!scannedReceipt) return;
    const receiptToSave = normalizeReceipt(scannedReceipt);

    setReceiptData((current) => {
      const exists = current.some((receipt) => receipt.id === receiptToSave.id);
      return exists ? current : [receiptToSave, ...current];
    });
    setReaderStep("closed");
    setScannedReceipt(null);
    setReceiptFilter(null);
    setFilterOrigin(null);
    setHighlightedReceiptId(receiptToSave.id);
    setIsSettlementOpen(false);
    setActiveTab("journal");
    setSaveMessage(
      "思考レシートを帳簿に保存し、仕訳帳に転記しました。",
    );
    showToast("思考帳簿に保存し、仕訳帳に転記しました。");
    scrollScreenToTop("auto");
    window.setTimeout(() => {
      setSaveMessage("");
      setHighlightedReceiptId(null);
    }, 5000);
  }

  function showReceipts(filter: ReceiptFilter | null = null) {
    setIsSettlementOpen(false);
    setReceiptFilter(filter);
    setFilterOrigin(filter ? activeTab : null);
    setActiveTab("receipts");
    setSaveMessage("");
    scrollScreenToTop("auto");
  }

  function showAnalysis(focus: AnalysisFocus = null) {
    setIsSettlementOpen(false);
    setActiveTab("tax");
    setSettlementView("monthly");
    setAnalysisFocus(focus);
    scrollScreenToTop("auto");
  }

  function clearReceiptFilter() {
    setReceiptFilter(null);
    setFilterOrigin(null);
    scrollScreenToTop("auto");
  }

  function returnFromFilter() {
    const target = filterOrigin;
    setReceiptFilter(null);
    setFilterOrigin(null);
    setSaveMessage("");

    if (target && target !== "receipts") {
      setActiveTab(target);
    }
    scrollScreenToTop("auto");
  }

  function handleTabChange(tab: TabKey) {
    setIsSettlementOpen(false);
    if (tab === "receipts") {
      setReceiptFilter(null);
      setFilterOrigin(null);
    }
    if (tab === "tax") {
      setSettlementView("monthly");
    }
    setActiveTab(tab);
    setSaveMessage("");
    setAnalysisFocus(null);
    scrollScreenToTop("auto");
  }

  function openSettlement() {
    setIsSettlementOpen(false);
    setActiveTab("tax");
    setSettlementView("monthly");
    setSaveMessage("");
    setAnalysisFocus(null);
    scrollScreenToTop("auto");
  }

  function closeSettlement() {
    setIsSettlementOpen(false);
    setActiveTab("home");
    scrollScreenToTop("auto");
  }

  function scrollScreenToTop(behavior: ScrollBehavior = "auto") {
    resetPageScroll(behavior, screenRef.current);
  }

  function closeReceiptDetail() {
    setSelectedReceipt(null);
    scrollScreenToTop("auto");
  }

  function showToast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(""), 4200);
  }

  function loadExtensionConversation() {
    try {
      const stored = localStorage.getItem(RAW_CONVERSATION_KEY);
      if (!stored) {
        setConversationCandidate(null);
        setCandidateIssueMessage("");
        setConversationMessage("拡張機能の会話データが見つかりません。");
        return;
      }

      const parsed = JSON.parse(stored) as RawConversation;
      const candidate = classifyConversation(parsed);
      setConversationCandidate(candidate);
      setCandidateIssueMessage("");
      setIssuedReceipt(null);
      setLedgerMessage("");
      setReceiptActionMessage("");
      setConversationMessage(
        "AIとの会話から、思考レシート候補を作成しました。内容を確認してから発行してください。",
      );
      setIsSettlementOpen(false);
      setActiveTab("home");
      scrollScreenToTop("smooth");
    } catch {
      setConversationCandidate(null);
      setCandidateIssueMessage("");
      setConversationMessage("会話データを読み込めませんでした。保存形式を確認してください。");
    }
  }

  function loadDemoConversation() {
    try {
      localStorage.setItem(RAW_CONVERSATION_KEY, JSON.stringify(demoConversation));
    } catch {
      // 画面上のデモ体験は localStorage に保存できない環境でも続けます。
    }

    setConversationCandidate(classifyConversation(demoConversation));
    setCandidateIssueMessage("");
    setIssuedReceipt(null);
    setLedgerMessage("");
    setReceiptActionMessage("");
    setConversationMessage("サンプル会話から、思考レシート候補を作成しました。");
    setIsSettlementOpen(false);
    setActiveTab("home");
    scrollScreenToTop("smooth");
  }

  function resetDemoData() {
    if (!window.confirm("デモデータをリセットしますか？")) return;

    try {
      localStorage.removeItem(RAW_CONVERSATION_KEY);
      localStorage.removeItem(THINKING_LEDGER_KEY);
    } catch {
      // localStorage が使えない環境でも、画面上の状態はリセットします。
    }

    setConversationCandidate(null);
    setConversationMessage("");
    setCandidateIssueMessage("");
    setIssuedReceipt(null);
    setReceiptUrl("");
    setQrCodeUrl("");
    setQrMessage("");
    setLedgerMessage("");
    setReceiptActionMessage("");
    setThinkingLedger([]);
    setSaveMessage("");
    setActiveTab("home");
    scrollScreenToTop("auto");
    showToast("デモデータをリセットしました。");
  }

  function updateConversationCandidate(field: CandidateField, value: string) {
    setConversationCandidate((current) =>
      current ? { ...current, [field]: value } : current,
    );
    setCandidateIssueMessage("");
    setIssuedReceipt(null);
    setLedgerMessage("");
    setReceiptActionMessage("");
  }

  function issueConversationCandidate() {
    if (!conversationCandidate) return;
    const receipt = createIssuedReceipt(conversationCandidate);
    setIssuedReceipt(receipt);
    setLedgerMessage("");
    setReceiptActionMessage("");
    setCandidateIssueMessage(
      "レシートを発行しました。QRコードを読み取ると同じレシート情報を復元できます。",
    );
  }

  function issueDemoQrReceipt() {
    try {
      localStorage.setItem(RAW_CONVERSATION_KEY, JSON.stringify(demoConversation));
    } catch {
      // localStorage が使えない環境でも、QR付きレシートの発行体験は続けます。
    }

    const candidate = classifyConversation(demoConversation);
    const receipt = createIssuedReceipt(candidate);

    setConversationCandidate(candidate);
    setConversationMessage("サンプル会話から、QR付き思考レシートを発行しました。");
    setCandidateIssueMessage("QRコード付きの思考レシートを発行しました。");
    setIssuedReceipt(receipt);
    setLedgerMessage("");
    setReceiptActionMessage("");
    setReaderStep("closed");
    setScannedReceipt(null);
    setIsSettlementOpen(false);
    setActiveTab("home");
    scrollScreenToTop("auto");
  }

  function saveIssuedReceiptToLedger() {
    if (!issuedReceipt) return;

    try {
      const receiptData = issuedReceipt;
      const current = loadThinkingLedger();
      const exists = current.some((receipt) => receipt.receiptNo === receiptData.receiptNo);
      const updatedLedger = exists ? current : [receiptData, ...current];
      localStorage.setItem(
        THINKING_LEDGER_KEY,
        JSON.stringify(updatedLedger),
      );
      console.log("saved receipt", receiptData);
      console.log("thinkingLedger", updatedLedger);
      setThinkingLedger(updatedLedger);
      setLedgerMessage("思考帳簿に保存しました");
      setLedgerMessage("帳簿に保存しました。");
    } catch {
      setLedgerMessage("帳簿に保存できませんでした。ブラウザの保存設定を確認してください。");
    }
  }

  function addSampleLedgerData() {
    try {
      const current = loadThinkingLedger();
      const receiptNos = new Set(current.map((receipt) => receipt.receiptNo));
      const samplesToAdd = sampleThinkingLedgerReceipts.filter(
        (receipt) => !receiptNos.has(receipt.receiptNo),
      );
      const updatedLedger = [...samplesToAdd, ...current];
      localStorage.setItem(THINKING_LEDGER_KEY, JSON.stringify(updatedLedger));
      setThinkingLedger(updatedLedger);
      showToast("開発確認用のサンプル帳簿データを追加しました。");
    } catch {
      showToast("サンプル帳簿データを追加できませんでした。");
    }
  }

  function printIssuedReceipt() {
    window.print();
  }

  async function copyReceiptUrl() {
    if (!receiptUrl) return;

    try {
      await navigator.clipboard.writeText(receiptUrl);
      setReceiptActionMessage("共有URLをコピーしました");
    } catch {
      setReceiptActionMessage("共有URLをコピーできませんでした。復元URL欄からコピーしてください。");
    }
  }

  return (
    <div className="app-shell">
      <main className="phone-frame">
        <Header onOpenSettlement={openSettlement} />
        <div className="screen" ref={screenRef}>
          {!isSettlementOpen && activeTab === "home" && !issuedReceipt && (
            <HomeScreen
              stats={stats}
              receipts={receiptData}
              onShowAnalysis={showAnalysis}
              onShowReceipts={showReceipts}
              onStartReader={openReader}
              onOpenReceipt={setSelectedReceipt}
            />
          )}
          {!isSettlementOpen && activeTab === "home" && issuedReceipt && (
            <section className="extension-import-card extension-import-card-top print-receipt-host">
              <IssuedReceiptPanel
                receipt={issuedReceipt}
                receiptUrl={receiptUrl}
                qrCodeUrl={qrCodeUrl}
                  qrMessage={qrMessage}
                  ledgerMessage={ledgerMessage}
                  actionMessage={receiptActionMessage}
                  onSave={saveIssuedReceiptToLedger}
                  onPrint={printIssuedReceipt}
                  onCopyUrl={copyReceiptUrl}
                />
            </section>
          )}
          {!isSettlementOpen && activeTab === "tax" && (
            settlementView === "monthly" ? (
              <AnalysisScreen
                ledgerReceipts={thinkingLedger}
                onAddSamples={addSampleLedgerData}
                onBackHome={() => {
                  setActiveTab("home");
                  scrollScreenToTop("auto");
                }}
                onShowAnnual={() => {
                  setSettlementView("annual");
                  scrollScreenToTop("auto");
                }}
              />
            ) : (
              <ThoughtSettlementScreen
                ledgerReceipts={thinkingLedger}
                onBackMonthly={() => {
                  setSettlementView("monthly");
                  scrollScreenToTop("auto");
                }}
                onAddSamples={addSampleLedgerData}
              />
            )
          )}
          {!isSettlementOpen && activeTab === "journal" && (
            <JournalScreen receipts={receiptData} highlightedReceiptId={highlightedReceiptId} />
          )}
          {!isSettlementOpen && activeTab === "receipts" && (
            <ReceiptsScreen
              receipts={receiptData}
              thinkingLedger={thinkingLedger}
              filter={receiptFilter}
              filterOrigin={filterOrigin}
              highlightedReceiptId={highlightedReceiptId}
              saveMessage={saveMessage}
              onClearFilter={clearReceiptFilter}
              onReturnFromFilter={returnFromFilter}
              onOpenReceipt={setSelectedReceipt}
              onAddSamples={addSampleLedgerData}
            />
          )}
        </div>
        <ToastMessage message={toastMessage} />
        <ReceiptReaderModal
          step={readerStep}
          receipt={scannedReceipt}
          onClose={closeReader}
          onBackToScan={backToReaderScan}
          onLoadSample={loadSampleReceipt}
          onIssueDemoQrReceipt={issueDemoQrReceipt}
          onSave={saveScannedReceipt}
        />
        <ReceiptDetailModal receipt={selectedReceipt} onClose={closeReceiptDetail} />
        <BottomNav activeTab={activeTab} onChange={handleTabChange} />
      </main>
    </div>
  );
}

function Header({ onOpenSettlement }: { onOpenSettlement: () => void }) {
  return (
    <header className="top-header">
      <div>
        <p className="eyebrow">思考帳簿アプリ</p>
        <h1>私とAIの確定申告</h1>
      </div>
      <button
        className="icon-button"
        type="button"
        aria-label="決算を開く"
        onClick={onOpenSettlement}
      >
        <BookOpenText size={20} />
      </button>
    </header>
  );
}

function ToastMessage({ message }: { message: string }) {
  if (!message) return null;

  return (
    <div className="toast-message" role="status">
      <CheckCircle2 size={18} />
      <p>{message}</p>
    </div>
  );
}

function ThoughtSettlementScreen({
  ledgerReceipts,
  onBackMonthly,
  onAddSamples,
}: {
  ledgerReceipts: IssuedThinkingReceipt[];
  onBackMonthly: () => void;
  onAddSamples: () => void;
}) {
  const ledgerStats = buildLedgerStats(ledgerReceipts);
  const examples = ledgerStats.decisions.slice(0, 3);

  return (
    <section className="stack settlement-screen">
      <button className="back-link" type="button" onClick={onBackMonthly}>
        <ArrowLeft size={16} />
        月次決算に戻る
      </button>

      <section className="settlement-hero">
        <div>
          <p className="eyebrow light">1年分のまとめ</p>
          <h2>私とAIの確定申告</h2>
        </div>
        <p>蓄積した記録から、自分とAIの関係を見つめ直します。</p>
      </section>

      {ledgerReceipts.length === 0 ? (
        <LedgerEmptyState onAddSamples={onAddSamples} />
      ) : (
        <>
          <section className="annual-report-card annual-report-card-primary">
            <SectionTitle icon={<BookOpenText size={18} />} title="AIとの関係コメント" />
            <p className="annual-report-comment">{ledgerStats.relationshipComment}</p>
          </section>

          <section className="annual-report-card">
            <SectionTitle icon={<BarChart3 size={18} />} title="全体の傾向" />
            <p className="annual-scope-note">thinkingLedger 全体をもとに集計しています。</p>
            <div className="annual-graph-stack">
              <AnnualTrendChart
                title="AIに求めた役割の内訳"
                description="AIを何のために使っていたかを見ます。"
                items={ledgerStats.roleBreakdown}
              />
              <AnnualTrendChart
                title="思考残高の傾向"
                description="AIとの距離感がどこに寄っていたかを見ます。"
                items={ledgerStats.balanceBreakdown}
              />
              <AnnualTrendChart
                title="使用AIの割合"
                description="主な相談相手になっていたAIを見ます。"
                items={ledgerStats.serviceBreakdown}
                maxItems={4}
              />
            </div>
          </section>

          <section className="annual-report-card">
            <SectionTitle icon={<BarChart3 size={18} />} title="総括メモ" />
            <div className="annual-insight-list">
              <SettlementBalance
                title="AIに頼りやすかった場面"
                body={`${ledgerStats.topTopic}のように、考えを形にする場面でAIを使う記録が目立ちます。`}
              />
              <SettlementBalance
                title="AIから得ていたもの"
                body={ledgerStats.aiAddedExamples[0] || "AIが足した視点はまだ少しずつ記録されています。"}
              />
              <SettlementBalance
                title="思考残高の傾向"
                body={ledgerStats.topBalance}
              />
            </div>
          </section>

          <section className="settlement-paper-card">
            <SectionTitle icon={<CheckCircle2 size={18} />} title="自分で決めたことの代表例" />
            <div className="ledger-detail-list">
              {examples.length > 0 ? (
                examples.map((decision) => (
                  <p key={decision}>{decision}</p>
                ))
              ) : (
                <p>まだ明確な判断は記録されていません</p>
              )}
            </div>
          </section>

          <section className="annual-report-card annual-report-card-primary">
            <SectionTitle icon={<Sparkles size={18} />} title="今年のAIとの関係" />
            <p className="annual-report-comment">{ledgerStats.yearSummary}</p>
          </section>
        </>
      )}
    </section>
  );
}

function SettlementMetric({ label, value }: { label: string; value: string }) {
  return (
    <article className="settlement-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SettlementBalance({ title, body }: { title: string; body: string }) {
  return (
    <div className="settlement-balance-row">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

function AnnualTrendChart({
  title,
  description,
  items,
  maxItems = 5,
}: {
  title: string;
  description: string;
  items: Array<{ label: string; count: number }>;
  maxItems?: number;
}) {
  const visibleItems = items.slice(0, maxItems);
  const maxCount = Math.max(...visibleItems.map((item) => item.count), 1);

  return (
    <div className="annual-trend-chart">
      <div className="annual-trend-heading">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {visibleItems.length === 0 ? (
        <p className="annual-empty-chart">まだ傾向を表示できる記録がありません。</p>
      ) : (
        <div className="annual-bars">
          {visibleItems.map((item) => (
            <div className="annual-bar-row" key={item.label}>
              <span>{item.label}</span>
              <div className="annual-bar-track" aria-hidden="true">
                <i style={{ width: `${Math.max((item.count / maxCount) * 100, 8)}%` }} />
              </div>
              <em>{item.count}件</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PreviousSettlementModal({ onClose }: { onClose: () => void }) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      modalRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, []);

  return (
    <div className="reader-backdrop" role="dialog" aria-modal="true">
      <div className="reader-modal" ref={modalRef}>
        <button className="reader-close" type="button" onClick={onClose} aria-label="閉じる">
          <X size={18} />
        </button>
        <div className="reader-panel">
          <button className="modal-back-action" type="button" onClick={onClose}>
            <ArrowLeft size={16} />
            6月の思考決算に戻る
          </button>
          <p className="eyebrow">思考決算書</p>
          <h2>{previousSettlement.title}</h2>
          <span className="status-pill complete">{previousSettlement.status}</span>
          <p className="reader-description">{previousSettlement.description}</p>
          <div className="confirm-receipt detail-receipt settlement-document">
            <div className="receipt-paper-header">
              <span>思考帳簿に保存済み</span>
              <strong>MONTH-05</strong>
            </div>
            <p className="settlement-summary">{previousSettlement.summary}</p>
            <div className="previous-metrics">
              {previousSettlement.metrics.map((metric) => (
                <SettlementMetric
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                />
              ))}
            </div>
            <div className="settlement-balance-list">
              {previousSettlement.balances.map((balance) => (
                <p className="previous-balance" key={balance}>
                  {balance}
                </p>
              ))}
            </div>
            <div className="receipt-barcode" aria-hidden="true" />
          </div>
          <button className="secondary-action" type="button" onClick={onClose}>
            6月の思考決算に戻る
          </button>
        </div>
      </div>
    </div>
  );
}

function HomeScreen({
  stats,
  receipts,
  onShowAnalysis,
  onShowReceipts,
  onStartReader,
  onOpenReceipt,
}: {
  stats: ReturnType<typeof buildStats>;
  receipts: ThoughtReceipt[];
  onShowAnalysis: (focus?: AnalysisFocus) => void;
  onShowReceipts: (filter?: ReceiptFilter | null) => void;
  onStartReader: () => void;
  onOpenReceipt: (receipt: ThoughtReceipt) => void;
}) {
  const latestReceipt = receipts[0];

  return (
    <section className="stack">
      <div className="hero-ledger">
        <div className="hero-copy">
          <p className="eyebrow light">2026年6月</p>
          <h2>今月は、企画・制作の場面でAIとの距離が近めでした。</h2>
          <p>
            AIに整理を頼る一方で、最後の判断は自分の言葉で残せています。
          </p>
        </div>
        <button
          className="hero-total pressable-surface"
          type="button"
          onClick={() => onShowAnalysis("analysis-screen-time")}
        >
          <Clock3 size={18} />
          <span>{formatHours(stats.totalMinutes)}</span>
          <small>AIスクリーンタイム</small>
          <em className="tap-hint hero-hint">見る</em>
        </button>
      </div>

      <button
        className="home-reader-card pressable-surface"
        type="button"
        onClick={onStartReader}
      >
        <span className="home-reader-icon">
          <Plus size={21} />
        </span>
        <span className="home-reader-copy">
          <strong>思考レシートを読み取る</strong>
          <small>AIとの会話を、思考帳簿に追加します。</small>
        </span>
        <ChevronRight size={20} />
      </button>

      <div className="metric-grid">
        <MetricCard
          icon={<ReceiptText size={18} />}
          label="思考レシート"
          value={`${stats.receiptCount}枚`}
          tone="blue"
          onClick={() => onShowReceipts(null)}
        />
        <MetricCard
          icon={<Coins size={18} />}
          label="今日の思考残高"
          value="納得 +3"
          tone="sky"
          onClick={() => latestReceipt && onOpenReceipt(latestReceipt)}
        />
      </div>

      <section className="card">
        <SectionTitle icon={<WalletCards size={18} />} title="今月のまとめ" />
        <div className="summary-list">
          <SummaryRow
            label="よく相談した科目"
            value={stats.topCategory}
            onClick={() =>
              onShowReceipts({ type: "category", value: stats.topCategory })
            }
          />
          <SummaryRow
            label="AIに求めた役割"
            value={stats.topRole}
            onClick={() => onShowReceipts({ type: "role", value: stats.topRole })}
          />
          <SummaryRow label="AIとの距離感" value="近め / ほどよい中心" />
          <SummaryRow
            label="自己判断残高"
            value={`${stats.selfDecisionCount}件 記録`}
            onClick={() => onShowReceipts({ type: "selfDecision" })}
          />
        </div>
      </section>

      <section className="card soft-blue">
        <SectionTitle icon={<Sparkles size={18} />} title="今月の振り返り" />
        <p className="reflection">
          今週は、気持ちを整えるためにAIを使う場面もありました。相談後の
          「自分で決めたこと」が残っているので、思考の流れをあとから見返せます。
        </p>
      </section>

      <section className="section-block">
        <SectionTitle icon={<NotebookTabs size={18} />} title="最近の思考レシート" />
        <div className="recent-list">
          {receipts.slice(0, 3).map((receipt) => (
            <MiniReceipt
              key={receipt.id}
              receipt={receipt}
              onClick={() => onOpenReceipt(receipt)}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function ConversationCandidateForm({
  candidate,
  issueMessage,
  onChange,
  onIssue,
}: {
  candidate: ThoughtReceiptCandidate;
  issueMessage: string;
  onChange: (field: CandidateField, value: string) => void;
  onIssue: () => void;
}) {
  return (
    <div className="candidate-form">
      <div className="candidate-form-heading">
        <span>STEP 2</span>
        <strong>自動仕分け結果を確認・修正</strong>
        <p>AIの評価ではなく、自分とAIの関係を記録するための下書きです。</p>
      </div>
      <CandidateFieldControl
        label="使用AI"
        field="aiService"
        value={candidate.aiService}
        onChange={onChange}
      />
      <CandidateFieldControl
        label="会話日時"
        field="conversationDate"
        value={candidate.conversationDate}
        onChange={onChange}
      />
      <CandidateFieldControl
        label="相談テーマ"
        field="topic"
        value={candidate.topic}
        onChange={onChange}
      />
      <CandidateFieldControl
        label="AIに求めた役割"
        field="aiRole"
        value={candidate.aiRole}
        options={aiRoleOptions}
        onChange={onChange}
      />
      <CandidateFieldControl
        label="AIが足したこと"
        field="aiAdded"
        value={candidate.aiAdded}
        multiline
        onChange={onChange}
      />
      <CandidateFieldControl
        label="自分で決めたこと"
        field="selfDecision"
        value={candidate.selfDecision}
        multiline
        onChange={onChange}
      />
      <CandidateFieldControl
        label="会話後の気持ち"
        field="feelingAfter"
        value={candidate.feelingAfter}
        options={feelingAfterOptions}
        onChange={onChange}
      />
      <CandidateFieldControl
        label="思考残高"
        field="thinkingBalance"
        value={candidate.thinkingBalance}
        options={thinkingBalanceOptions}
        onChange={onChange}
      />
      <button className="primary-action" type="button" onClick={onIssue}>
        <ReceiptText size={18} />
        レシートを発行する
      </button>
      {issueMessage && (
        <div className="candidate-message issued" role="status">
          <CheckCircle2 size={18} />
          <p>{issueMessage}</p>
        </div>
      )}
    </div>
  );
}

function CandidateFieldControl({
  label,
  field,
  value,
  options,
  multiline,
  onChange,
}: {
  label: string;
  field: CandidateField;
  value: string;
  options?: string[];
  multiline?: boolean;
  onChange: (field: CandidateField, value: string) => void;
}) {
  const id = `candidate-${field}`;

  if (options) {
    return (
      <label className="candidate-field" htmlFor={id}>
        <span>{label}</span>
        <select
          id={id}
          value={value}
          onChange={(event) => onChange(field, event.target.value)}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    );
  }

  if (multiline) {
    return (
      <label className="candidate-field" htmlFor={id}>
        <span>{label}</span>
        <textarea
          id={id}
          value={value}
          rows={3}
          onChange={(event) => onChange(field, event.target.value)}
        />
      </label>
    );
  }

  return (
    <label className="candidate-field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(field, event.target.value)}
      />
    </label>
  );
}

function IssuedReceiptPanel({
  receipt,
  receiptUrl,
  qrCodeUrl,
  qrMessage,
  ledgerMessage,
  actionMessage,
  onSave,
  onPrint,
  onCopyUrl,
}: {
  receipt: IssuedThinkingReceipt;
  receiptUrl: string;
  qrCodeUrl: string;
  qrMessage: string;
  ledgerMessage: string;
  actionMessage: string;
  onSave: () => void;
  onPrint: () => void;
  onCopyUrl: () => void;
}) {
  return (
    <section className="issued-receipt-panel">
      <h2 className="receipt-print-title">思考レシート</h2>
      <div className="issued-receipt-header">
        <span className="receipt-status-label">発行済み思考レシート</span>
        <span className="receipt-print-label">receiptNo</span>
        <strong>{receipt.receiptNo}</strong>
      </div>
      <div className="issued-receipt-body">
        <ReceiptInfoRow label="発行日時" value={receipt.issuedAt} />
        <ReceiptInfoRow label="使用AI" value={receipt.aiService} />
        <ReceiptInfoRow label="会話日時" value={receipt.conversationDate} />
        <ReceiptInfoRow label="相談テーマ" value={receipt.topic} />
        <ReceiptInfoRow label="AIに求めた役割" value={receipt.aiRole} />
        <ReceiptInfoRow
          label="AIが足したこと"
          value={receipt.aiAdded}
          printValue={shortenForPrint(receipt.aiAdded)}
        />
        <ReceiptInfoRow
          label="自分で決めたこと"
          value={receipt.selfDecision}
          printValue={shortenForPrint(receipt.selfDecision)}
        />
        <ReceiptInfoRow
          label="会話後の気持ち"
          value={receipt.feelingAfter}
          printValue={shortenForPrint(receipt.feelingAfter, 28)}
        />
        <ReceiptInfoRow label="思考残高" value={receipt.thinkingBalance} />
      </div>

      <div className="qr-panel">
        {qrCodeUrl ? (
          <img src={qrCodeUrl} alt="思考レシート復元用QRコード" />
        ) : (
          <div className="qr-placeholder">QRコード生成中</div>
        )}
        <p className="qr-description">
          このQRを読み取ると、紙の思考レシートから同じ記録に戻ることができます。
        </p>
        {qrMessage && <p className="qr-error">{qrMessage}</p>}
      </div>
      <p className="receipt-print-tagline">考えたあとに、レシートが出る。</p>

      <p className="receipt-save-hint">
        発行した思考レシートは、このまま思考帳簿に保存できます。
      </p>
      <button className="primary-action" type="button" onClick={onSave}>
        <WalletCards size={18} />
        帳簿に保存する
      </button>
      <div className="issued-receipt-actions">
        <button className="secondary-action" type="button" onClick={onPrint}>
          印刷する
        </button>
        <button className="secondary-action" type="button" onClick={onCopyUrl}>
          共有URLをコピーする
        </button>
      </div>
      {ledgerMessage && (
        <div className="candidate-message issued" role="status">
          <CheckCircle2 size={18} />
          <p>{ledgerMessage}</p>
        </div>
      )}
      {actionMessage && (
        <div className="candidate-message" role="status">
          <CheckCircle2 size={18} />
          <p>{actionMessage}</p>
        </div>
      )}
    </section>
  );
}

function ReceiptInfoRow({
  label,
  value,
  printValue,
}: {
  label: string;
  value: string;
  printValue?: string;
}) {
  return (
    <div className="receipt-info-row">
      <span>{label}</span>
      <strong className="receipt-value-screen">{value}</strong>
      <strong className="receipt-value-print">{printValue ?? value}</strong>
    </div>
  );
}

function shortenForPrint(value: string, maxLength = 46) {
  const compacted = compactText(value);
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength)}…`;
}

function LedgerEmptyState({ onAddSamples }: { onAddSamples: () => void }) {
  return (
    <section className="ledger-empty-state">
      <p>{emptyLedgerMessage}</p>
      <details className="dev-tools">
        <summary>開発用</summary>
        <button className="secondary-action" type="button" onClick={onAddSamples}>
          サンプル帳簿データを追加
        </button>
        <small>thinkingLedger に複数件のサンプルを保存します。</small>
      </details>
    </section>
  );
}

function LedgerBreakdown({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; count: number }>;
}) {
  return (
    <section className="ledger-breakdown-card">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p>-</p>
      ) : (
        <div className="ledger-breakdown-list">
          {items.map((item) => (
            <div className="ledger-breakdown-row" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.count}件</strong>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function LedgerReceiptDetail({
  receipt,
  onClose,
}: {
  receipt: IssuedThinkingReceipt;
  onClose: () => void;
}) {
  return (
    <section className="ledger-detail-card">
      <SectionTitle icon={<ReceiptText size={18} />} title="レシート詳細" />
      <div className="ledger-detail-list">
        <ConfirmRow label="receiptNo" value={receipt.receiptNo} />
        <ConfirmRow label="issuedAt" value={receipt.issuedAt} />
        <ConfirmRow label="使用AI" value={receipt.aiService} />
        <ConfirmRow label="会話日時" value={receipt.conversationDate} />
        <ConfirmRow label="相談テーマ" value={receipt.topic} />
        <ConfirmRow label="AIに求めた役割" value={receipt.aiRole} />
        <ConfirmRow label="AIが足したこと" value={receipt.aiAdded} />
        <ConfirmRow label="自分で決めたこと" value={receipt.selfDecision} />
        <ConfirmRow label="会話後の気持ち" value={receipt.feelingAfter} />
        <ConfirmRow label="思考残高" value={receipt.thinkingBalance} />
      </div>
      <button className="secondary-action compact-action" type="button" onClick={onClose}>
        詳細を閉じる
      </button>
    </section>
  );
}

function SavedLedgerList({
  receipts,
  onAddSamples,
}: {
  receipts: IssuedThinkingReceipt[];
  onAddSamples: () => void;
}) {
  const [selectedReceiptNo, setSelectedReceiptNo] = useState<string | null>(null);
  const selectedReceipt =
    receipts.find((receipt) => receipt.receiptNo === selectedReceiptNo) ?? null;

  return (
    <section className="saved-ledger-list">
      <SectionTitle icon={<WalletCards size={18} />} title="帳簿の概要" />
      <p className="screen-purpose">
        保存した思考レシートを一覧で確認できます。
        {receipts.length > 0 && <span className="ledger-count-inline">保存済み{receipts.length}件</span>}
      </p>
      {receipts.length === 0 ? (
        <LedgerEmptyState onAddSamples={onAddSamples} />
      ) : (
        <>
          <section className="saved-ledger-section">
            <h4>保存済みレシート一覧</h4>
            <div className="saved-ledger-items">
              {receipts.map((receipt) => (
                <article className="saved-ledger-item" key={receipt.receiptNo}>
                  <div>
                    <span>{receipt.receiptNo}</span>
                    <strong>{receipt.topic}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>issuedAt</dt>
                      <dd>{receipt.issuedAt}</dd>
                    </div>
                    <div>
                      <dt>aiService</dt>
                      <dd>{receipt.aiService}</dd>
                    </div>
                    <div>
                      <dt>aiRole</dt>
                      <dd>{receipt.aiRole}</dd>
                    </div>
                    <div>
                      <dt>thinkingBalance</dt>
                      <dd>{receipt.thinkingBalance}</dd>
                    </div>
                  </dl>
                  <button
                    className="secondary-action compact-action"
                    type="button"
                    onClick={() => setSelectedReceiptNo(receipt.receiptNo)}
                  >
                    詳細を見る
                  </button>
                </article>
              ))}
            </div>
          </section>

          {selectedReceipt && (
            <LedgerReceiptDetail
              receipt={selectedReceipt}
              onClose={() => setSelectedReceiptNo(null)}
            />
          )}
          <details className="dev-tools">
            <summary>開発用</summary>
            <button className="secondary-action" type="button" onClick={onAddSamples}>
              サンプル帳簿データを追加
            </button>
          </details>
        </>
      )}
    </section>
  );
}

function JournalScreen({
  receipts,
  highlightedReceiptId,
}: {
  receipts: ThoughtReceipt[];
  highlightedReceiptId: string | null;
}) {
  const [selectedReceipt, setSelectedReceipt] = useState<ThoughtReceipt | null>(null);
  const journalStats = useMemo(() => buildJournalStats(receipts), [receipts]);
  const journalReceipts = useMemo(() => getJournalReceipts(receipts), [receipts]);

  return (
    <section className="stack journal-screen">
      <div className="journal-header">
        <p className="eyebrow">思考仕訳帳</p>
        <h2>6月の思考仕訳</h2>
        <p>AIとの会話を、思考の取引として記帳します。</p>
      </div>

      <section className="journal-summary-card">
        <span>今月の思考量合計</span>
        <strong>{journalStats.total}</strong>
        <p>思考レシート{journalStats.receiptCount}件から集計</p>
        <small>各項目は1〜5の思考量として記録されます。</small>
      </section>

      <section className="card journal-ledger-card">
        <SectionTitle icon={<NotebookTabs size={18} />} title="思考量の内訳" />
        <JournalDonutChart items={journalStats.items} total={journalStats.total} />
        <div className="journal-breakdown-list">
          {journalStats.items.map((item) => (
            <div className="journal-breakdown-row" key={item.key}>
              <span className="journal-color-dot" style={{ backgroundColor: item.color }} />
              <div>
                <strong>{item.label}</strong>
                <small>{item.tags.join(" / ")}</small>
              </div>
              <em>{item.total}</em>
              <b>{item.percent}%</b>
            </div>
          ))}
        </div>
      </section>

      <section className="section-block">
        <SectionTitle icon={<BookOpenText size={18} />} title="最近の思考仕訳" />
        <div className="journal-card-list">
          {journalReceipts.slice(0, 4).map((receipt) => (
            <JournalReceiptCard
              key={receipt.id}
              receipt={receipt}
              isHighlighted={receipt.id === highlightedReceiptId}
              onClick={() => setSelectedReceipt(receipt)}
            />
          ))}
        </div>
      </section>

      <section className="card journal-explain-card">
        <SectionTitle icon={<WalletCards size={18} />} title="思考の取引とは" />
        <p>
          AIは、自分の外側から一時的に借りる思考資源です。人間は、目的や価値観、
          違和感を出す出資者です。AIとの会話によって生まれた答えや新しい視点は、
          思考資産として記録されます。
        </p>
      </section>

      <JournalDetailModal
        receipt={selectedReceipt}
        onClose={() => setSelectedReceipt(null)}
      />
    </section>
  );
}

function JournalDonutChart({
  items,
  total,
}: {
  items: ReturnType<typeof buildJournalStats>["items"];
  total: number;
}) {
  let offset = 25;

  return (
    <div className="journal-donut-layout">
      <svg viewBox="0 0 42 42" className="journal-donut" aria-label="思考仕訳の内訳">
        <circle cx="21" cy="21" r="15.915" className="donut-base" />
        {items.map((item) => {
          const dash = total > 0 ? (item.total / total) * 100 : 0;
          const segment = (
            <circle
              key={item.key}
              cx="21"
              cy="21"
              r="15.915"
              className="donut-segment"
              stroke={item.color}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={offset}
            />
          );
          offset -= dash;
          return segment;
        })}
        <text x="21" y="19.6" textAnchor="middle" className="journal-donut-total">
          {total}
        </text>
        <text x="21" y="25.2" textAnchor="middle" className="journal-donut-label">
          思考量
        </text>
      </svg>
      <p>AIとの会話が、どの思考の取引として記帳されているかを見ます。</p>
    </div>
  );
}

function JournalReceiptCard({
  receipt,
  isHighlighted,
  onClick,
}: {
  receipt: ThoughtReceipt;
  isHighlighted: boolean;
  onClick: () => void;
}) {
  const journal = getReceiptJournal(receipt);

  return (
    <button
      className={`journal-receipt-card pressable-surface ${isHighlighted ? "new-journal" : ""}`}
      type="button"
      onClick={onClick}
    >
      <div className="journal-receipt-top">
        <div>
          <span className="date">
            {formatDate(receipt.date)} / {receipt.category}
          </span>
          <strong>{receipt.topic}</strong>
        </div>
        <div className="receipt-actions">
          {isHighlighted && <span className="new-pill">追加されました</span>}
          <span className="detail-pill">詳細</span>
        </div>
      </div>

      <div className="journal-mini-lines">
        <JournalMiniLine
          label="AI借入"
          amount={journal.aiBorrowing.amount}
          text={journal.aiBorrowing.tags.join(" / ")}
        />
        <JournalMiniLine
          label="自己出資"
          amount={journal.selfCapital.amount}
          text={journal.selfCapital.tags.join(" / ")}
        />
        <JournalMiniLine
          label="思考資産"
          amount={journal.thoughtAsset.amount}
          text={journal.thoughtAsset.tags.join(" / ")}
        />
      </div>
      <p>{journal.selfDecisionBalance.text}</p>
    </button>
  );
}

function JournalMiniLine({
  label,
  amount,
  text,
}: {
  label: string;
  amount: number;
  text: string;
}) {
  return (
    <div className="journal-mini-line">
      <span>{label}：{amount}</span>
      <small>{text}</small>
    </div>
  );
}

function JournalDetailModal({
  receipt,
  onClose,
}: {
  receipt: ThoughtReceipt | null;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!receipt) return;
    window.requestAnimationFrame(() => {
      modalRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [receipt]);

  if (!receipt) return null;

  const journal = getReceiptJournal(receipt);

  return (
    <div className="reader-backdrop" role="dialog" aria-modal="true">
      <div className="reader-modal" ref={modalRef}>
        <button className="reader-close" type="button" onClick={onClose} aria-label="閉じる">
          <X size={18} />
        </button>
        <div className="reader-panel">
          <button className="modal-back-action" type="button" onClick={onClose}>
            <ArrowLeft size={16} />
            仕訳に戻る
          </button>
          <p className="eyebrow">思考の取引明細</p>
          <h2>思考仕訳明細</h2>
          <p className="reader-description">
            AIとの会話を、思考の取引として記帳した記録です。
          </p>
          <div className="journal-stamp-row">
            <span>記帳済み</span>
            <strong>{getJournalNumber(receipt.id)}</strong>
          </div>
          <div className="detail-note">
            <BookOpenText size={18} />
            <span>{receipt.topic}</span>
          </div>
          <div className="journal-basic-info">
            <JournalInfoRow label="日付" value={formatFullDate(receipt.date)} />
            <JournalInfoRow label="レシートID" value={receipt.id} />
            <JournalInfoRow label="相談テーマ" value={receipt.topic} />
            <JournalInfoRow label="相談科目" value={receipt.category} />
            <JournalInfoRow label="AIに求めた役割" value={receipt.aiRole} />
            <JournalInfoRow
              label="AIスクリーンタイム"
              value={`${receipt.aiScreenTimeMinutes}分`}
            />
          </div>
          <div className="journal-detail-list">
            <div className="journal-detail-heading">
              <span>区分</span>
              <span>記帳内容</span>
              <span>思考量</span>
            </div>
            <JournalDetailRow
              label="AI借入"
              amount={journal.aiBorrowing.amount}
              text={journal.aiBorrowing.tags.join(" / ")}
            />
            <JournalDetailRow
              label="自己出資"
              amount={journal.selfCapital.amount}
              text={journal.selfCapital.tags.join(" / ")}
            />
            <JournalDetailRow
              label="思考資産"
              amount={journal.thoughtAsset.amount}
              text={journal.thoughtAsset.tags.join(" / ")}
            />
            <JournalDetailRow
              label="思考支出"
              amount={journal.thoughtExpense.amount}
              text={journal.thoughtExpense.tags.join(" / ")}
            />
            <JournalDetailRow
              label="自己判断残高"
              amount={journal.selfDecisionBalance.amount}
              text={journal.selfDecisionBalance.text}
            />
          </div>
          <div className="journal-decision-highlight">
            <span>自己判断残高</span>
            <strong>{journal.selfDecisionBalance.text}</strong>
            <p>AIとの会話後に、自分の中に残った判断です。</p>
          </div>
          <button className="secondary-action" type="button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function JournalInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="journal-info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function JournalDetailRow({
  label,
  amount,
  text,
}: {
  label: string;
  amount: number;
  text: string;
}) {
  return (
    <div className="journal-detail-row">
      <div>
        <small>区分</small>
        <strong>{label}</strong>
        <small>記帳内容</small>
        <p>{text}</p>
      </div>
      <span>思考量 {amount}</span>
    </div>
  );
}

function AnalysisScreen({
  ledgerReceipts,
  onAddSamples,
  onBackHome,
  onShowAnnual,
}: {
  ledgerReceipts: IssuedThinkingReceipt[];
  onAddSamples: () => void;
  onBackHome: () => void;
  onShowAnnual: () => void;
}) {
  const monthlyStats = buildMonthlyLedgerStats(ledgerReceipts);
  const monthlyDecisions = monthlyStats.decisions.slice(0, 3);
  const hasMonthlyData = monthlyStats.count > 0;

  return (
    <section className="stack monthly-settlement-screen">
      <button className="back-link" type="button" onClick={onBackHome}>
        <ArrowLeft size={16} />
        レシートに戻る
      </button>

      <div className="monthly-settlement-heading">
        <div>
          <p className="eyebrow">決算</p>
          <h2>6月の思考決算</h2>
          <p className="screen-purpose">今月の思考レシートから、AIとの関わり方を振り返ります。</p>
        </div>
      </div>

      <section className="monthly-hero-card">
        <p className="eyebrow light">2026年6月</p>
        <h3>
          {hasMonthlyData
            ? `今月は、${monthlyStats.topTopic}の場面でAIを「${monthlyStats.topRole}」として使う記録が目立ちました。`
            : "今月の思考レシートを保存すると、AIとの関わり方がここにまとまります。"}
        </h3>
        <p>
          {hasMonthlyData
            ? `思考残高は「${monthlyStats.topBalance}」の傾向です。AIの提案を受け取りながら、自分で決めたことも残せています。`
            : "まずは1枚、思考レシートを帳簿に保存すると月次決算に反映されます。"}
        </p>
      </section>

      {ledgerReceipts.length === 0 ? (
        <LedgerEmptyState onAddSamples={onAddSamples} />
      ) : monthlyStats.count === 0 ? (
        <section className="monthly-report-card">
          <SectionTitle icon={<CalendarDays size={18} />} title="今月の記録" />
          <p className="monthly-insight">
            今月の思考レシートはまだありません。レシートを発行して帳簿に保存すると、月次決算に反映されます。
          </p>
        </section>
      ) : (
        <>
          <div className="monthly-metric-grid monthly-kpi-grid">
            <SettlementMetric label="今月のレシート数" value={`${monthlyStats.count}件`} />
            <SettlementMetric label="よく使ったAI" value={monthlyStats.topService} />
            <SettlementMetric label="よく使った役割" value={monthlyStats.topRole} />
            <SettlementMetric label="多かった相談テーマ" value={monthlyStats.topTopic} />
            <SettlementMetric label="思考残高" value={monthlyStats.topBalance} />
          </div>

          <section className="monthly-report-card">
            <SectionTitle icon={<Sparkles size={18} />} title="今月のまとめ" />
            <p className="reflection">{monthlyStats.summary}</p>
          </section>

          <div className="monthly-secondary-grid">
            <section className="monthly-report-card compact-monthly-card">
              <SectionTitle icon={<Bot size={18} />} title="特徴的だった使い方" />
              <p className="monthly-insight">
                {monthlyStats.featuredUse}
              </p>
            </section>

            <section className="monthly-report-card compact-monthly-card">
              <SectionTitle icon={<NotebookTabs size={18} />} title="代表的な相談テーマ" />
              <p className="monthly-topic-highlight">{monthlyStats.representativeTopic}</p>
            </section>
          </div>

          <section className="monthly-report-card monthly-decision-card">
            <SectionTitle icon={<CheckCircle2 size={18} />} title="自分で決めたこと" />
            {monthlyDecisions.length === 0 ? (
              <p className="saved-ledger-empty">今月の自己決定はまだ記録されていません。</p>
            ) : (
              <div className="ledger-detail-list">
                {monthlyDecisions.map((decision) => (
                  <p key={decision}>{decision}</p>
                ))}
              </div>
            )}
          </section>

          <section className="monthly-next-card">
            <SectionTitle icon={<ChevronRight size={18} />} title="次月に向けた一言" />
            <p>{monthlyStats.nextMonthNote}</p>
          </section>
        </>
      )}

      <section className="monthly-report-card settlement-switch-card">
        <SectionTitle icon={<BookOpenText size={18} />} title="年末の確定申告へ" />
        <p className="monthly-insight">
          月ごとの思考決算がたまると、年末に「2026年 私とAIの確定申告」としてまとめられます。
        </p>
        <button className="primary-action" type="button" onClick={onShowAnnual}>
          <BookOpenText size={18} />
          確定申告を見る
        </button>
      </section>

      <button className="secondary-action monthly-bottom-back" type="button" onClick={onBackHome}>
        <ArrowLeft size={16} />
        レシートに戻る
      </button>
    </section>
  );
}

function ReceiptsScreen({
  receipts,
  thinkingLedger,
  filter,
  filterOrigin,
  highlightedReceiptId,
  saveMessage,
  onClearFilter,
  onReturnFromFilter,
  onOpenReceipt,
  onAddSamples,
}: {
  receipts: ThoughtReceipt[];
  thinkingLedger: IssuedThinkingReceipt[];
  filter: ReceiptFilter | null;
  filterOrigin: TabKey | null;
  highlightedReceiptId: string | null;
  saveMessage: string;
  onClearFilter: () => void;
  onReturnFromFilter: () => void;
  onOpenReceipt: (receipt: ThoughtReceipt) => void;
  onAddSamples: () => void;
}) {
  const filteredReceipts = filter ? applyReceiptFilter(receipts, filter) : receipts;

  return (
    <section className="stack">
      <div className="receipt-title">
        <div>
          <p className="eyebrow">思考帳簿</p>
          <h2>AIとの会話を、帳簿のように振り返る</h2>
        </div>
      </div>

      {filter && (
        <button className="back-link" type="button" onClick={onReturnFromFilter}>
          <ArrowLeft size={16} />
          {getFilterBackLabel(filterOrigin)}
        </button>
      )}

      {saveMessage && (
        <div className="save-message" role="status">
          <CheckCircle2 size={18} />
          <p>{saveMessage}</p>
        </div>
      )}

      {filter && (
        <div className="filter-card">
          <div>
            <p className="eyebrow">絞り込み中</p>
            <strong>{getFilterTitle(filter)}</strong>
            <em>
              表示中 {filteredReceipts.length}件 / 全{receipts.length}件
            </em>
            <span>{getFilterDescription(filter)}</span>
          </div>
          <button type="button" onClick={onClearFilter}>
            絞り込みを解除
          </button>
        </div>
      )}

      <div className="receipt-ledger">
        {filteredReceipts.map((receipt) => (
          <ReceiptRow
            key={receipt.id}
            receipt={receipt}
            isHighlighted={receipt.id === highlightedReceiptId}
            onClick={() => onOpenReceipt(receipt)}
          />
        ))}
      </div>

      {filter && filteredReceipts.length > 0 && (
        <div className="bottom-return-card">
          <button type="button" onClick={onReturnFromFilter}>
            {getBottomReturnLabel(filterOrigin)}
          </button>
        </div>
      )}

      {filteredReceipts.length === 0 && (
        <section className="card empty-state">
          <SectionTitle icon={<ReceiptText size={18} />} title="該当するレシートはまだありません" />
          <p>絞り込みを解除すると、すべての思考レシートを見られます。</p>
        </section>
      )}

      {thinkingLedger.length > 0 && (
        <section className="section-block">
          <SavedLedgerList receipts={thinkingLedger} onAddSamples={onAddSamples} />
        </section>
      )}
    </section>
  );
}

function ReceiptReaderModal({
  step,
  receipt,
  onClose,
  onBackToScan,
  onLoadSample,
  onIssueDemoQrReceipt,
  onSave,
}: {
  step: ReaderStep;
  receipt: ThoughtReceipt | null;
  onClose: () => void;
  onBackToScan: () => void;
  onLoadSample: () => void;
  onIssueDemoQrReceipt: () => void;
  onSave: () => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (step === "closed") return;
    window.requestAnimationFrame(() => {
      modalRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [step]);

  if (step === "closed") return null;

  return (
    <div className="reader-backdrop" role="dialog" aria-modal="true">
      <div className="reader-modal" ref={modalRef}>
        <button className="reader-close" type="button" onClick={onClose} aria-label="閉じる">
          <X size={18} />
        </button>

        {step === "scan" && (
          <div className="reader-panel">
            <p className="eyebrow">思考レシート読み取り</p>
            <h2>思考レシートを読み取る</h2>
            <p className="reader-description">
              今回はプロトタイプとして、サンプルレシートを読み込んで思考帳簿に追加します。
            </p>
            <div className="scan-area">
              <div className="scan-corner top-left" />
              <div className="scan-corner top-right" />
              <div className="scan-corner bottom-left" />
              <div className="scan-corner bottom-right" />
              <ReceiptText size={34} />
              <strong>レシート下部のQRコードを読み取ってください</strong>
              <p>今回はプロトタイプのため、サンプルレシートを読み込みます。</p>
            </div>
            <button className="primary-action" type="button" onClick={onLoadSample}>
              <ScanLine size={18} />
              サンプルレシートを読み込む
            </button>
            <div className="reader-option-card">
              <div>
                <strong>QR付きレシートを作成</strong>
                <p>サンプル会話から、紙に印刷できる思考レシートを発行します。</p>
              </div>
              <button className="secondary-action" type="button" onClick={onIssueDemoQrReceipt}>
                QRコードを作成する
              </button>
            </div>
            <button className="secondary-action" type="button" onClick={onClose}>
              閉じる
            </button>
          </div>
        )}

        {step === "confirm" && receipt && (
          <div className="reader-panel">
            <button className="modal-back-action" type="button" onClick={onBackToScan}>
              <ArrowLeft size={16} />
              読み取りに戻る
            </button>
            <p className="eyebrow">読み取り確認</p>
            <h2>読み取り内容の確認</h2>
            <p className="reader-description">
              読み取った思考レシートを確認してください。必要に応じて内容を見直してから、思考帳簿に保存できます。
            </p>
            <div className="confirm-receipt">
              <ConfirmRow label="日付" value={receipt.date} />
              <ConfirmRow label="時間" value={receipt.time} />
              <ConfirmRow label="相談テーマ" value={receipt.topic} />
              <ConfirmRow label="相談科目" value={receipt.category} />
              <ConfirmRow label="AIに求めた役割" value={receipt.aiRole} />
              <ConfirmRow label="AIスクリーンタイム" value={`${receipt.aiScreenTimeMinutes}分`} />
              <ConfirmRow label="思考収入" value={receipt.gained} />
              <ConfirmRow label="会話前の気持ち" value={receipt.feelingBefore} />
              <ConfirmRow label="会話後の気持ち" value={receipt.feelingAfter} />
              <ConfirmRow label="AIとの距離感" value={receipt.distanceLevel} />
              <ConfirmRow label="自分で決めたこと" value={receipt.selfDecision} />
              <ConfirmRow label="思考残高" value={receipt.thoughtBalance} />
            </div>
            <ConfirmJournalBlock receipt={receipt} />
            <button className="primary-action" type="button" onClick={onSave}>
              <CheckCircle2 size={18} />
              思考帳簿に保存
            </button>
            <button className="secondary-action" type="button" onClick={onClose}>
              保存せず戻る
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmJournalBlock({ receipt }: { receipt: ThoughtReceipt }) {
  const journal = getReceiptJournal(receipt);

  return (
    <div className="confirm-journal">
      <SectionTitle icon={<BookOpenText size={18} />} title="思考仕訳" />
      <JournalConfirmLine
        label="AI借入"
        amount={journal.aiBorrowing.amount}
        text={journal.aiBorrowing.tags.join(" / ")}
      />
      <JournalConfirmLine
        label="自己出資"
        amount={journal.selfCapital.amount}
        text={journal.selfCapital.tags.join(" / ")}
      />
      <JournalConfirmLine
        label="思考資産"
        amount={journal.thoughtAsset.amount}
        text={journal.thoughtAsset.tags.join(" / ")}
      />
      <JournalConfirmLine
        label="思考支出"
        amount={journal.thoughtExpense.amount}
        text={journal.thoughtExpense.tags.join(" / ")}
      />
      <JournalConfirmLine
        label="自己判断残高"
        amount={journal.selfDecisionBalance.amount}
        text={journal.selfDecisionBalance.text}
      />
    </div>
  );
}

function JournalConfirmLine({
  label,
  amount,
  text,
}: {
  label: string;
  amount: number;
  text: string;
}) {
  return (
    <div className="journal-confirm-line">
      <strong>{label}：{amount}</strong>
      <span>{text}</span>
    </div>
  );
}

function ConfirmRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="confirm-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReceiptDetailModal({
  receipt,
  onClose,
}: {
  receipt: ThoughtReceipt | null;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!receipt) return;
    window.requestAnimationFrame(() => {
      modalRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [receipt]);

  if (!receipt) return null;

  return (
    <div className="reader-backdrop" role="dialog" aria-modal="true">
      <div className="reader-modal" ref={modalRef}>
        <button className="reader-close" type="button" onClick={onClose} aria-label="閉じる">
          <X size={18} />
        </button>
        <div className="reader-panel">
          <button className="modal-back-action" type="button" onClick={onClose}>
            <ArrowLeft size={16} />
            一覧に戻る
          </button>
          <p className="eyebrow">思考レシート詳細</p>
          <h2>{receipt.topic}</h2>
          <p className="reader-description">
            AIとの会話の前後で、何を受け取り、最後に自分の言葉で何を残したかを振り返れます。
          </p>
          <div className="detail-note">
            <BookOpenText size={18} />
            <span>{formatDate(receipt.date)} {receipt.time} の思考記録</span>
          </div>
          <div className="confirm-receipt detail-receipt">
            <div className="receipt-paper-header">
              <span>思考帳簿に保存済み</span>
              <strong>{receipt.id}</strong>
            </div>
            <ConfirmRow label="日付" value={receipt.date} />
            <ConfirmRow label="時間" value={receipt.time} />
            <ConfirmRow label="相談テーマ" value={receipt.topic} />
            <ConfirmRow label="相談科目" value={receipt.category} />
            <ConfirmRow label="AIに求めた役割" value={receipt.aiRole} />
            <ConfirmRow label="AIスクリーンタイム" value={`${receipt.aiScreenTimeMinutes}分`} />
            <ConfirmRow label="思考収入" value={receipt.gained} />
            <ConfirmRow label="会話前の気持ち" value={receipt.feelingBefore} />
            <ConfirmRow label="会話後の気持ち" value={receipt.feelingAfter} />
            <ConfirmRow label="AIとの距離感" value={receipt.distanceLevel} />
            <ConfirmRow label="自分で決めたこと" value={receipt.selfDecision} />
            <ConfirmRow label="思考残高" value={receipt.thoughtBalance} />
            <div className="receipt-barcode" aria-hidden="true" />
          </div>
          <button className="secondary-action" type="button" onClick={onClose}>
            一覧に戻る
          </button>
        </div>
      </div>
    </div>
  );
}

function BottomNav({
  activeTab,
  onChange,
}: {
  activeTab: TabKey;
  onChange: (tab: TabKey) => void;
}) {
  const tabs: Array<{ key: TabKey; icon: ReactNode }> = [
    { key: "home", icon: <ReceiptText size={20} /> },
    { key: "journal", icon: <BookOpenText size={20} /> },
    { key: "receipts", icon: <NotebookTabs size={20} /> },
    { key: "tax", icon: <CalendarDays size={20} /> },
  ];

  return (
    <nav className="bottom-nav" aria-label="画面切り替え">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={activeTab === tab.key ? "active" : ""}
          type="button"
          onClick={() => onChange(tab.key)}
        >
          {tab.icon}
          <span>{tabLabels[tab.key]}</span>
        </button>
      ))}
    </nav>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone: "blue" | "sky";
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="metric-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      {onClick && <small className="tap-hint">見る</small>}
    </>
  );

  if (onClick) {
    return (
      <button className={`metric-card ${tone} pressable-surface`} type="button" onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <article className={`metric-card ${tone}`}>
      {content}
    </article>
  );
}

function SectionTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="section-title">
      <span>{icon}</span>
      <h3>{title}</h3>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );

  if (onClick) {
    return (
      <button className="summary-row pressable-row" type="button" onClick={onClick}>
        {content}
      </button>
    );
  }

  return (
    <div className="summary-row">
      {content}
    </div>
  );
}

function MiniReceipt({
  receipt,
  onClick,
}: {
  receipt: ThoughtReceipt;
  onClick?: () => void;
}) {
  return (
    <button className="mini-receipt pressable-surface" type="button" onClick={onClick}>
      <div>
        <span className="date">{formatDate(receipt.date)}</span>
        <strong>{receipt.topic}</strong>
        <p>
          {receipt.category} / {receipt.aiRole}
        </p>
      </div>
      <ChevronRight size={18} />
    </button>
  );
}

function ReceiptRow({
  receipt,
  isHighlighted,
  onClick,
}: {
  receipt: ThoughtReceipt;
  isHighlighted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`receipt-row pressable-receipt ${isHighlighted ? "new-receipt" : ""}`}
      type="button"
      onClick={onClick}
    >
      <div className="receipt-topline">
        <div>
          <span className="date">
            {formatDate(receipt.date)} {receipt.time}
          </span>
          <h3>{receipt.topic}</h3>
        </div>
        <div className="receipt-actions">
          {isHighlighted && <span className="new-pill">追加されました</span>}
          <span className="distance-pill">{receipt.distanceLevel}</span>
          <span className="detail-pill">詳細</span>
        </div>
      </div>

      <div className="receipt-meta">
        <span>{receipt.category}</span>
        <span>{receipt.aiRole}</span>
        <span>{receipt.aiScreenTimeMinutes}分</span>
      </div>

      <div className="ledger-lines">
        <LedgerLine label="思考収入" value={receipt.gained} />
        <LedgerLine
          label="会話後の気持ち"
          value={`${receipt.feelingBefore} → ${receipt.feelingAfter}`}
        />
        <LedgerLine label="自己判断" value={receipt.selfDecision} />
        <LedgerLine label="思考残高" value={receipt.thoughtBalance} />
      </div>
    </button>
  );
}

function LedgerLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="ledger-line">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function DonutChart({
  data,
  onSelect,
}: {
  data: Array<{ label: string; value: number; color: string }>;
  onSelect?: (label: string) => void;
}) {
  let offset = 25;
  const total = data.reduce((sum, item) => sum + item.value, 0);

  return (
    <div className="donut-layout">
      <svg viewBox="0 0 42 42" className="donut" aria-label="相談科目別の割合">
        <circle cx="21" cy="21" r="15.915" className="donut-base" />
        {data.map((item) => {
          const dash = (item.value / total) * 100;
          const circle = (
            <circle
              key={item.label}
              cx="21"
              cy="21"
              r="15.915"
              className="donut-segment"
              stroke={item.color}
              strokeDasharray={`${dash} ${100 - dash}`}
              strokeDashoffset={offset}
            />
          );
          offset -= dash;
          return circle;
        })}
        <text x="21" y="20.4" textAnchor="middle" className="donut-number">
          {total}
        </text>
        <text x="21" y="25.3" textAnchor="middle" className="donut-label">
          枚
        </text>
      </svg>
      <div className="legend-list">
        {data.map((item) => (
          <button
            className="legend-row pressable-row"
            key={item.label}
            type="button"
            onClick={() => onSelect?.(item.label)}
          >
            <span style={{ backgroundColor: item.color }} />
            <p>{item.label}</p>
            <strong>{Math.round((item.value / total) * 100)}%</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function HorizontalBars({
  data,
  onSelect,
}: {
  data: Array<{ label: string; value: number; color: string }>;
  onSelect?: (label: string) => void;
}) {
  const max = Math.max(...data.map((item) => item.value));

  return (
    <div className="bar-list">
      {data.map((item) => (
        <button
          className="bar-row pressable-row"
          key={item.label}
          type="button"
          onClick={() => onSelect?.(item.label)}
        >
          <div className="bar-label">
            <span>{item.label}</span>
            <div className="bar-value-group">
              <small>見る</small>
              <strong>{item.value}回</strong>
            </div>
          </div>
          <div className="bar-track">
            <div
              className="bar-fill"
              style={{ width: `${(item.value / max) * 100}%`, backgroundColor: item.color }}
            />
          </div>
        </button>
      ))}
    </div>
  );
}

function MonthlyBars({ data }: { data: Array<{ month: string; minutes: number }> }) {
  const max = Math.max(...data.map((item) => item.minutes));

  return (
    <div className="monthly-bars">
      {data.map((item) => (
        <div className="month-col" key={item.month}>
          <div className="month-bar-wrap">
            <div
              className="month-bar"
              style={{ height: `${(item.minutes / max) * 100}%` }}
            />
          </div>
          <span>{item.month}</span>
          <strong>{item.minutes}</strong>
        </div>
      ))}
    </div>
  );
}

function LineGraph({ data }: { data: Array<{ label: string; score: number }> }) {
  const width = 300;
  const height = 130;
  const points = data.map((item, index) => {
    const x = 18 + (index * (width - 36)) / (data.length - 1);
    const y = height - 18 - (item.score / 100) * (height - 36);
    return { ...item, x, y };
  });
  const d = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <div className="line-card">
      <svg viewBox={`0 0 ${width} ${height}`} aria-label="気持ちの変化">
        <path className="line-grid" d="M18 34 H282 M18 70 H282 M18 106 H282" />
        <path className="line-path" d={d} />
        {points.map((point) => (
          <g key={point.label}>
            <circle cx={point.x} cy={point.y} r="4.5" />
            <text x={point.x} y="124" textAnchor="middle">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
      <p>会話後に「納得」「安心」「前向き」が増えている流れです。</p>
    </div>
  );
}

function MoodInsight({ stats }: { stats: ReturnType<typeof buildStats> }) {
  return (
    <div className="mood-insight">
      <div>
        <span>気持ちの変化</span>
        <strong>{stats.moodChangeCount}件</strong>
      </div>
      <div>
        <span>会話前に多かった気持ち</span>
        <strong>{stats.topFeelingBefore}</strong>
      </div>
      <div>
        <span>会話後に多かった気持ち</span>
        <strong>{stats.topFeelingAfter}</strong>
      </div>
      <div>
        <span>見通しにつながった記録</span>
        <strong>{stats.reframedMoodCount}件</strong>
      </div>
      <p>
        AIとの会話の前後で、気持ちがどのように動いたかを記録します。
        不安や迷いが、納得や見通しにつながったレシートを振り返れます。
      </p>
    </div>
  );
}

function classifyConversation(raw: RawConversation): ThoughtReceiptCandidate {
  const messages = Array.isArray(raw.messages)
    ? raw.messages.filter((message) => typeof message.text === "string")
    : [];
  const userMessages = messages.filter((message) => message.role === "user");
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  const allText = messages.map((message) => message.text ?? "").join(" ");
  const assistantText = assistantMessages.map((message) => message.text ?? "").join(" ");
  const selfDecision = inferSelfDecision(userMessages);

  return {
    aiService: inferAiService(raw),
    conversationDate: compactText(raw.capturedAt) || formatCurrentConversationDate(),
    topic:
      compactText(raw.conversationTitle) ||
      summarizeText(userMessages[0]?.text ?? "無題の相談", 30),
    aiRole: inferAiRole(allText),
    aiAdded: inferAiAdded(assistantText, allText),
    selfDecision,
    feelingAfter: inferFeelingAfter(allText, selfDecision),
    thinkingBalance: inferThinkingBalance(userMessages.length, assistantMessages.length, selfDecision),
  };
}

function inferAiService(raw: RawConversation) {
  const service = compactText(raw.aiService);
  if (service) return service;

  const url = compactText(raw.url).toLowerCase();
  if (url.includes("chatgpt.com")) return "ChatGPT";
  if (url.includes("gemini.google.com")) return "Gemini";
  if (url.includes("claude.ai")) return "Claude";
  if (url.includes("perplexity.ai")) return "Perplexity";
  if (url.includes("notebooklm.google.com")) return "NotebookLM";
  if (url.includes("copilot.microsoft.com")) return "Copilot";
  return "その他";
}

function inferAiRole(text: string) {
  const lower = text.toLowerCase();
  if (hasAny(lower, ["デザイン", "ファーストビュー", "ui", "ux", "コピー", "導線", "layout"])) {
    return "デザイナー";
  }
  if (hasAny(lower, ["調査", "調べ", "リサーチ", "出典", "source", "research"])) {
    return "調査役";
  }
  if (hasAny(lower, ["教えて", "説明", "学習", "先生", "lecture", "explain"])) {
    return "先生";
  }
  if (hasAny(lower, ["編集", "校正", "文章", "言い換え", "rewrite", "edit"])) {
    return "編集者";
  }
  if (hasAny(lower, ["不安", "気持ち", "悩み", "相談", "安心", "つらい"])) {
    return "カウンセラー";
  }
  if (hasAny(lower, ["戦略", "方針", "優先", "意思決定", "判断", "計画"])) {
    return "参謀";
  }
  if (hasAny(lower, ["一緒に", "相棒", "伴走", "ペア"])) {
    return "相棒";
  }
  if (hasAny(lower, ["壁打ち", "案", "アイデア", "整理"])) {
    return "壁打ち相手";
  }
  return "その他";
}

function inferAiAdded(assistantText: string, allText: string) {
  const additions: string[] = [];
  if (hasAny(allText, ["思考レシート", "確定申告"]) && assistantText.includes("帳簿")) {
    return "レシート・帳簿・確定申告という体験構造を整理した";
  }
  if (hasAny(assistantText, ["改善案", "案を", "提案"])) additions.push("改善案の提示");
  if (assistantText.includes("コピー")) additions.push("コピーの整理");
  if (assistantText.includes("導線")) additions.push("導線の整理");
  if (assistantText.includes("目的")) additions.push("目的の明確化");
  if (hasAny(allText, ["ファーストビュー", "デザイン改善"])) {
    additions.push("ファーストビュー改善の視点");
  }

  const uniqueAdditions = Array.from(new Set(additions));
  if (uniqueAdditions.length > 0) {
    return `${uniqueAdditions.join("、")}を追加した`;
  }

  return summarizeText(assistantText, 64) || "AIが追加した視点はまだ整理されていません";
}

function inferSelfDecision(userMessages: ConversationMessage[]) {
  const decisionKeywords = [
    "決めた",
    "決めます",
    "採用",
    "進めます",
    "進める",
    "変更する",
    "変更します",
    "優先",
    "ベースに",
  ];
  const decision = [...userMessages]
    .reverse()
    .map((message) => compactText(message.text))
    .find((text) => hasAny(text, decisionKeywords));

  if (!decision) return "まだ明確な判断は記録されていません";
  return normalizeDecisionText(decision);
}

function normalizeDecisionText(text: string) {
  const normalized = text
    .replace(/します。?$/, "する")
    .replace(/進めます。?$/, "進める")
    .replace(/採用します。?$/, "採用する")
    .replace(/[。.!！?？]$/, "");

  if (hasAny(normalized, ["決めた", "決めます", "ことにした"])) {
    return normalized.replace("決めます", "決めた");
  }
  return `${normalized}ことに決めた`;
}

function inferFeelingAfter(allText: string, selfDecision: string) {
  if (selfDecision !== "まだ明確な判断は記録されていません") {
    return hasAny(allText, ["案", "視点", "改善", "提案", "コンセプト", "体験構造"])
      ? "考えが広がった"
      : "すっきりした";
  }
  if (hasAny(allText, ["不安", "安心", "大丈夫"])) return "安心した";
  if (hasAny(allText, ["迷", "保留", "悩"])) return "まだ保留";
  return "まだ保留";
}

function inferThinkingBalance(userCount: number, assistantCount: number, selfDecision: string) {
  if (selfDecision === "まだ明確な判断は記録されていません") return "まだ保留";
  if (userCount > 0 && assistantCount > 0) return "一緒に考えた";
  if (assistantCount > userCount) return "AIの助けが多い";
  return "自分の判断が多い";
}

function hasAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function summarizeText(text: string, maxLength: number) {
  const compacted = compactText(text);
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, maxLength)}…`;
}

function compactText(text?: string) {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function formatCurrentConversationDate() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}/${pad(now.getMonth() + 1)}/${pad(now.getDate())} ${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

function createIssuedReceipt(candidate: ThoughtReceiptCandidate): IssuedThinkingReceipt {
  return {
    ...candidate,
    receiptNo: `TR-${Date.now().toString(36).toUpperCase()}`,
    issuedAt: formatCurrentConversationDate(),
  };
}

function toReceiptCandidate(receipt: IssuedThinkingReceipt): ThoughtReceiptCandidate {
  return {
    aiService: receipt.aiService,
    conversationDate: receipt.conversationDate,
    topic: receipt.topic,
    aiRole: receipt.aiRole,
    aiAdded: receipt.aiAdded,
    selfDecision: receipt.selfDecision,
    feelingAfter: receipt.feelingAfter,
    thinkingBalance: receipt.thinkingBalance,
  };
}

function createReceiptUrl(receipt: IssuedThinkingReceipt) {
  if (typeof window === "undefined") return "";
  const payload = encodeReceiptPayload(receipt);
  return `${window.location.origin}${window.location.pathname}#${RECEIPT_HASH_KEY}=${payload}`;
}

function clearDraftQueryParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(DRAFT_QUERY_KEY)) return;
  url.searchParams.delete(DRAFT_QUERY_KEY);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState({}, "", nextUrl);
}

function restoreDraftConversationFromUrl() {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const draft = params.get(DRAFT_QUERY_KEY);
  if (!draft) return null;

  return parseDraftConversation(draft);
}

function parseDraftConversation(draft: string) {
  const candidates = Array.from(
    new Set([
      draft,
      safeDecodeURIComponent(draft),
      decodeBase64UrlUtf8(draft),
    ].filter((value): value is string => Boolean(value))),
  );

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as RawConversation;
      if (isRawConversation(parsed)) return parsed;
    } catch {
      // 次のデコード候補を試します。
    }
  }

  return null;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function decodeBase64UrlUtf8(value: string) {
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function isRawConversation(value: unknown): value is RawConversation {
  if (!value || typeof value !== "object") return false;
  const conversation = value as RawConversation;
  return (
    (conversation.messages === undefined || Array.isArray(conversation.messages)) &&
    (conversation.aiService === undefined || typeof conversation.aiService === "string") &&
    (conversation.url === undefined || typeof conversation.url === "string") &&
    (conversation.capturedAt === undefined || typeof conversation.capturedAt === "string") &&
    (conversation.conversationTitle === undefined ||
      typeof conversation.conversationTitle === "string")
  );
}

function restoreReceiptFromUrl() {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const payload = params.get(RECEIPT_HASH_KEY);
  if (!payload) return null;

  try {
    const parsed = JSON.parse(decodeReceiptPayload(payload)) as IssuedThinkingReceipt;
    return normalizeIssuedReceipt(parsed);
  } catch {
    return null;
  }
}

function encodeReceiptPayload(receipt: IssuedThinkingReceipt) {
  const bytes = new TextEncoder().encode(JSON.stringify(receipt));
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeReceiptPayload(payload: string) {
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = window.atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function loadThinkingLedger() {
  try {
    const stored = localStorage.getItem(THINKING_LEDGER_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as IssuedThinkingReceipt[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeIssuedReceipt)
      .filter((receipt): receipt is IssuedThinkingReceipt => Boolean(receipt));
  } catch {
    return [];
  }
}

function isIssuedReceipt(receipt: unknown): receipt is IssuedThinkingReceipt {
  return Boolean(normalizeIssuedReceipt(receipt));
}

function normalizeIssuedReceipt(receipt: unknown): IssuedThinkingReceipt | null {
  if (!receipt || typeof receipt !== "object") return null;
  const target = receipt as Record<string, unknown>;
  const receiptNo = target.receiptNo ?? target.id;
  const requiredFields = [
    "issuedAt",
    "aiService",
    "conversationDate",
    "topic",
    "aiRole",
    "aiAdded",
    "selfDecision",
    "feelingAfter",
    "thinkingBalance",
  ];
  const isValid =
    typeof receiptNo === "string" &&
    requiredFields.every((key) => typeof target[key] === "string");

  if (!isValid) return null;

  return {
    receiptNo,
    issuedAt: target.issuedAt,
    aiService: target.aiService,
    conversationDate: target.conversationDate,
    topic: target.topic,
    aiRole: target.aiRole,
    aiAdded: target.aiAdded,
    selfDecision: target.selfDecision,
    feelingAfter: target.feelingAfter,
    thinkingBalance: target.thinkingBalance,
  } as IssuedThinkingReceipt;
}

function buildLedgerStats(data: IssuedThinkingReceipt[]) {
  const serviceBreakdown = countLedgerValues(data.map((receipt) => receipt.aiService));
  const roleBreakdown = countLedgerValues(data.map((receipt) => receipt.aiRole));
  const feelingBreakdown = countLedgerValues(data.map((receipt) => receipt.feelingAfter));
  const balanceBreakdown = countLedgerValues(data.map((receipt) => receipt.thinkingBalance));
  const topService = topLedgerCountLabel(data.map((receipt) => receipt.aiService));
  const topTopic = topLedgerCountLabel(data.map((receipt) => receipt.topic));
  const topRole = topLedgerCountLabel(data.map((receipt) => receipt.aiRole));
  const topFeeling = topLedgerCountLabel(data.map((receipt) => receipt.feelingAfter));
  const topBalance = topLedgerCountLabel(data.map((receipt) => receipt.thinkingBalance));
  const decisions = uniqueLedgerTexts(data.map((receipt) => receipt.selfDecision));
  const aiAddedExamples = uniqueLedgerTexts(data.map((receipt) => receipt.aiAdded)).slice(0, 3);
  const decisionCount = decisions.filter(
    (decision) => !decision.includes("まだ明確な判断は記録されていません"),
  ).length;

  return {
    count: data.length,
    topService,
    topTopic,
    topRole,
    topFeeling,
    topBalance,
    serviceBreakdown,
    roleBreakdown,
    feelingBreakdown,
    balanceBreakdown,
    decisions,
    aiAddedExamples,
    relationshipComment: buildRelationshipComment({
      count: data.length,
      topService,
      topTopic,
      topRole,
      topFeeling,
      topBalance,
      decisionCount,
    }),
    yearSummary: buildYearSummary({
      topRole,
      topBalance,
      decisionCount,
    }),
  };
}

function topLedgerCountLabel(values: string[]) {
  return countLedgerValues(values)[0]?.label ?? "-";
}

function countLedgerValues(values: string[]) {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    const label = normalizeLedgerLabel(value);
    if (!label) return acc;
    acc[label] = (acc[label] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
    .map(([label, count]) => ({ label, count }));
}

function normalizeLedgerLabel(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-" || trimmed === "未記録") return "";
  return trimmed;
}

function uniqueLedgerTexts(values: string[]) {
  const seen = new Set<string>();
  return values
    .map(normalizeLedgerLabel)
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

function buildMonthlyLedgerStats(data: IssuedThinkingReceipt[]) {
  const currentMonthKey = getCurrentMonthKey();
  const targetReceipts = data.filter(
    (receipt) => getLedgerReceiptMonthKey(receipt) === currentMonthKey,
  );
  const stats = buildLedgerStats(targetReceipts);

  return {
    ...stats,
    monthKey: currentMonthKey,
    summary: buildMonthlyLedgerSummary(stats),
    featuredUse: buildMonthlyFeaturedUse(stats),
    representativeTopic: stats.topTopic === "-" ? "まだ代表的な相談テーマはありません。" : stats.topTopic,
    nextMonthNote: buildNextMonthNote(stats),
  };
}

function buildMonthlyLedgerSummary(stats: ReturnType<typeof buildLedgerStats>) {
  if (stats.count === 0) {
    return "今月はまだ保存済みの思考レシートがありません。会話をレシートとして発行し、帳簿に保存すると月次決算に反映されます。";
  }

  return `今月は${stats.topService}を「${stats.topRole}」として使う記録が多く、思考残高は「${stats.topBalance}」の傾向です。AIの提案を受け取りながら、自分で決めたことも残っています。`;
}

function buildMonthlyFeaturedUse(stats: ReturnType<typeof buildLedgerStats>) {
  if (stats.count === 0) return "今月の特徴はまだ記録されていません。";
  return `${stats.topRole}としてAIを使い、${stats.topTopic}について考えを整理する場面が目立ちました。`;
}

function buildNextMonthNote(stats: ReturnType<typeof buildLedgerStats>) {
  if (stats.count === 0) {
    return "まずは1枚、思考レシートを帳簿に保存するところから始められます。";
  }

  if (stats.topBalance === "AIの助けが多い") {
    return "次月は、AIが出した案のうち何を自分で選んだかをもう少し残すと、判断の流れが見えやすくなります。";
  }

  return "次月も、AIが足した視点と自分で選んだ方向性を一緒に残すと振り返りやすくなります。";
}

function buildRelationshipComment({
  count,
  topService,
  topTopic,
  topRole,
  topFeeling,
  topBalance,
  decisionCount,
}: {
  count: number;
  topService: string;
  topTopic: string;
  topRole: string;
  topFeeling: string;
  topBalance: string;
  decisionCount: number;
}) {
  if (count === 0) return emptyLedgerMessage;

  return `あなたは${topService}を単なる答えを出す道具ではなく、「${topRole}」として考えを整理する相手として使う傾向があります。AIの視点を取り入れながらも、最後の方向性は自分で決める記録が${decisionCount}件残っています。思考残高は「${topBalance}」の傾向です。`;
}

function buildYearSummary({
  topRole,
  topBalance,
  decisionCount,
}: {
  topRole: string;
  topBalance: string;
  decisionCount: number;
}) {
  return `今年のAIとの関係は、「${topRole}」として一緒に考えながら、最後は自分で判断する関係でした。自分で決めたことは${decisionCount}件残っており、思考残高は「${topBalance}」として記録されています。`;
}

function getCurrentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function getLedgerReceiptMonthKey(receipt: IssuedThinkingReceipt) {
  return getMonthKeyFromText(receipt.issuedAt) ?? getMonthKeyFromText(receipt.conversationDate);
}

function getMonthKeyFromText(value: string) {
  const match = value.match(/(\d{4})[/-年.](\d{1,2})/);
  if (!match) return null;

  const [, year, month] = match;
  return `${year}-${month.padStart(2, "0")}`;
}

function buildSettlementStats(data: ThoughtReceipt[]) {
  const juneReceipts = data.filter((receipt) => receipt.date.startsWith("2026-06"));
  const targetReceipts = juneReceipts.length > 0 ? juneReceipts : data;
  const totalMinutes = targetReceipts.reduce(
    (sum, item) => sum + item.aiScreenTimeMinutes,
    0,
  );
  const categoryCounts = countBy(targetReceipts, "category");
  const roleCounts = countBy(targetReceipts, "aiRole");
  const topCategory = topCountLabel(categoryCounts);
  const topRole = topCountLabel(roleCounts);
  const selfDecisionCount = targetReceipts.filter(hasSelfDecisionBalance).length;
  const moodChangeCount = targetReceipts.filter(hasMoodChange).length;
  const reframedMoodCount = targetReceipts.filter(isReframedMoodChange).length;
  const gainedSummary = topCountLabels(countBy(targetReceipts, "gained"), 3).join("、");
  const distanceText = getDistanceSummary(targetReceipts);

  return {
    totalMinutes,
    receiptCount: targetReceipts.length,
    topCategory,
    topRole,
    selfDecisionCount,
    moodChangeCount,
    reframedMoodCount,
    gainedSummary,
    summary: `今月は、${topCategory}の相談が多く、AIを「${topRole}」として使う場面が目立ちました。AIとの距離は${distanceText}でしたが、自己判断残高も${selfDecisionCount}件あり、自分の言葉で判断を残せています。気持ちの変化が見られたレシートは${moodChangeCount}件でした。`,
  };
}

// サンプル配列を集計して、ホームと分析画面で使う数字に変換します。
function buildStats(data: ThoughtReceipt[]) {
  const totalMinutes = data.reduce((sum, item) => sum + item.aiScreenTimeMinutes, 0);
  const categoryCounts = countBy(data, "category");
  const roleCounts = countBy(data, "aiRole");
  const feelingBeforeCounts = countBy(data, "feelingBefore");
  const feelingAfterCounts = countBy(data, "feelingAfter");
  const moodChangeReceipts = data.filter(hasMoodChange);
  const reframedMoodCount = data.filter(isReframedMoodChange).length;
  const colors = [
    "#2563EB",
    "#38BDF8",
    "#0EA5E9",
    "#93C5FD",
    "#7DD3FC",
    "#60A5FA",
    "#BAE6FD",
    "#1D4ED8",
  ];

  const categoryShare = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => ({ label, value, color: colors[index] }));

  const roleShare = Object.entries(roleCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => ({ label, value, color: colors[index] }));

  return {
    totalMinutes,
    receiptCount: data.length,
    selfDecisionCount: data.filter((item) => item.selfDecision).length,
    topCategory: categoryShare[0]?.label ?? "-",
    topRole: roleShare[0]?.label ?? "-",
    categoryShare,
    roleShare,
    monthlyScreenTime: buildMonthlyScreenTime(data),
    moodChangeCount: moodChangeReceipts.length,
    topFeelingBefore: topCountLabel(feelingBeforeCounts),
    topFeelingAfter: topCountLabel(feelingAfterCounts),
    reframedMoodCount,
  };
}

function buildMonthlyScreenTime(data: ThoughtReceipt[]) {
  const receiptMonths = data.reduce<Record<string, number>>((acc, receipt) => {
    const [, month] = receipt.date.split("-");
    const label = `${Number(month)}月`;
    acc[label] = (acc[label] ?? 0) + receipt.aiScreenTimeMinutes;
    return acc;
  }, {});

  const baseMonths = new Set(baseMonthlyScreenTime.map((item) => item.month));
  const dynamicMonths = Object.entries(receiptMonths)
    .filter(([month]) => !baseMonths.has(month))
    .map(([month, minutes]) => ({ month, minutes }))
    .sort((a, b) => Number(a.month.replace("月", "")) - Number(b.month.replace("月", "")));

  return [
    ...baseMonthlyScreenTime,
    ...dynamicMonths,
  ];
}

function applyReceiptFilter(data: ThoughtReceipt[], filter: ReceiptFilter) {
  switch (filter.type) {
    case "category":
      return data.filter((receipt) => receipt.category === filter.value);
    case "role":
      return data.filter((receipt) => receipt.aiRole === filter.value);
    case "moodChange":
      return data.filter(hasMoodChange);
    case "selfDecision":
      return data.filter(hasSelfDecisionBalance);
  }
}

function getFilterTitle(filter: ReceiptFilter) {
  switch (filter.type) {
    case "category":
      return `相談科目：${filter.value} のレシート`;
    case "role":
      return `AIに求めた役割：${filter.value} のレシート`;
    case "moodChange":
      return "気持ちの変化があったレシート";
    case "selfDecision":
      return "自己判断残高があるレシート";
  }
}

function getFilterDescription(filter: ReceiptFilter) {
  switch (filter.type) {
    case "category":
      return "同じ相談科目の思考レシートをまとめて見ています。";
    case "role":
      return "AIに同じ役割を求めた会話を振り返れます。";
    case "moodChange":
      return "AIとの会話の前後で、気持ちが動いた記録です。";
    case "selfDecision":
      return "AIからヒントを得たあと、自分の言葉で判断や気づきを残せたレシートです。";
  }
}

function getFilterBackLabel(origin: TabKey | null) {
  if (origin === "tax" || origin === "analysis") return "決算に戻る";
  if (origin === "journal") return "仕訳に戻る";
  if (origin === "home") return "レシートに戻る";
  return "すべての帳簿に戻る";
}

function getBottomReturnLabel(origin: TabKey | null) {
  if (origin === "tax" || origin === "analysis") return "決算画面に戻る";
  if (origin === "journal") return "仕訳に戻る";
  if (origin === "home") return "レシートに戻る";
  return "すべての帳簿に戻る";
}

function hasMoodChange(receipt: ThoughtReceipt) {
  return receipt.feelingBefore.trim() !== receipt.feelingAfter.trim();
}

function hasSelfDecisionBalance(receipt: ThoughtReceipt) {
  return Boolean(receipt.selfDecision.trim() || receipt.thoughtBalance.trim());
}

function isReframedMoodChange(receipt: ThoughtReceipt) {
  const beforeKeywords = ["不安", "迷い", "焦り", "もやもや", "少し不安"];
  const afterKeywords = ["安心", "納得", "見通し", "すっきり", "落ち着き", "前向き"];

  return (
    beforeKeywords.some((keyword) => receipt.feelingBefore.includes(keyword)) &&
    afterKeywords.some((keyword) => receipt.feelingAfter.includes(keyword))
  );
}

function topCountLabel(counts: Record<string, number>) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "-";
}

function topCountLabels(counts: Record<string, number>, limit: number) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label]) => label);
}

function getDistanceSummary(data: ThoughtReceipt[]) {
  const label = topCountLabel(countBy(data, "distanceLevel"));
  return label === "-" ? "ほどよい中心" : label;
}

function buildJournalStats(data: ThoughtReceipt[]) {
  const journalReceipts = getJournalReceipts(data);
  const totals = journalCategories.map((category) => {
    const total = journalReceipts.reduce(
      (sum, receipt) => sum + getJournalAmount(getReceiptJournal(receipt), category.key),
      0,
    );
    const tags = topTagsForJournal(journalReceipts, category.key);

    return {
      ...category,
      total,
      percent: 0,
      tags,
    };
  });
  const grandTotal = totals.reduce((sum, item) => sum + item.total, 0);

  return {
    total: grandTotal,
    receiptCount: journalReceipts.length,
    items: totals.map((item) => ({
      ...item,
      percent: grandTotal > 0 ? Math.round((item.total / grandTotal) * 100) : 0,
    })),
  };
}

function getJournalReceipts(data: ThoughtReceipt[]) {
  return data.filter(hasJournalData);
}

function hasJournalData(receipt: ThoughtReceipt) {
  return Boolean(receipt.journal);
}

function getReceiptJournal(receipt: ThoughtReceipt) {
  return normalizeJournal(receipt.journal, receipt);
}

function normalizeJournal(journal: ThoughtJournal | undefined, receipt: ThoughtReceipt): ThoughtJournal {
  const fallback = createSampleJournal(receipt);

  return {
    aiBorrowing: normalizeJournalUnit(journal?.aiBorrowing, fallback.aiBorrowing),
    selfCapital: normalizeJournalUnit(journal?.selfCapital, fallback.selfCapital),
    thoughtAsset: normalizeJournalUnit(journal?.thoughtAsset, fallback.thoughtAsset),
    thoughtExpense: normalizeJournalUnit(journal?.thoughtExpense, fallback.thoughtExpense),
    selfDecisionBalance: {
      amount: normalizeAmount(
        journal?.selfDecisionBalance?.amount,
        fallback.selfDecisionBalance.amount,
      ),
      text: journal?.selfDecisionBalance?.text?.trim() || fallback.selfDecisionBalance.text,
    },
  };
}

function normalizeJournalUnit(unit: JournalUnit | undefined, fallback: JournalUnit): JournalUnit {
  return {
    amount: normalizeAmount(unit?.amount, fallback.amount),
    tags: unit?.tags?.length ? unit.tags.slice(0, 4) : fallback.tags,
  };
}

function normalizeAmount(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function createSampleJournal(receipt: ThoughtReceipt): ThoughtJournal {
  if (receipt.category === "企画・制作") {
    return {
      aiBorrowing: { amount: 4, tags: ["比較軸", "言語化", "手順整理"] },
      selfCapital: { amount: 3, tags: ["目的", "違和感", "最終判断"] },
      thoughtAsset: { amount: 5, tags: ["見通し", "方向性", "判断材料"] },
      thoughtExpense: { amount: 2, tags: ["迷い", "調べる手間"] },
      selfDecisionBalance: {
        amount: 4,
        text: receipt.selfDecision || "次に進める方針を自分で決めた",
      },
    };
  }

  if (receipt.category === "文章作成" || receipt.category === "課題・レポート") {
    return {
      aiBorrowing: { amount: 4, tags: ["論点整理", "文章化", "構成"] },
      selfCapital: { amount: 3, tags: ["体験", "主張", "言い換え"] },
      thoughtAsset: { amount: 4, tags: ["下書き", "見通し", "表現"] },
      thoughtExpense: { amount: 2, tags: ["焦り", "書き直し"] },
      selfDecisionBalance: {
        amount: 3,
        text: receipt.selfDecision || "自分の言葉で仕上げる方向を残した",
      },
    };
  }

  if (receipt.category === "感情整理" || receipt.category === "人間関係") {
    return {
      aiBorrowing: { amount: 3, tags: ["聞き役", "言語化", "距離感"] },
      selfCapital: { amount: 4, tags: ["気持ち", "境界線", "本音"] },
      thoughtAsset: { amount: 3, tags: ["落ち着き", "選択肢", "伝え方"] },
      thoughtExpense: { amount: 4, tags: ["不安", "モヤモヤ", "迷い"] },
      selfDecisionBalance: {
        amount: 4,
        text: receipt.selfDecision || "自分の気持ちを優先する判断を残した",
      },
    };
  }

  if (receipt.category === "進路・将来") {
    return {
      aiBorrowing: { amount: 3, tags: ["比較軸", "調べ方", "選択肢"] },
      selfCapital: { amount: 5, tags: ["価値観", "優先順位", "納得感"] },
      thoughtAsset: { amount: 4, tags: ["判断材料", "見通し", "方向性"] },
      thoughtExpense: { amount: 3, tags: ["迷い", "不安"] },
      selfDecisionBalance: {
        amount: 5,
        text: receipt.selfDecision || "次に調べる候補を自分で選んだ",
      },
    };
  }

  return {
    aiBorrowing: { amount: 3, tags: ["情報整理", "比較軸", "確認"] },
    selfCapital: { amount: 3, tags: ["目的", "条件", "納得感"] },
    thoughtAsset: { amount: 4, tags: ["判断材料", "整理", "見通し"] },
    thoughtExpense: { amount: 2, tags: ["迷い", "手間"] },
    selfDecisionBalance: {
      amount: 3,
      text: receipt.selfDecision || receipt.thoughtBalance || "自分で確認することを残した",
    },
  };
}

function getJournalAmount(journal: ThoughtJournal, key: JournalCategoryKey) {
  if (key === "selfDecisionBalance") return journal.selfDecisionBalance.amount;
  return journal[key].amount;
}

function getJournalTags(journal: ThoughtJournal, key: JournalCategoryKey) {
  if (key === "selfDecisionBalance") return ["自分で決めたこと"];
  return journal[key].tags;
}

function topTagsForJournal(data: ThoughtReceipt[], key: JournalCategoryKey) {
  const counts = data.reduce<Record<string, number>>((acc, receipt) => {
    getJournalTags(getReceiptJournal(receipt), key).forEach((tag) => {
      acc[tag] = (acc[tag] ?? 0) + 1;
    });
    return acc;
  }, {});

  const tags = topCountLabels(counts, 3);
  return tags.length > 0 ? tags : ["記録中"];
}

function loadReceipts() {
  if (typeof window === "undefined") return initialReceipts.map(addSampleJournal);

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return initialReceipts.map(addSampleJournal);
    const parsed = JSON.parse(stored) as ThoughtReceipt[];
    if (!Array.isArray(parsed)) return initialReceipts.map(addSampleJournal);
    return parsed.map(normalizeReceipt);
  } catch {
    return initialReceipts.map(addSampleJournal);
  }
}

function normalizeReceipt(receipt: ThoughtReceipt): ThoughtReceipt {
  const legacyAdvisorRole = "\u53c2\u8b00";
  const legacyMoodGain = "\u5b89\u5fc3\u9084\u4ed8";
  const normalized = {
    ...receipt,
    aiRole: receipt.aiRole === legacyAdvisorRole ? "相談役" : receipt.aiRole,
    gained: receipt.gained === legacyMoodGain ? "気持ちの変化" : receipt.gained,
  };

  return {
    ...normalized,
    journal: receipt.journal ? normalizeJournal(receipt.journal, normalized) : undefined,
  };
}

function addSampleJournal(receipt: ThoughtReceipt): ThoughtReceipt {
  const normalized = normalizeReceipt(receipt);
  return {
    ...normalized,
    journal: normalizeJournal(normalized.journal, normalized),
  };
}

function countBy<T extends keyof ThoughtReceipt>(data: ThoughtReceipt[], key: T) {
  return data.reduce<Record<string, number>>((acc, item) => {
    const value = String(item[key]);
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function formatHours(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}時間${rest}分`;
}

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function formatFullDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function getJournalNumber(receiptId: string) {
  return receiptId.replace(/^R-/, "仕訳No. J-");
}

export default App;
